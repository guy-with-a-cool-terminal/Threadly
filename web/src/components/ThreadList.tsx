import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  if (search.trim()) {
    query = query.ilike("subject", `%${search.trim()}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const threads = (data as Thread[]) ?? [];
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

  const folderQuery = folder === "inbox" ? "" : `folder=${folder}&`;

  return (
    <div>
      <input
        className="search-input"
        placeholder="Search subject…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {isLoading && <p>Loading…</p>}
      {!isLoading && threads?.length === 0 && <p className="muted">Nothing here.</p>}
      <ul className="thread-list">
        {threads?.map((t) => (
          <li key={t.id}>
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
                    {t.starred && <span className="star-icon"> ★</span>}
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
