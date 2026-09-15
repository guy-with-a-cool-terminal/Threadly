import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically into
// every edge function by Supabase - no need to set them as secrets.
export function supabaseAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

// Client scoped to the *caller's* JWT, so RLS applies exactly as it would
// for their own browser session. Used to answer "is this really their
// mailbox / are they really an admin" without re-implementing ownership
// checks that already live in Postgres policies.
export function supabaseAsCaller(authHeader: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    },
  );
}
