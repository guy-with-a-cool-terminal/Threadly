import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, Send, FileText, Archive, Ban, Trash2, SquarePen } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { formatBytes } from "../lib/format";
import { AppHeader } from "./AppHeader";

export type Folder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";

const FOLDERS: { key: Folder; label: string; icon: typeof InboxIcon; query?: string }[] = [
  { key: "inbox", label: "Inbox", icon: InboxIcon },
  { key: "sent", label: "Sent", icon: Send, query: "folder=sent" },
  { key: "drafts", label: "Drafts", icon: FileText, query: "folder=drafts" },
  { key: "archive", label: "Archive", icon: Archive, query: "folder=archive" },
  { key: "spam", label: "Spam", icon: Ban, query: "folder=spam" },
  { key: "trash", label: "Trash", icon: Trash2, query: "folder=trash" },
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

async function fetchStorageUsed(mailboxId: string): Promise<number> {
  const { data, error } = await supabase.from("attachments").select("size_bytes").eq("mailbox_id", mailboxId);
  if (error) throw error;
  return (data ?? []).reduce((sum, a) => sum + (a.size_bytes ?? 0), 0);
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
  const { data: storageUsed } = useQuery({
    queryKey: ["storage-used", mailboxId],
    queryFn: () => fetchStorageUsed(mailboxId),
    staleTime: 5 * 60_000,
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

  // Tab title badge, the way a real mail client makes unread count visible
  // even when the tab isn't focused. Reset to the plain title on unmount
  // so leaving the inbox (e.g. to Admin) doesn't leave a stale count.
  useEffect(() => {
    document.title = unreadCount ? `(${unreadCount}) Threadly` : "Threadly";
    return () => {
      document.title = "Threadly";
    };
  }, [unreadCount]);

  return (
    <div className="page page-wide">
      <AppHeader mailboxAddress={mailboxAddress} />
      <div className="inbox-layout">
        <aside className="inbox-sidebar">
          <Link to={`${basePath}?compose=1`} className="compose-button">
            <SquarePen size={16} strokeWidth={2.2} />
            Compose
          </Link>
          <nav className="folder-nav">
            {FOLDERS.map((f) => (
              <Link
                key={f.key}
                to={f.query ? `${basePath}?${f.query}` : basePath}
                className={activeFolder === f.key ? "folder-active" : ""}
              >
                <f.icon className="folder-icon" size={17} strokeWidth={2} />
                <span className="folder-label">{f.label}</span>
                {f.key === "inbox" && Boolean(unreadCount) && (
                  <span className="folder-badge">{unreadCount}</span>
                )}
              </Link>
            ))}
          </nav>
          {storageUsed !== undefined && (
            <div className="storage-footer">
              <span className="muted">{formatBytes(storageUsed)} used</span>
            </div>
          )}
        </aside>
        <div className="inbox-main">{children}</div>
      </div>
    </div>
  );
}
