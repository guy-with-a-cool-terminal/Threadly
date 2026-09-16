import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { Avatar } from "./Avatar";
import type { Draft } from "../lib/types";

async function fetchDrafts(mailboxId: string): Promise<Draft[]> {
  const { data, error } = await supabase
    .from("drafts")
    .select("*")
    .eq("mailbox_id", mailboxId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as Draft[]) ?? [];
}

export function DraftList({
  mailboxId,
  onOpen,
}: {
  mailboxId: string;
  onOpen: (draft: Draft) => void;
}) {
  const queryClient = useQueryClient();
  const { data: drafts, isLoading } = useQuery({
    queryKey: ["drafts", mailboxId],
    queryFn: () => fetchDrafts(mailboxId),
  });

  const deleteDraft = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("drafts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drafts", mailboxId] }),
  });

  if (isLoading) return <p>Loading…</p>;
  if (!drafts || drafts.length === 0) return <p className="muted">No drafts.</p>;

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
              onClick={() => deleteDraft.mutate(d.id)}
              disabled={deleteDraft.isPending}
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
