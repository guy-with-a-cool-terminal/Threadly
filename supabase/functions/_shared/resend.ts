import { Resend } from "npm:resend@6.28.0";
import { supabaseAdmin } from "./supabaseAdmin.ts";

// Resend account credentials live in the resend_accounts table, managed
// from the admin UI (manage-resend-accounts function), not as
// RESEND_ACCOUNT_N_API_KEY secrets. This is what makes adding an account a
// normal admin-panel action instead of a CLI/dashboard step - see
// AdminResendAccountsPage.tsx. Keys are only ever read here, server-side,
// via the service role client.

interface ResendAccountCreds {
  apiKey: string;
  webhookSecret: string | null;
}

async function loadAccount(accountLabel: string): Promise<ResendAccountCreds> {
  const { data, error } = await supabaseAdmin()
    .from("resend_accounts")
    .select("api_key, webhook_secret")
    .eq("label", accountLabel)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load Resend account "${accountLabel}": ${error.message}`);
  }
  if (!data) {
    throw new Error(`Unknown Resend account "${accountLabel}" - add it from the admin panel first.`);
  }
  if (!data.api_key) {
    throw new Error(`Resend account "${accountLabel}" has no API key saved yet - add it from the admin panel.`);
  }
  return { apiKey: data.api_key as string, webhookSecret: (data.webhook_secret as string | null) ?? null };
}

export async function resendClientFor(accountLabel: string): Promise<Resend> {
  const { apiKey } = await loadAccount(accountLabel);
  return new Resend(apiKey);
}

export async function webhookSecretFor(accountLabel: string): Promise<string> {
  const { webhookSecret } = await loadAccount(accountLabel);
  if (!webhookSecret) {
    throw new Error(`Resend account "${accountLabel}" has no webhook secret saved yet - add it from the admin panel.`);
  }
  return webhookSecret;
}
