// Admin-only: create a mailbox - a Supabase Auth user plus the
// corresponding `mailboxes` row - on a domain that's already registered in
// the system (see add-domain). This function does one thing only: it never
// touches Resend, never creates a client or a domain. Domain setup is a
// one-off per client handled separately; creating a mailbox on an
// already-configured domain should be as simple as picking the domain and
// typing a name.

import { supabaseAdmin, supabaseAsCaller } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";

interface ProvisionRequestBody {
  domainId: string;
  localPart: string;
  initialPassword: string;
  monthlyFeeKes?: number;
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

  let body: ProvisionRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.domainId || !body.localPart || !body.initialPassword) {
    return jsonResponse({ error: "domainId, localPart, and initialPassword are required" }, 400);
  }

  const admin = supabaseAdmin();

  const { data: domain, error: domainError } = await admin
    .from("domains")
    .select("id, domain_name")
    .eq("id", body.domainId)
    .maybeSingle();
  if (domainError || !domain) {
    return jsonResponse({ error: "Domain not found - add it first from Admin -> Add domain" }, 404);
  }

  const localPart = body.localPart.toLowerCase().trim();
  const address = `${localPart}@${domain.domain_name}`;

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: address,
    password: body.initialPassword,
    email_confirm: true,
  });
  if (authError || !authUser?.user) {
    return jsonResponse({ error: `Failed to create login for ${address}: ${authError?.message}` }, 409);
  }

  const { data: mailbox, error: mailboxError } = await admin
    .from("mailboxes")
    .insert({
      domain_id: domain.id,
      local_part: localPart,
      address,
      auth_user_id: authUser.user.id,
      monthly_fee_kes: body.monthlyFeeKes ?? 500,
      status: "active",
    })
    .select("id")
    .single();

  if (mailboxError || !mailbox) {
    // Roll back the auth user so a failed provision doesn't leave an
    // orphaned login behind.
    await admin.auth.admin.deleteUser(authUser.user.id);
    return jsonResponse({ error: `Failed to create mailbox row: ${mailboxError?.message}` }, 500);
  }

  return jsonResponse({ ok: true, mailboxId: mailbox.id, address });
});
