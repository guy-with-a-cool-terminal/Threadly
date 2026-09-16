import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MailOpen } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";
import { ThreadList } from "../components/ThreadList";
import { SentList } from "../components/SentList";
import { DraftList } from "../components/DraftList";
import { ThreadDetail } from "../components/ThreadDetail";
import { Composer } from "../components/Composer";
import { InboxShell, type Folder } from "../components/InboxShell";
import type { Draft, Mailbox } from "../lib/types";

async function fetchMailboxById(id: string): Promise<Mailbox | null> {
  const { data, error } = await supabase.from("mailboxes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Mailbox) ?? null;
}

async function fetchDraftById(id: string): Promise<Draft | null> {
  const { data, error } = await supabase.from("drafts").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Draft) ?? null;
}

// The list (Inbox/Sent/Drafts/Archive/Spam/Trash) and the reading pane
// live in the same page, side by side, so opening a thread never hides
// the list - only the detail pane's content changes, driven entirely by
// URL search params (?folder=, ?thread=, ?compose=, ?draft=) so it's
// shareable and survives a refresh.
export function InboxPage() {
  const { mailboxId: routeMailboxId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { mailbox: ownMailbox, isAdmin, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const folder = (searchParams.get("folder") as Folder | null) ?? "inbox";
  const composing = searchParams.get("compose") === "1";
  const draftIdParam = searchParams.get("draft");
  const threadIdParam = searchParams.get("thread");

  const { data: routedMailbox, isLoading: mailboxLoading } = useQuery({
    queryKey: ["mailbox", routeMailboxId],
    queryFn: () => fetchMailboxById(routeMailboxId as string),
    enabled: Boolean(routeMailboxId),
  });

  const mailbox = routeMailboxId ? (routedMailbox ?? null) : ownMailbox;
  const lookupDone = routeMailboxId ? !mailboxLoading : !authLoading;

  const { data: editingDraft } = useQuery({
    queryKey: ["draft", draftIdParam],
    queryFn: () => fetchDraftById(draftIdParam as string),
    enabled: composing && Boolean(draftIdParam),
  });

  if (!lookupDone) return <div className="centered">Loading mailbox…</div>;

  if (!mailbox) {
    return (
      <div className="centered">
        <div className="login-card" style={{ maxWidth: 420 }}>
          <p>
            {routeMailboxId
              ? "That mailbox doesn't exist, or you don't have access to it."
              : "This login has no personal mailbox - it's admin-only."}
          </p>
          {isAdmin && (
            <Link to="/admin" className="back-link">
              Go to admin →
            </Link>
          )}
        </div>
      </div>
    );
  }

  const basePath = routeMailboxId ? `/admin/mailbox/${mailbox.id}/inbox` : "/inbox";

  function closeComposer() {
    setSearchParams(folder === "inbox" ? {} : { folder });
  }

  function openDraft(d: Draft) {
    queryClient.setQueryData(["draft", d.id], d);
    setSearchParams({ compose: "1", draft: d.id });
  }

  function closeThread() {
    setSearchParams(folder === "inbox" ? {} : { folder });
  }

  return (
    <InboxShell mailboxAddress={mailbox.address} mailboxId={mailbox.id} basePath={basePath} activeFolder={composing ? undefined : folder}>
      <div className="mail-split">
        <div className="mail-split-list">
          {folder === "sent" ? (
            <SentList mailboxId={mailbox.id} basePath={basePath} selectedThreadId={threadIdParam ?? undefined} />
          ) : folder === "drafts" ? (
            <DraftList mailboxId={mailbox.id} onOpen={openDraft} />
          ) : (
            <ThreadList
              mailboxId={mailbox.id}
              basePath={basePath}
              folder={folder}
              selectedThreadId={threadIdParam ?? undefined}
            />
          )}
        </div>
        <div className="mail-split-detail">
          {composing ? (
            <Composer
              mailboxId={mailbox.id}
              draft={draftIdParam ? (editingDraft ?? undefined) : undefined}
              signature={mailbox.signature}
              onSent={closeComposer}
              onDiscard={closeComposer}
            />
          ) : threadIdParam ? (
            <ThreadDetail
              mailboxId={mailbox.id}
              mailboxAddress={mailbox.address}
              threadId={threadIdParam}
              onClosed={closeThread}
            />
          ) : (
            <div className="mail-empty-state">
              <MailOpen className="mail-empty-icon" size={40} strokeWidth={1.5} />
              <p>No mail selected</p>
            </div>
          )}
        </div>
      </div>
    </InboxShell>
  );
}
