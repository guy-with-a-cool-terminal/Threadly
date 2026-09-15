import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { Avatar } from "./Avatar";
import type { Thread } from "../lib/types";

interface LatestInfo {
  correspondent: string;
}

export function ThreadList({ mailboxId, basePath }: { mailboxId: string; basePath: string }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [latest, setLatest] = useState<Map<string, LatestInfo>>(new Map());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    let query = supabase
      .from("threads")
      .select("*")
      .eq("mailbox_id", mailboxId)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (search.trim()) {
      query = query.ilike("subject", `%${search.trim()}%`);
    }
    const { data, error } = await query;
    const threadList = (data as Thread[]) ?? [];
    if (!error) setThreads(threadList);

    // The correspondent shown per row (for the avatar + name) is whoever
    // sent/received the most recent message in that thread - fetched
    // separately and reduced client-side to "first row per thread_id"
    // (already ordered newest-first) rather than a fragile embedded-select
    // query string for the latest-per-group row.
    if (threadList.length > 0) {
      const { data: msgRows } = await supabase
        .from("messages")
        .select("thread_id, from_address, to_addresses, direction")
        .in(
          "thread_id",
          threadList.map((t) => t.id),
        )
        .order("created_at", { ascending: false });
      const byThread = new Map<string, LatestInfo>();
      for (const m of (msgRows as { thread_id: string; from_address: string; to_addresses: string[]; direction: string }[]) ?? []) {
        if (byThread.has(m.thread_id)) continue;
        byThread.set(m.thread_id, {
          correspondent: m.direction === "inbound" ? m.from_address : m.to_addresses[0] ?? "?",
        });
      }
      setLatest(byThread);
    } else {
      setLatest(new Map());
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailboxId, search]);

  // Live-refresh when new mail arrives for this mailbox, so the list
  // updates without a manual reload.
  useEffect(() => {
    const channel = supabase
      .channel(`messages-for-${mailboxId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `mailbox_id=eq.${mailboxId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailboxId]);

  return (
    <div>
      <input
        className="search-input"
        placeholder="Search subject…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {loading && <p>Loading…</p>}
      {!loading && threads.length === 0 && <p className="muted">No threads yet.</p>}
      <ul className="thread-list">
        {threads.map((t) => {
          const correspondent = latest.get(t.id)?.correspondent ?? "?";
          return (
            <li key={t.id}>
              <Link to={`${basePath}/${t.id}`}>
                <Avatar label={correspondent} />
                <span className="thread-row-main">
                  <span className="thread-row-top">
                    <span className="thread-correspondent">{correspondent}</span>
                    <span className="thread-date">
                      {t.last_message_at ? new Date(t.last_message_at).toLocaleString() : ""}
                    </span>
                  </span>
                  <span className="thread-subject">{t.subject || "(no subject)"}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
