import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { Avatar } from "./Avatar";
import type { Message } from "../lib/types";

export function SentList({ mailboxId, basePath }: { mailboxId: string; basePath: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase
      .from("messages")
      .select("*")
      .eq("mailbox_id", mailboxId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setMessages((data as Message[]) ?? []);
        setLoading(false);
      });
  }, [mailboxId]);

  if (loading) return <p>Loading…</p>;
  if (messages.length === 0) return <p className="muted">No sent messages yet.</p>;

  return (
    <ul className="thread-list">
      {messages.map((m) => {
        const recipient = m.to_addresses[0] ?? "?";
        return (
          <li key={m.id}>
            <Link to={`${basePath}/${m.thread_id}`}>
              <Avatar label={recipient} />
              <span className="thread-row-main">
                <span className="thread-row-top">
                  <span className="thread-correspondent">{recipient}</span>
                  <span className="thread-date">{new Date(m.created_at).toLocaleString()}</span>
                </span>
                <span className="thread-subject">
                  {m.subject || "(no subject)"}
                  {m.status === "failed" && (
                    <span className="badge badge-failed" style={{ marginLeft: "0.5rem" }}>
                      failed
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
