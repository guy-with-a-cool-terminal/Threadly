import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Avatar } from "./Avatar";
import type { Draft } from "../lib/types";

export function DraftList({
  mailboxId,
  version,
  onOpen,
}: {
  mailboxId: string;
  version: number;
  onOpen: (draft: Draft) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    supabase
      .from("drafts")
      .select("*")
      .eq("mailbox_id", mailboxId)
      .order("updated_at", { ascending: false })
      .then(({ data }) => {
        setDrafts((data as Draft[]) ?? []);
        setLoading(false);
      });
  }

  useEffect(load, [mailboxId, version]);

  async function handleDelete(id: string) {
    await supabase.from("drafts").delete().eq("id", id);
    load();
  }

  if (loading) return <p>Loading…</p>;
  if (drafts.length === 0) return <p className="muted">No drafts.</p>;

  return (
    <ul className="thread-list">
      {drafts.map((d) => {
        const recipient = d.to_addresses[0] ?? "(no recipient)";
        return (
          <li key={d.id} style={{ display: "flex", alignItems: "center" }}>
            <a
              href="#"
              style={{ flex: 1 }}
              onClick={(e) => {
                e.preventDefault();
                onOpen(d);
              }}
            >
              <Avatar label={recipient} />
              <span className="thread-row-main">
                <span className="thread-row-top">
                  <span className="thread-correspondent">{recipient}</span>
                  <span className="thread-date">{new Date(d.updated_at).toLocaleString()}</span>
                </span>
                <span className="thread-subject">{d.subject || "(no subject)"}</span>
              </span>
            </a>
            <button
              type="button"
              onClick={() => handleDelete(d.id)}
              style={{
                margin: "0 1rem",
                background: "transparent",
                color: "var(--danger)",
                borderColor: "var(--danger-soft)",
              }}
            >
              Delete
            </button>
          </li>
        );
      })}
    </ul>
  );
}
