import type { SupabaseClient } from "npm:@supabase/supabase-js@2.116.0";

export function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject.replace(/^\s*(re|fwd?|fw)\s*:\s*/gi, "").trim().toLowerCase();
}

export function buildMessageIdHeader(domain: string): string {
  return `<${crypto.randomUUID()}@${domain}>`;
}

// Finds the thread an inbound message belongs to, in order of confidence:
// 1. It's a reply to a message we know about (In-Reply-To / References
//    header matches an existing message's Message-ID in this mailbox).
// 2. Its (normalized) subject matches a thread that had activity recently.
// 3. Otherwise, it starts a new thread.
export async function findOrCreateThreadForInbound(
  db: SupabaseClient,
  params: {
    mailboxId: string;
    subject: string | null;
    inReplyToHeader?: string | null;
    referencesHeader?: string | null;
  },
): Promise<string> {
  const { mailboxId, subject, inReplyToHeader, referencesHeader } = params;

  const candidateIds = [
    ...(inReplyToHeader ? [inReplyToHeader] : []),
    ...(referencesHeader ? referencesHeader.split(/\s+/) : []),
  ]
    .map((id) => id.trim())
    .filter(Boolean);

  if (candidateIds.length > 0) {
    const { data: matched } = await db
      .from("messages")
      .select("thread_id")
      .eq("mailbox_id", mailboxId)
      .in("message_id_header", candidateIds)
      .limit(1)
      .maybeSingle();
    if (matched?.thread_id) return matched.thread_id as string;
  }

  const normalized = normalizeSubject(subject);
  if (normalized) {
    const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentThreads } = await db
      .from("threads")
      .select("id, subject")
      .eq("mailbox_id", mailboxId)
      .gte("last_message_at", cutoff)
      .order("last_message_at", { ascending: false })
      .limit(20);
    const match = (recentThreads ?? []).find(
      (t: { subject: string | null }) => normalizeSubject(t.subject) === normalized,
    );
    if (match) return match.id as string;
  }

  const { data: created, error } = await db
    .from("threads")
    .insert({ mailbox_id: mailboxId, subject: subject ?? null })
    .select("id")
    .single();
  if (error) throw error;
  return created!.id as string;
}
