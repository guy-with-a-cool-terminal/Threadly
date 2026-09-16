import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";

// supabase.functions.invoke() only throws a generic "Edge Function returned
// a non-2xx status code" FunctionsHttpError by default - the actual
// { error: "..." } body every function here returns has to be read off
// error.context (the raw Response) manually, or none of our specific error
// messages (e.g. "Resend rejected this key: ...") would ever reach the UI.
async function invokeFunction<T>(name: string, body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body: body as Record<string, unknown> });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let message: string | undefined;
      try {
        const payload = await error.context.json();
        message = payload?.error;
      } catch {
        // Response body wasn't JSON - fall through to the generic error.
      }
      if (message) throw new Error(message);
    }
    throw error;
  }
  return data as T;
}

export interface SendEmailInput {
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

export async function sendEmail(input: SendEmailInput) {
  return invokeFunction<{ ok: true; messageId: string; threadId: string }>("send-email", input);
}

export interface AddDomainInput {
  clientId?: string;
  newClientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  domainName: string;
  resendAccountLabel: string;
}

export async function addDomain(input: AddDomainInput) {
  return invokeFunction<{
    ok: true;
    clientId: string;
    domainId: string;
    domain: { status: string; dns_records: unknown };
    alreadyRegistered: boolean;
  }>("add-domain", input);
}

export interface ProvisionMailboxInput {
  domainId: string;
  localPart: string;
  initialPassword: string;
  monthlyFeeKes?: number;
}

export async function provisionMailbox(input: ProvisionMailboxInput) {
  return invokeFunction<{ ok: true; mailboxId: string; address: string }>("provision-mailbox", input);
}

export interface ResendAccountSummary {
  label: string;
  display_name: string;
  has_api_key: boolean;
  api_key_last4: string | null;
  has_webhook_secret: boolean;
  webhook_secret_last4: string | null;
  created_at: string;
}

export async function listResendAccounts(): Promise<ResendAccountSummary[]> {
  const { data, error } = await supabase.rpc("list_resend_accounts");
  if (error) throw error;
  return (data as ResendAccountSummary[]) ?? [];
}

export async function createResendAccount(input: { label: string; displayName: string }) {
  return invokeFunction<{ ok: true }>("manage-resend-accounts", {
    action: "create",
    label: input.label,
    displayName: input.displayName,
  });
}

export async function setResendApiKey(label: string, apiKey: string) {
  return invokeFunction<{ ok: true; verified: true; webhookConfigured: true }>("manage-resend-accounts", {
    action: "set-api-key",
    label,
    apiKey,
  });
}

export async function verifyResendApiKey(label: string) {
  return invokeFunction<{ ok: boolean; error?: string }>("manage-resend-accounts", {
    action: "verify-api-key",
    label,
  });
}

export async function reconfigureResendWebhook(label: string) {
  return invokeFunction<{ ok: true }>("manage-resend-accounts", {
    action: "reconfigure-webhook",
    label,
  });
}

export interface AdminSummary {
  auth_user_id: string;
  email: string;
  created_at: string;
}

export async function listAdmins(): Promise<AdminSummary[]> {
  const { data, error } = await supabase.rpc("list_admins");
  if (error) throw error;
  return (data as AdminSummary[]) ?? [];
}

export async function grantAdmin(email: string) {
  return invokeFunction<{ ok: true; authUserId: string }>("manage-admins", { action: "grant", email });
}

export async function revokeAdmin(authUserId: string) {
  return invokeFunction<{ ok: true }>("manage-admins", { action: "revoke", authUserId });
}

export async function deleteThreadForever(threadId: string) {
  return invokeFunction<{ ok: true }>("delete-thread-forever", { threadId });
}

// Updates the caller's own mailbox signature via a security definer
// function, rather than a direct table update - see
// supabase/migrations/20260916000001_mailbox_signature.sql for why (a
// direct RLS update policy on mailboxes can't be scoped to just this one
// column).
export async function updateMySignature(signature: string | null) {
  const { error } = await supabase.rpc("update_my_signature", { new_signature: signature });
  if (error) throw error;
}

// Reads a file picked in a <input type="file"> into base64, for attaching
// to an outbound send.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix - Resend just wants the payload.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
