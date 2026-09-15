// Admin-only: create Resend account entries and paste in the API key. This
// is what makes adding a Resend account a normal admin-panel action instead
// of a `supabase secrets set` CLI step - see AdminResendAccountsPage.tsx
// for the guided flow this backs.
//
// Saving the API key also registers (or reuses) the inbound webhook on
// Resend itself via its Webhooks API and captures the signing secret it
// returns - there's no separate "go create a webhook and paste its secret"
// manual step. The one Resend-side action that genuinely can't be
// automated is enabling "Receiving" per domain (toggle-only, not exposed
// via the API), documented in the on-page instructions instead.
//
// Keys are written straight to the resend_accounts table via the service
// role and never read back out to a browser - list_resend_accounts() (the
// read side, called directly via RPC) only ever reports whether a key is
// set, never its value.

import { Resend } from "npm:resend@6.28.0";
import { supabaseAdmin, supabaseAsCaller } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";

interface Body {
  action: "create" | "set-api-key" | "verify-api-key" | "reconfigure-webhook";
  label: string;
  displayName?: string;
  apiKey?: string;
}

// Calls a real Resend endpoint with the candidate key so a mistyped or
// wrong-account key is caught the moment it's saved, instead of silently
// sitting in the database until send-email or provision-mailbox fails
// later with no way to tell why. domains.list() specifically needs a Full
// access key, which is what this app requires anyway (provision-mailbox
// calls domains.create()), so this isn't a stricter check than what the
// key actually needs to do here.
async function validateResendApiKey(apiKey: string): Promise<string | null> {
  try {
    const { error } = await new Resend(apiKey).domains.list();
    if (error) return error.message ?? "Resend rejected this key.";
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function webhookUrlFor(label: string): string {
  const projectUrl = Deno.env.get("SUPABASE_URL")!;
  const functionsHost = projectUrl.replace(".supabase.co", ".functions.supabase.co");
  return `${functionsHost}/inbound-email?account=${label}`;
}

// Idempotent: reuses an existing webhook pointed at this account's endpoint
// if one already exists (e.g. a re-run after rotating the API key) instead
// of creating a duplicate every time the key is saved.
async function ensureWebhookConfigured(resend: Resend, label: string): Promise<string> {
  const endpoint = webhookUrlFor(label);

  const { data: existingList, error: listError } = await resend.webhooks.list();
  if (listError) {
    throw new Error(`Failed to list existing webhooks: ${listError.message ?? JSON.stringify(listError)}`);
  }
  const existing = existingList?.data.find((w) => w.endpoint === endpoint);

  if (existing) {
    await resend.webhooks.update(existing.id, { events: ["email.received"], status: "enabled" });
    const { data: full, error: getError } = await resend.webhooks.get(existing.id);
    if (getError || !full) {
      throw new Error(`Failed to load webhook: ${getError?.message ?? JSON.stringify(getError)}`);
    }
    return full.signing_secret;
  }

  const { data: created, error: createError } = await resend.webhooks.create({
    endpoint,
    events: ["email.received"],
  });
  if (createError || !created) {
    throw new Error(`Failed to create webhook: ${createError?.message ?? JSON.stringify(createError)}`);
  }
  return created.signing_secret;
}

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

  const callerClient = supabaseAsCaller(authHeader);
  const { data: userResult, error: userError } = await callerClient.auth.getUser();
  if (userError || !userResult?.user) {
    return jsonResponse({ error: "Not authenticated" }, 401);
  }
  const { data: isAdmin } = await callerClient.rpc("is_admin");
  if (!isAdmin) return jsonResponse({ error: "Admin only" }, 403);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.label) return jsonResponse({ error: "label is required" }, 400);
  const label = body.label.toLowerCase().trim();
  const admin = supabaseAdmin();

  if (body.action === "create") {
    if (!body.displayName) return jsonResponse({ error: "displayName is required" }, 400);
    const { error } = await admin
      .from("resend_accounts")
      .insert({ label, display_name: body.displayName });
    if (error) return jsonResponse({ error: `Failed to create account: ${error.message}` }, 409);
    return jsonResponse({ ok: true });
  }

  if (body.action === "set-api-key") {
    if (!body.apiKey) return jsonResponse({ error: "apiKey is required" }, 400);
    const apiKey = body.apiKey.trim();
    if (!apiKey.startsWith("re_")) {
      return jsonResponse({ error: 'That doesn\'t look like a Resend API key (should start with "re_").' }, 422);
    }
    const validationError = await validateResendApiKey(apiKey);
    if (validationError) {
      return jsonResponse({ error: `Resend rejected this key: ${validationError}` }, 422);
    }

    let webhookSecret: string;
    try {
      webhookSecret = await ensureWebhookConfigured(new Resend(apiKey), label);
    } catch (err) {
      return jsonResponse(
        { error: `API key is valid, but webhook setup failed: ${err instanceof Error ? err.message : String(err)}` },
        502,
      );
    }

    const { error, count } = await admin
      .from("resend_accounts")
      .update({ api_key: apiKey, webhook_secret: webhookSecret, updated_at: new Date().toISOString() }, {
        count: "exact",
      })
      .eq("label", label);
    if (error) return jsonResponse({ error: `Failed to save API key: ${error.message}` }, 500);
    if (!count) return jsonResponse({ error: `No Resend account with label "${label}"` }, 404);
    return jsonResponse({ ok: true, verified: true, webhookConfigured: true });
  }

  if (body.action === "verify-api-key") {
    const { data, error: loadError } = await admin
      .from("resend_accounts")
      .select("api_key")
      .eq("label", label)
      .maybeSingle();
    if (loadError) return jsonResponse({ error: loadError.message }, 500);
    if (!data?.api_key) return jsonResponse({ error: "No API key saved yet." }, 400);
    const validationError = await validateResendApiKey(data.api_key as string);
    if (validationError) return jsonResponse({ ok: false, error: validationError });
    return jsonResponse({ ok: true });
  }

  if (body.action === "reconfigure-webhook") {
    const { data, error: loadError } = await admin
      .from("resend_accounts")
      .select("api_key")
      .eq("label", label)
      .maybeSingle();
    if (loadError) return jsonResponse({ error: loadError.message }, 500);
    if (!data?.api_key) return jsonResponse({ error: "No API key saved yet." }, 400);

    try {
      const webhookSecret = await ensureWebhookConfigured(new Resend(data.api_key as string), label);
      const { error } = await admin
        .from("resend_accounts")
        .update({ webhook_secret: webhookSecret, updated_at: new Date().toISOString() })
        .eq("label", label);
      if (error) return jsonResponse({ error: error.message }, 500);
      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  }

  return jsonResponse({ error: "Unknown action" }, 400);
});
