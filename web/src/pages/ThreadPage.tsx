import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";
import { MessageView } from "../components/MessageView";
import { Composer } from "../components/Composer";
import { InboxShell } from "../components/InboxShell";
import type { Mailbox, Message, Thread } from "../lib/types";

export function ThreadPage() {
  const { mailboxId: routeMailboxId, threadId } = useParams();
  const { mailbox: ownMailbox } = useAuth();
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    if (!routeMailboxId) {
      setMailbox(ownMailbox);
      return;
    }
    supabase
      .from("mailboxes")
      .select("*")
      .eq("id", routeMailboxId)
      .maybeSingle()
      .then(({ data }) => setMailbox((data as Mailbox) ?? null));
  }, [routeMailboxId, ownMailbox]);

  async function loadThread() {
    if (!threadId) return;
    const [{ data: threadRow }, { data: messageRows }] = await Promise.all([
      supabase.from("threads").select("*").eq("id", threadId).maybeSingle(),
      supabase.from("messages").select("*").eq("thread_id", threadId).order("created_at", { ascending: true }),
    ]);
    setThread((threadRow as Thread) ?? null);
    setMessages((messageRows as Message[]) ?? []);
  }

  useEffect(() => {
    loadThread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`thread-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        () => loadThread(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  if (!mailbox || !thread) return <div className="centered">Loading…</div>;

  const basePath = routeMailboxId ? `/admin/mailbox/${mailbox.id}/inbox` : "/inbox";
  const lastMessage = messages[messages.length - 1];
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
          <MessageView key={m.id} message={m} />
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
