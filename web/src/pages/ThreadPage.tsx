import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";
import { MessageView } from "../components/MessageView";
import { Composer } from "../components/Composer";
import { InboxShell } from "../components/InboxShell";
import type { Mailbox, Message, Thread } from "../lib/types";

async function fetchMailboxById(id: string): Promise<Mailbox | null> {
  const { data, error } = await supabase.from("mailboxes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Mailbox) ?? null;
}

async function fetchThreadWithMessages(threadId: string): Promise<{ thread: Thread | null; messages: Message[] }> {
  const [{ data: threadRow, error: threadError }, { data: messageRows, error: messagesError }] = await Promise.all([
    supabase.from("threads").select("*").eq("id", threadId).maybeSingle(),
    supabase.from("messages").select("*").eq("thread_id", threadId).order("created_at", { ascending: true }),
  ]);
  if (threadError) throw threadError;
  if (messagesError) throw messagesError;
  return { thread: (threadRow as Thread) ?? null, messages: (messageRows as Message[]) ?? [] };
}

export function ThreadPage() {
  const { mailboxId: routeMailboxId, threadId } = useParams();
  const { mailbox: ownMailbox, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const { data: routedMailbox, isLoading: mailboxLoading } = useQuery({
    queryKey: ["mailbox", routeMailboxId],
    queryFn: () => fetchMailboxById(routeMailboxId as string),
    enabled: Boolean(routeMailboxId),
  });
  const mailbox = routeMailboxId ? (routedMailbox ?? null) : ownMailbox;
  const mailboxLookupDone = routeMailboxId ? !mailboxLoading : !authLoading;

  const { data: threadData, isLoading: threadLoading } = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => fetchThreadWithMessages(threadId as string),
    enabled: Boolean(threadId),
  });
  const thread = threadData?.thread ?? null;
  const messages = threadData?.messages ?? [];
  const lastMessage = messages[messages.length - 1];

  // New messages (including one that just arrived while this thread is
  // open) start expanded, matching Gmail; anything the reader has
  // manually collapsed stays collapsed rather than snapping back open.
  useEffect(() => {
    if (!lastMessage) return;
    setExpandedIds((prev) => (prev.has(lastMessage.id) ? prev : new Set(prev).add(lastMessage.id)));
  }, [lastMessage?.id]);

  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`thread-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        () => queryClient.invalidateQueries({ queryKey: ["thread", threadId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId, queryClient]);

  function toggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!mailboxLookupDone || threadLoading) return <div className="centered">Loading…</div>;
  if (!mailbox || !thread) return <div className="centered">Loading…</div>;

  const basePath = routeMailboxId ? `/admin/mailbox/${mailbox.id}/inbox` : "/inbox";
  const replyTo = lastMessage
    ? lastMessage.direction === "inbound"
      ? lastMessage.from_address
      : lastMessage.to_addresses[0]
    : "";

  return (
    <InboxShell mailboxAddress={mailbox.address} basePath={basePath}>
      <Link to={basePath} className="back-link">
        ← Back to inbox
      </Link>
      <h2>{thread.subject || "(no subject)"}</h2>
      <div className="message-list">
        {messages.map((m) => (
          <MessageView key={m.id} message={m} expanded={expandedIds.has(m.id)} onToggle={() => toggle(m.id)} />
        ))}
      </div>
      {lastMessage && (
        <Composer
          mailboxId={mailbox.id}
          defaultTo={replyTo}
          defaultSubject={thread.subject ?? ""}
          inReplyToMessageId={lastMessage.id}
        />
      )}
    </InboxShell>
  );
}
