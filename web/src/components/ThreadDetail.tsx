import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { deleteThreadForever } from "../lib/api";
import { MessageView } from "./MessageView";
import { Composer } from "./Composer";
import type { Message, Thread } from "../lib/types";

async function fetchThreadWithMessages(threadId: string): Promise<{ thread: Thread | null; messages: Message[] }> {
  const [{ data: threadRow, error: threadError }, { data: messageRows, error: messagesError }] = await Promise.all([
    supabase.from("threads").select("*").eq("id", threadId).maybeSingle(),
    supabase.from("messages").select("*").eq("thread_id", threadId).order("created_at", { ascending: true }),
  ]);
  if (threadError) throw threadError;
  if (messagesError) throw messagesError;
  return { thread: (threadRow as Thread) ?? null, messages: (messageRows as Message[]) ?? [] };
}

// The reading pane: shown alongside ThreadList rather than replacing it,
// so the list never disappears while you're reading a message (the
// biggest structural gap versus a real mailbox client). Also owns the
// per-thread action toolbar (archive/trash/spam/star/read state) - these
// are state toggles on the thread row itself, not folder-specific
// behaviors, so the same set of buttons works no matter which folder you
// opened the thread from.
export function ThreadDetail({
  mailboxId,
  mailboxAddress,
  threadId,
  onClosed,
}: {
  mailboxId: string;
  mailboxAddress: string;
  threadId: string;
  onClosed?: () => void;
}) {
  const queryClient = useQueryClient();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [forwarding, setForwarding] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["thread", threadId],
    queryFn: () => fetchThreadWithMessages(threadId),
  });
  const thread = data?.thread ?? null;
  const messages = data?.messages ?? [];
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    if (!lastMessage) return;
    setExpandedIds((prev) => (prev.has(lastMessage.id) ? prev : new Set(prev).add(lastMessage.id)));
  }, [lastMessage?.id]);

  // Opening a thread marks it read - the same "you've seen this now"
  // convention every mailbox client uses.
  useEffect(() => {
    if (thread && !thread.is_read) {
      supabase
        .from("threads")
        .update({ is_read: true })
        .eq("id", threadId)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
          queryClient.invalidateQueries({ queryKey: ["threads", mailboxId] });
          queryClient.invalidateQueries({ queryKey: ["unread-count", mailboxId] });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id, thread?.is_read]);

  useEffect(() => {
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

  function invalidateListsAndClose() {
    queryClient.invalidateQueries({ queryKey: ["threads", mailboxId] });
    queryClient.invalidateQueries({ queryKey: ["sent-messages", mailboxId] });
    queryClient.invalidateQueries({ queryKey: ["unread-count", mailboxId] });
    onClosed?.();
  }

  const patchThread = useMutation({
    mutationFn: async (patch: Partial<Pick<Thread, "is_read" | "archived_at" | "deleted_at" | "is_spam" | "starred">>) => {
      const { error } = await supabase.from("threads").update(patch).eq("id", threadId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["thread", threadId] });
      invalidateListsAndClose();
    },
  });

  const deleteForever = useMutation({
    mutationFn: () => deleteThreadForever(threadId),
    onSuccess: invalidateListsAndClose,
  });

  if (isLoading) return <div className="centered">Loading…</div>;
  if (!thread) return <div className="centered">That thread doesn't exist, or you don't have access to it.</div>;

  const replyTo = lastMessage
    ? lastMessage.direction === "inbound"
      ? lastMessage.from_address
      : lastMessage.to_addresses[0]
    : "";

  // Reply defaults to everyone else who was on the original message (a
  // "reply all" by default, editable/removable in the Cc field) rather
  // than a separate Reply vs Reply-all flow.
  const selfAddress = mailboxAddress.toLowerCase();
  const replyAllCc = lastMessage
    ? Array.from(new Set([...(lastMessage.to_addresses ?? []), ...(lastMessage.cc_addresses ?? [])]))
        .filter((addr) => addr.toLowerCase() !== selfAddress && addr.toLowerCase() !== replyTo.toLowerCase())
    : [];

  function handleDeleteForever() {
    if (window.confirm("Delete this conversation forever? This can't be undone.")) {
      deleteForever.mutate();
    }
  }

  return (
    <div className="thread-detail">
      <div className="thread-toolbar">
        <button type="button" onClick={() => patchThread.mutate({ is_read: !thread.is_read })}>
          {thread.is_read ? "Mark unread" : "Mark read"}
        </button>
        <button
          type="button"
          onClick={() => patchThread.mutate({ archived_at: thread.archived_at ? null : new Date().toISOString() })}
        >
          {thread.archived_at ? "Move to inbox" : "Archive"}
        </button>
        <button type="button" onClick={() => patchThread.mutate({ is_spam: !thread.is_spam })}>
          {thread.is_spam ? "Not spam" : "Mark as spam"}
        </button>
        <button
          type="button"
          onClick={() => patchThread.mutate({ starred: !thread.starred })}
          style={thread.starred ? undefined : { background: "transparent", color: "var(--text)", borderColor: "var(--border)" }}
        >
          {thread.starred ? "★ Starred" : "☆ Star"}
        </button>
        {thread.deleted_at ? (
          <>
            <button type="button" onClick={() => patchThread.mutate({ deleted_at: null })}>
              Restore
            </button>
            <button
              type="button"
              onClick={handleDeleteForever}
              disabled={deleteForever.isPending}
              style={{ background: "transparent", color: "var(--danger)", borderColor: "var(--danger-soft)" }}
            >
              {deleteForever.isPending ? "Deleting…" : "Delete forever"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => patchThread.mutate({ deleted_at: new Date().toISOString() })}
            style={{ background: "transparent", color: "var(--danger)", borderColor: "var(--danger-soft)" }}
          >
            Move to trash
          </button>
        )}
      </div>

      <h2>{thread.subject || "(no subject)"}</h2>
      <div className="message-list">
        {messages.map((m) => (
          <MessageView key={m.id} message={m} expanded={expandedIds.has(m.id)} onToggle={() => toggle(m.id)} />
        ))}
      </div>

      {lastMessage && !forwarding && (
        <Composer
          mailboxId={mailboxId}
          defaultTo={replyTo}
          defaultCc={replyAllCc.join(", ")}
          defaultSubject={thread.subject ?? ""}
          inReplyToMessageId={lastMessage.id}
          onForward={() => setForwarding(true)}
        />
      )}
      {lastMessage && forwarding && (
        <Composer
          mailboxId={mailboxId}
          defaultSubject={thread.subject ? `Fwd: ${thread.subject}` : "Fwd:"}
          forwardBody={lastMessage.body_text ?? ""}
          onSent={() => setForwarding(false)}
          onDiscard={() => setForwarding(false)}
        />
      )}
    </div>
  );
}
