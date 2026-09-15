// Phase 2: inbound pipeline.
//
// Resend POSTs an `email.received` webhook here for every message that
// lands on a receiving domain. The webhook payload is metadata only (from,
// to, subject, attachment list) - the body is fetched separately via
// `resend.emails.receiving.get(email_id)`, and attachment bytes via
// `resend.emails.receiving.attachments.list(...)` (returns a signed
// `download_url` per attachment; the get()'d email's own `.attachments`
// only carries metadata, no URL). Shapes confirmed directly against the
// `resend` npm package's shipped .d.ts (v6.28.0), not just docs.
//
// Because each Resend account has its own webhook signing secret, this
// function is registered once per Resend account, with the account label
// passed as a query param, e.g.:
//   https://<project>.functions.supabase.co/inbound-email?account=resend_account_1
//
// Billing/suspension is intentionally NOT enforced here yet (business
// decision: get clients onboarded first, add payment gating later) - every
// inbound email is stored regardless of mailbox status.

import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { resendClientFor, webhookSecretFor } from "../_shared/resend.ts";
import { verifySvixSignature } from "../_shared/verifySvixSignature.ts";
import { findOrCreateThreadForInbound } from "../_shared/threading.ts";
import { storeAttachment } from "../_shared/attachments.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const accountLabel = new URL(req.url).searchParams.get("account");
  if (!accountLabel) {
    return new Response("Missing ?account= query param", { status: 400 });
  }

  const rawBody = await req.text();

  let verified: boolean;
  try {
    const secret = await webhookSecretFor(accountLabel);
    verified = await verifySvixSignature({
      rawBody,
      svixId: req.headers.get("svix-id"),
      svixTimestamp: req.headers.get("svix-timestamp"),
      svixSignature: req.headers.get("svix-signature"),
      secret,
    });
  } catch (err) {
    console.error("inbound-email: signature setup failed", err);
    return new Response("Server misconfiguration", { status: 500 });
  }
  if (!verified) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(rawBody);
  if (event.type !== "email.received") {
    // Ack anything else (e.g. if this endpoint is ever also subscribed to
    // send-side events) so Resend doesn't keep retrying it.
    return new Response("ok", { status: 200 });
  }

  const data = event.data as {
    email_id: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    attachments?: { id: string; filename: string; content_type?: string }[];
  };

  const db = supabaseAdmin();

  const toLower = (data.to ?? []).map((a) => a.toLowerCase());
  const { data: mailbox, error: mailboxLookupError } = await db
    .from("mailboxes")
    .select("id, address, domain_id, domains(domain_name)")
    .in("address", toLower)
    .limit(1)
    .maybeSingle();

  if (mailboxLookupError) {
    console.error("inbound-email: mailbox lookup failed", mailboxLookupError);
    // Likely transient (DB hiccup) - ask Resend to retry.
    return new Response("Lookup error", { status: 500 });
  }

  if (!mailbox) {
    await db.from("inbound_log").insert({
      resend_email_id: data.email_id,
      resend_account_label: accountLabel,
      from_address: data.from,
      to_addresses: data.to,
      subject: data.subject ?? null,
      reason: "no_matching_mailbox",
    });
    // Permanent condition - retrying won't help - so ack with 200.
    return new Response("ok (unrouted, logged)", { status: 200 });
  }

  // Webhook delivery is at-least-once, not exactly-once - Resend (like any
  // webhook provider) can redeliver the same event on retry, timeout, or a
  // manual replay. Short-circuit before doing any of the expensive work
  // (fetching the full body, threading, downloading attachments) if this
  // exact email was already stored.
  const { data: existingMessage } = await db
    .from("messages")
    .select("id")
    .eq("resend_message_id", data.email_id)
    .maybeSingle();
  if (existingMessage) {
    return new Response(JSON.stringify({ ok: true, message_id: existingMessage.id, duplicate: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const resend = await resendClientFor(accountLabel);

    const { data: full, error: fetchError } = await resend.emails.receiving.get(data.email_id);
    if (fetchError || !full) throw new Error(`receiving.get failed: ${JSON.stringify(fetchError)}`);

    const headers = normalizeHeaders(full.headers);
    const messageIdHeader = headers["message-id"] ?? null;
    const inReplyToHeader = headers["in-reply-to"] ?? null;
    const referencesHeader = headers["references"] ?? null;

    const threadId = await findOrCreateThreadForInbound(db, {
      mailboxId: mailbox.id,
      subject: data.subject ?? null,
      inReplyToHeader,
      referencesHeader,
    });

    const { data: messageRow, error: insertError } = await db
      .from("messages")
      .insert({
        thread_id: threadId,
        mailbox_id: mailbox.id,
        direction: "inbound",
        from_address: data.from,
        to_addresses: data.to,
        cc_addresses: data.cc ?? null,
        bcc_addresses: data.bcc ?? null,
        subject: data.subject ?? null,
        body_text: full.text,
        body_html: full.html,
        message_id_header: messageIdHeader,
        in_reply_to_header: inReplyToHeader,
        references_header: referencesHeader,
        resend_message_id: data.email_id,
        status: "received",
      })
      .select("id")
      .single();
    if (insertError) {
      // 23505 = unique_violation on resend_message_id - a concurrent
      // delivery of the same event won the race and inserted it first.
      // That's a successful outcome, not a failure: the email is stored
      // either way, just not by this particular request.
      if (insertError.code === "23505") {
        return new Response(JSON.stringify({ ok: true, duplicate: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw insertError;
    }

    await db
      .from("threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", threadId);

    if (full.attachments.length > 0) {
      try {
        const { data: attachmentList, error: listError } = await resend.emails.receiving.attachments.list({
          emailId: data.email_id,
        });
        if (listError) throw new Error(`attachments.list failed: ${JSON.stringify(listError)}`);

        for (const item of attachmentList?.data ?? []) {
          const res = await fetch(item.download_url);
          if (!res.ok) {
            console.error("inbound-email: attachment download failed", item.filename, res.status);
            continue;
          }
          const bytes = new Uint8Array(await res.arrayBuffer());
          await storeAttachment(db, {
            mailboxId: mailbox.id,
            messageId: messageRow!.id,
            fileName: item.filename ?? "attachment",
            contentType: item.content_type ?? null,
            bytes,
          });
        }
      } catch (attachErr) {
        // Don't fail the whole message over an attachment problem - the
        // email body is already safely stored.
        console.error("inbound-email: attachment processing failed", attachErr);
        await db.from("inbound_log").insert({
          resend_email_id: data.email_id,
          resend_account_label: accountLabel,
          from_address: data.from,
          to_addresses: data.to,
          subject: data.subject ?? null,
          reason: "attachment_processing_error",
          detail: String(attachErr),
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, message_id: messageRow!.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("inbound-email: processing failed", err);
    await db.from("inbound_log").insert({
      resend_email_id: data.email_id,
      resend_account_label: accountLabel,
      from_address: data.from,
      to_addresses: data.to,
      subject: data.subject ?? null,
      reason: "processing_error",
      detail: String(err),
    });
    // Unknown/possibly-transient failure - ask Resend to retry.
    return new Response("Processing error", { status: 500 });
  }
});

function normalizeHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (Array.isArray(headers)) {
    for (const h of headers as { name?: string; value?: string }[]) {
      if (h?.name) out[h.name.toLowerCase()] = h.value ?? "";
    }
    return out;
  }
  if (typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, string>)) {
      out[k.toLowerCase()] = v;
    }
  }
  return out;
}
