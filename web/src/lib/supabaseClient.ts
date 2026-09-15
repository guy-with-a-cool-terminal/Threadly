import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

// Always export a real client, even when unconfigured, so importing this
// module never throws and crashes the whole app at load time. App.tsx
// checks isSupabaseConfigured up front and renders a setup screen instead
// of any page that would actually use it - nothing ever calls this
// placeholder client for real.
export const supabase = createClient(
  isSupabaseConfigured ? url : "https://placeholder.invalid",
  isSupabaseConfigured ? anonKey : "placeholder-anon-key",
);
