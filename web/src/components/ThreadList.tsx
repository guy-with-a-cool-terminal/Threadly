import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { Avatar } from "./Avatar";
import type { Thread } from "../lib/types";

interface ThreadRow extends Thread {
  correspondent: string;
}

async function fetchThreads(mailboxId: string, search: string): Promise<ThreadRow[]> {
  let query = supabase
    .from("threads")
    .select("*")
    .eq("mailbox_id", mailboxId)
    .order("last_message_at", { ascending: false, nullsFirst: false });
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

export function ThreadList({ mailboxId, basePath }: { mailboxId: string; basePath: string }) {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: threads, isLoading } = useQuery({
    queryKey: ["threads", mailboxId, search],
    queryFn: () => fetchThreads(mailboxId, search),
  });

  // Live-refresh when new mail arrives for this mailbox, so the list
  // updates without a manual reload.
  useEffect(() => {
    const channel = supabase
      .channel(`messages-for-${mailboxId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `mailbox_id=eq.${mailboxId}` },
        () => queryClient.invalidateQueries({ queryKey: ["threads", mailboxId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [mailboxId, queryClient]);

  return (
    <div>
      <input
        className="search-input"
        placeholder="Search subject…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {isLoading && <p>Loading…</p>}
      {!isLoading && threads?.length === 0 && <p className="muted">No threads yet.</p>}
      <ul className="thread-list">
        {threads?.map((t) => (
          <li key={t.id}>
            <Link to={`${basePath}/${t.id}`}>
              <Avatar label={t.correspondent} />
              <span className="thread-row-main">
                <span className="thread-row-top">
                  <span className="thread-correspondent">{t.correspondent}</span>
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
