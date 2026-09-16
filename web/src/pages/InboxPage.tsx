import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";
import { ThreadList } from "../components/ThreadList";
import { SentList } from "../components/SentList";
import { DraftList } from "../components/DraftList";
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

// Renders either the logged-in client's own inbox (no :mailboxId in the
// route) or, for an admin browsing a specific client, that mailbox's inbox
// (route has :mailboxId). Same RLS-scoped queries serve both - an admin can
// read any mailbox's threads, an owner only their own.
export function InboxPage() {
  const { mailboxId: routeMailboxId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { mailbox: ownMailbox, isAdmin, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const folder = (searchParams.get("folder") as Folder | null) ?? "inbox";
  const composing = searchParams.get("compose") === "1";
  const draftIdParam = searchParams.get("draft");

  const { data: routedMailbox, isLoading: mailboxLoading } = useQuery({
    queryKey: ["mailbox", routeMailboxId],
    queryFn: () => fetchMailboxById(routeMailboxId as string),
    enabled: Boolean(routeMailboxId),
  });

  const mailbox = routeMailboxId ? (routedMailbox ?? null) : ownMailbox;
  const lookupDone = routeMailboxId ? !mailboxLoading : !authLoading;

  // openDraft seeds this same query key directly from the row DraftList
  // already fetched, so resuming a draft you just clicked doesn't wait on
  // a redundant refetch - only a direct URL/refresh with ?draft=<id> hits
  // the network.
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

  return (
    <InboxShell mailboxAddress={mailbox.address} basePath={basePath} activeFolder={composing ? undefined : folder}>
      {composing ? (
        <Composer
          mailboxId={mailbox.id}
          draft={draftIdParam ? (editingDraft ?? undefined) : undefined}
          onSent={closeComposer}
          onDiscard={closeComposer}
        />
      ) : (
        <>
          {folder === "inbox" && <ThreadList mailboxId={mailbox.id} basePath={basePath} />}
          {folder === "sent" && <SentList mailboxId={mailbox.id} basePath={basePath} />}
          {folder === "drafts" && <DraftList mailboxId={mailbox.id} onOpen={openDraft} />}
        </>
      )}
    </InboxShell>
  );
}
