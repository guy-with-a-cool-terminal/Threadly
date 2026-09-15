import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

// Stores one attachment's bytes in the `attachments` Storage bucket and
// records it in the `attachments` table. Used by both directions: inbound
// (bytes downloaded from Resend) and outbound (bytes the client uploaded to
// send, kept so they're viewable later without re-hitting Resend).
export async function storeAttachment(
  db: SupabaseClient,
  params: {
    mailboxId: string;
    messageId: string;
    fileName: string;
    contentType: string | null;
    bytes: Uint8Array;
  },
): Promise<void> {
  const { mailboxId, messageId, fileName, contentType, bytes } = params;
  const safeName = fileName.replace(/[/\\]/g, "_");
  const storagePath = `${mailboxId}/${messageId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await db.storage
    .from("attachments")
    .upload(storagePath, bytes, {
      contentType: contentType ?? "application/octet-stream",
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { error: insertError } = await db.from("attachments").insert({
    message_id: messageId,
    mailbox_id: mailboxId,
    file_name: fileName,
    content_type: contentType,
    size_bytes: bytes.byteLength,
    storage_path: storagePath,
  });
  if (insertError) throw insertError;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
