// Admin-only: grant or revoke cross-client admin access. There's no
// self-serve signup (see config.toml enable_signup = false), so granting
// just looks an existing login up by email via the GoTrue admin API and
// adds a row to `admins`; revoking removes one, with a guard against
// leaving the platform with zero admins.

import { supabaseAdmin, supabaseAsCaller } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, handleCorsPreflight, jsonResponse } from "../_shared/cors.ts";

interface Body {
  action: "grant" | "revoke";
  email?: string;
  authUserId?: string;
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

  const admin = supabaseAdmin();

  if (body.action === "grant") {
    if (!body.email) return jsonResponse({ error: "email is required" }, 400);
    const email = body.email.toLowerCase().trim();

    // The JS admin API doesn't filter listUsers by email server-side; the
    // account count here (mailboxes + admins) is small enough that a
    // single page and a client-side find is fine.
    const { data: usersPage, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listError) return jsonResponse({ error: `Failed to look up user: ${listError.message}` }, 500);
    const match = usersPage.users.find((u) => u.email?.toLowerCase() === email);
    if (!match) {
      return jsonResponse({ error: `No login found for ${email}. Create their account first.` }, 404);
    }

    const { error } = await admin.from("admins").insert({ auth_user_id: match.id });
    if (error && error.code !== "23505") {
      // 23505 = unique_violation - already an admin, treat as a no-op success.
      return jsonResponse({ error: `Failed to grant admin: ${error.message}` }, 500);
    }
    return jsonResponse({ ok: true, authUserId: match.id });
  }

  if (body.action === "revoke") {
    if (!body.authUserId) return jsonResponse({ error: "authUserId is required" }, 400);

    const { count } = await admin.from("admins").select("*", { count: "exact", head: true });
    if ((count ?? 0) <= 1) {
      return jsonResponse({ error: "Can't remove the last admin." }, 400);
    }

    const { error } = await admin.from("admins").delete().eq("auth_user_id", body.authUserId);
    if (error) return jsonResponse({ error: `Failed to revoke admin: ${error.message}` }, 500);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Unknown action" }, 400);
});
