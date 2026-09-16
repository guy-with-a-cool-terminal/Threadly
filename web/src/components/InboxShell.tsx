import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { AppHeader } from "./AppHeader";

export type Folder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";

const FOLDERS: { key: Folder; label: string; icon: string; query?: string }[] = [
  { key: "inbox", label: "Inbox", icon: "📥" },
  { key: "sent", label: "Sent", icon: "📤", query: "folder=sent" },
  { key: "drafts", label: "Drafts", icon: "📝", query: "folder=drafts" },
  { key: "archive", label: "Archive", icon: "🗄️", query: "folder=archive" },
  { key: "spam", label: "Spam", icon: "🚫", query: "folder=spam" },
  { key: "trash", label: "Trash", icon: "🗑️", query: "folder=trash" },
];

async function fetchUnreadCount(mailboxId: string): Promise<number> {
  const { count, error } = await supabase
    .from("threads")
    .select("*", { count: "exact", head: true })
    .eq("mailbox_id", mailboxId)
    .eq("is_read", false)
    .is("archived_at", null)
    .is("deleted_at", null)
    .eq("is_spam", false);
  if (error) throw error;
  return count ?? 0;
}

// Persistent app shell (top bar + sidebar) shared across every inbox view,
// so the sidebar never disappears when you open a message - only the main
// pane content changes. Folder nav are real links (?folder=sent etc.)
// rather than local component state, so the URL reflects what you're
// looking at (shareable, survives a refresh, back button works) the way a
// real mail client's does.
export function InboxShell({
  mailboxAddress,
  mailboxId,
  basePath,
  activeFolder,
  children,
}: {
  mailboxAddress: string;
  mailboxId: string;
  basePath: string;
  activeFolder?: Folder;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { data: unreadCount } = useQuery({
    queryKey: ["unread-count", mailboxId],
    queryFn: () => fetchUnreadCount(mailboxId),
  });

  // Keeps the sidebar badge live without a manual refresh whenever mail
  // arrives or a thread's read state changes anywhere in the app.
  useEffect(() => {
    const channel = supabase
      .channel(`unread-count-${mailboxId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "threads", filter: `mailbox_id=eq.${mailboxId}` },
        () => queryClient.invalidateQueries({ queryKey: ["unread-count", mailboxId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [mailboxId, queryClient]);

  return (
    <div className="page page-wide">
      <AppHeader mailboxAddress={mailboxAddress} />
      <div className="inbox-layout">
        <aside className="inbox-sidebar">
          <Link to={`${basePath}?compose=1`} className="compose-button">
            + Compose
          </Link>
          <nav className="folder-nav">
            {FOLDERS.map((f) => (
              <Link
                key={f.key}
                to={f.query ? `${basePath}?${f.query}` : basePath}
                className={activeFolder === f.key ? "folder-active" : ""}
              >
                <span className="folder-icon">{f.icon}</span>
                <span className="folder-label">{f.label}</span>
                {f.key === "inbox" && Boolean(unreadCount) && (
                  <span className="folder-badge">{unreadCount}</span>
                )}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="inbox-main">{children}</div>
      </div>
    </div>
  );
}
