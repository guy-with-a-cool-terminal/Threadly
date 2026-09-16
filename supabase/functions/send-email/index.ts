// Phase 3: outbound pipeline.
//
// Called by the logged-in client's browser (supabase.functions.invoke,
// which forwards their JWT) to send a new message or a reply.
//
// Billing/suspension gating is intentionally NOT enforced yet - see
// mailbox.status below. That's a deliberate, temporary choice: the
// priority right now is getting clients fully working on this platform;
// payment enforcement is a Phase 6 follow-up once they're onboarded.

import { supabaseAdmin, supabaseAsCaller } from "../_shared/supabaseAdmin.ts";
import { resendClientFor } from "../_shared/resend.ts";
import { buildMessageIdHeader } from "../_shared/threading.ts";
import { storeAttachment, base64ToBytes } from "../_shared/attachments.ts";
import { corsHeaders, handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";

interface SendRequestBody {
  mailboxId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyToMessageId?: string;
  attachments?: { fileName: string; contentType?: string; contentBase64: string }[];
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  let body: SendRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.mailboxId || !body.to?.length || !body.subject) {
    return jsonResponse({ error: "mailboxId, to, and subject are required" }, 400);
  }
  if (!body.text && !body.html) {
    return jsonResponse({ error: "text or html is required" }, 400);
  }

  const callerClient = supabaseAsCaller(authHeader);
  const { data: userResult, error: userError } = await callerClient.auth.getUser();
  if (userError || !userResult?.user) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }
  const callerId = userResult.user.id;

  const admin = supabaseAdmin();

  const { data: mailbox, error: mailboxError } = await admin
    .from("mailboxes")
    .select("id, address, auth_user_id, status, domain_id, domains(domain_name, resend_account_label)")
    .eq("id", body.mailboxId)
    .maybeSingle();
  if (mailboxError || !mailbox) {
    return jsonResponse({ error: "Mailbox not found" }, 404);
  }

  const isOwner = mailbox.auth_user_id === callerId;
  if (!isOwner) {
    const { data: isAdmin } = await callerClient.rpc("is_admin");
    if (!isAdmin) return jsonResponse({ error: "Not authorized for this mailbox" }, 403);
  }

  // TODO(billing): once payment enforcement is turned on, reject here when
  // mailbox.status !== 'active' with a clear "mailbox suspended" error.
  // Left unenforced for now by design - see file header.
  void mailbox.status;

  // deno-lint-ignore no-explicit-any
  const domain = mailbox.domains as any;
  if (!domain?.domain_name || !domain?.resend_account_label) {
    return jsonResponse({ error: "Mailbox's domain is not configured" }, 500);
  }

  let parentThreadId: string | null = null;
  let inReplyTo: string | null = null;
  let references: string | null = null;

  if (body.inReplyToMessageId) {
    const { data: parent } = await admin
      .from("messages")
      .select("thread_id, message_id_header, references_header")
      .eq("id", body.inReplyToMessageId)
      .eq("mailbox_id", mailbox.id)
      .maybeSingle();
    if (parent) {
      parentThreadId = parent.thread_id as string;
      inReplyTo = parent.message_id_header as string | null;
      references = [parent.references_header, parent.message_id_header]
        .filter(Boolean)
        .join(" ") || null;
    }
  }

  let threadId: string;
  if (parentThreadId) {
    threadId = parentThreadId;
  } else {
    const { data: newThread, error: threadError } = await admin
      .from("threads")
      .insert({ mailbox_id: mailbox.id, subject: body.subject })
      .select("id")
      .single();
    if (threadError || !newThread) {
      return jsonResponse({ error: "Failed to create thread" }, 500);
    }
    threadId = newThread.id as string;
  }

  const messageIdHeader = buildMessageIdHeader(domain.domain_name);

  let resend;
  try {
    resend = await resendClientFor(domain.resend_account_label);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }

  const resendAttachments = (body.attachments ?? []).map((a) => ({
    filename: a.fileName,
    content: a.contentBase64,
    contentType: a.contentType,
  }));

  const commonEmailFields = {
    from: mailbox.address,
    to: body.to,
    cc: body.cc,
    bcc: body.bcc,
    subject: body.subject,
    replyTo: mailbox.address,
    headers: {
      "Message-ID": messageIdHeader,
      ...(inReplyTo ? { "In-Reply-To": inReplyTo } : {}),
      ...(references ? { "References": references } : {}),
    },
    attachments: resendAttachments.length ? resendAttachments : undefined,
  };

  // Split into two calls rather than one `{ text: body.text, html: body.html }`
  // object: the SDK's types require *statically* knowing at least one of
  // html/text is a definite string, which a single object with both typed
  // `string | undefined` can't satisfy even though we've already validated
  // at runtime that one of them is present.
  const { data: sent, error: sendError } = body.html
    ? await resend.emails.send({ ...commonEmailFields, html: body.html, text: body.text })
    : await resend.emails.send({ ...commonEmailFields, text: body.text as string });

  if (sendError || !sent) {
    await admin.from("messages").insert({
      thread_id: threadId,
      mailbox_id: mailbox.id,
      direction: "outbound",
      from_address: mailbox.address,
      to_addresses: body.to,
      cc_addresses: body.cc ?? null,
      bcc_addresses: body.bcc ?? null,
      subject: body.subject,
      body_text: body.text ?? null,
      body_html: body.html ?? null,
      message_id_header: messageIdHeader,
      in_reply_to_header: inReplyTo,
      references_header: references,
      status: "failed",
    });
    return jsonResponse({ error: `Send failed: ${JSON.stringify(sendError)}` }, 502);
  }

  const { data: messageRow, error: insertError } = await admin
    .from("messages")
    .insert({
      thread_id: threadId,
      mailbox_id: mailbox.id,
      direction: "outbound",
      from_address: mailbox.address,
      to_addresses: body.to,
      cc_addresses: body.cc ?? null,
      bcc_addresses: body.bcc ?? null,
      subject: body.subject,
      body_text: body.text ?? null,
      body_html: body.html ?? null,
      message_id_header: messageIdHeader,
      in_reply_to_header: inReplyTo,
      references_header: references,
      resend_message_id: sent.id,
      status: "sent",
    })
    .select("id")
    .single();
  if (insertError) {
    console.error("send-email: sent via Resend but failed to record locally", insertError);
    return jsonResponse(
      { ok: true, warning: "Sent, but failed to save locally - it won't appear in the thread." },
      200,
    );
  }

  // Sending into a thread means the owner has seen and handled it.
  await admin
    .from("threads")
    .update({ last_message_at: new Date().toISOString(), is_read: true })
    .eq("id", threadId);

  for (const a of body.attachments ?? []) {
    try {
      await storeAttachment(admin, {
        mailboxId: mailbox.id,
        messageId: messageRow!.id,
        fileName: a.fileName,
        contentType: a.contentType ?? null,
        bytes: base64ToBytes(a.contentBase64),
      });
    } catch (err) {
      console.error("send-email: failed to store outbound attachment copy", a.fileName, err);
    }
  }

  return jsonResponse({ ok: true, messageId: messageRow!.id, threadId });
});
