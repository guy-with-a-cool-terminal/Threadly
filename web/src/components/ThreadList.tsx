import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, Archive, Trash2, MailOpen, Mail, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { Avatar } from "./Avatar";
import type { Folder } from "./InboxShell";
import type { Thread } from "../lib/types";

interface ThreadRow extends Thread {
  correspondent: string;
}

async function fetchThreads(mailboxId: string, folder: Folder, search: string): Promise<ThreadRow[]> {
  let query = supabase.from("threads").select("*").eq("mailbox_id", mailboxId);
  if (folder === "archive") {
    query = query.not("archived_at", "is", null).is("deleted_at", null);
  } else if (folder === "spam") {
    query = query.eq("is_spam", true).is("deleted_at", null);
  } else if (folder === "trash") {
    query = query.not("deleted_at", "is", null);
  } else {
    query = query.is("archived_at", null).is("deleted_at", null).eq("is_spam", false);
  }
  query = query.order("last_message_at", { ascending: false, nullsFirst: false });
  const { data, error } = await query;
  if (error) throw error;
  let threads = (data as Thread[]) ?? [];

  if (search.trim() && threads.length > 0) {
    const term = search.trim().toLowerCase();
    const subjectMatchIds = new Set(
      threads.filter((t) => t.subject?.toLowerCase().includes(term)).map((t) => t.id),
    );
    // Also searches message body content, not just the subject - bounded
    // to this folder's own threads rather than a full-text index, which is
    // plenty fast at real per-mailbox volumes without a schema change.
    const { data: bodyMatches } = await supabase
      .from("messages")
      .select("thread_id")
      .in(
        "thread_id",
        threads.map((t) => t.id),
      )
      .ilike("body_text", `%${search.trim()}%`);
    const bodyMatchIds = new Set((bodyMatches ?? []).map((m) => m.thread_id as string));
    threads = threads.filter((t) => subjectMatchIds.has(t.id) || bodyMatchIds.has(t.id));
  }

  if (threads.length === 0) return [];

  // The correspondent shown per row (for the avatar + name) is whoever
  // sent/received the most recent message in that thread - fetched
  // separately and reduced client-side to "first row per thread_id"
  // (already ordered newest-first) rather than a fragile embedded-select
  // query string for the latest-per-group row.
  const { data: msgRows } = await supabase
    .from("messages")
    .select("thread_id, from_address, to_addresses, direction")
    .in(
      "thread_id",
      threads.map((t) => t.id),
    )
    .order("created_at", { ascending: false });
  const correspondentByThread = new Map<string, string>();
  for (const m of (msgRows as { thread_id: string; from_address: string; to_addresses: string[]; direction: string }[]) ?? []) {
    if (correspondentByThread.has(m.thread_id)) continue;
    correspondentByThread.set(m.thread_id, m.direction === "inbound" ? m.from_address : m.to_addresses[0] ?? "?");
  }
  return threads.map((t) => ({ ...t, correspondent: correspondentByThread.get(t.id) ?? "?" }));
}

export function ThreadList({
  mailboxId,
  basePath,
  folder,
  selectedThreadId,
}: {
  mailboxId: string;
  basePath: string;
  folder: Folder;
  selectedThreadId?: string;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const { data: threads, isLoading } = useQuery({
    queryKey: ["threads", mailboxId, folder, search],
    queryFn: () => fetchThreads(mailboxId, folder, search),
  });

  // Live-refresh when mail arrives or a thread's state changes (archived,
  // trashed, read, etc.), so the list updates without a manual reload.
  useEffect(() => {
    const channel = supabase
      .channel(`threads-for-${mailboxId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "threads", filter: `mailbox_id=eq.${mailboxId}` },
        () => queryClient.invalidateQueries({ queryKey: ["threads", mailboxId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [mailboxId, queryClient]);

  // Selection doesn't survive a folder/search switch - stale ids from a
  // previous list would silently no-op a bulk action otherwise.
  useEffect(() => {
    setSelected(new Set());
  }, [folder, search]);

  const bulkUpdate = useMutation({
    mutationFn: async (patch: Partial<Pick<Thread, "is_read" | "archived_at" | "deleted_at">>) => {
      const { error } = await supabase.from("threads").update(patch).in("id", Array.from(selected));
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads", mailboxId] });
      queryClient.invalidateQueries({ queryKey: ["unread-count", mailboxId] });
      setSelected(new Set());
    },
  });

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const folderQuery = folder === "inbox" ? "" : `folder=${folder}&`;

  return (
    <div>
      {selected.size > 0 ? (
        <div className="bulk-action-bar">
          <span className="muted">{selected.size} selected</span>
          <button
            type="button"
            className="icon-button"
            title="Mark read"
            aria-label="Mark read"
            onClick={() => bulkUpdate.mutate({ is_read: true })}
          >
            <MailOpen size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Mark unread"
            aria-label="Mark unread"
            onClick={() => bulkUpdate.mutate({ is_read: false })}
          >
            <Mail size={17} />
          </button>
          {folder !== "trash" && (
            <button
              type="button"
              className="icon-button"
              title="Archive"
              aria-label="Archive"
              onClick={() => bulkUpdate.mutate({ archived_at: new Date().toISOString() })}
            >
              <Archive size={17} />
            </button>
          )}
          <button
            type="button"
            className="icon-button icon-button-danger"
            title="Move to trash"
            aria-label="Move to trash"
            onClick={() => bulkUpdate.mutate({ deleted_at: new Date().toISOString() })}
          >
            <Trash2 size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Clear selection"
            aria-label="Clear selection"
            onClick={() => setSelected(new Set())}
          >
            <X size={17} />
          </button>
        </div>
      ) : (
        <input
          className="search-input"
          placeholder="Search mail…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      {isLoading && <p>Loading…</p>}
      {!isLoading && threads?.length === 0 && <p className="muted">Nothing here.</p>}
      <ul className="thread-list">
        {threads?.map((t) => (
          <li key={t.id}>
            <label className="thread-checkbox">
              <input
                type="checkbox"
                checked={selected.has(t.id)}
                onChange={() => toggleSelected(t.id)}
                onClick={(e) => e.stopPropagation()}
              />
            </label>
            <Link
              to={`${basePath}?${folderQuery}thread=${t.id}`}
              className={`${t.is_read ? "" : "thread-unread"} ${t.id === selectedThreadId ? "thread-selected" : ""}`}
            >
              <span className={`unread-dot ${t.is_read ? "unread-dot-hidden" : ""}`} />
              <Avatar label={t.correspondent} />
              <span className="thread-row-main">
                <span className="thread-row-top">
                  <span className="thread-correspondent">
                    {t.correspondent}
                    {t.starred && <Star className="star-icon" size={13} fill="currentColor" />}
                  </span>
                  <span className="thread-date">
                    {t.last_message_at ? new Date(t.last_message_at).toLocaleString() : ""}
                  </span>
                </span>
                <span className="thread-subject">{t.subject || "(no subject)"}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
