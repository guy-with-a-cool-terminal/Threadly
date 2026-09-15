import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";
import { ThreadList } from "../components/ThreadList";
import { SentList } from "../components/SentList";
import { DraftList } from "../components/DraftList";
import { Composer } from "../components/Composer";
import { InboxShell, type Folder } from "../components/InboxShell";
import type { Draft, Mailbox } from "../lib/types";

// Renders either the logged-in client's own inbox (no :mailboxId in the
// route) or, for an admin browsing a specific client, that mailbox's inbox
// (route has :mailboxId). Same RLS-scoped queries serve both - an admin can
// read any mailbox's threads, an owner only their own.
export function InboxPage() {
  const { mailboxId: routeMailboxId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { mailbox: ownMailbox, isAdmin, loading: authLoading } = useAuth();
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [lookupDone, setLookupDone] = useState(false);
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [draftsVersion, setDraftsVersion] = useState(0);

  const folder = (searchParams.get("folder") as Folder | null) ?? "inbox";
  const composing = searchParams.get("compose") === "1";
  const draftIdParam = searchParams.get("draft");

  useEffect(() => {
    if (!routeMailboxId) {
      setMailbox(ownMailbox);
      setLookupDone(!authLoading);
      return;
    }
    setLookupDone(false);
    supabase
      .from("mailboxes")
      .select("*")
      .eq("id", routeMailboxId)
      .maybeSingle()
      .then(({ data }) => {
        setMailbox((data as Mailbox) ?? null);
        setLookupDone(true);
      });
  }, [routeMailboxId, ownMailbox, authLoading]);

  useEffect(() => {
    if (!composing || !draftIdParam) {
      setEditingDraft(null);
      return;
    }
    if (editingDraft?.id === draftIdParam) return;
    supabase
      .from("drafts")
      .select("*")
      .eq("id", draftIdParam)
      .maybeSingle()
      .then(({ data }) => setEditingDraft((data as Draft) ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composing, draftIdParam]);

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
    setDraftsVersion((v) => v + 1);
  }

  function openDraft(d: Draft) {
    setEditingDraft(d);
    setSearchParams({ compose: "1", draft: d.id });
  }

  return (
    <InboxShell mailboxAddress={mailbox.address} basePath={basePath} activeFolder={composing ? undefined : folder}>
      {composing ? (
        <Composer
          mailboxId={mailbox.id}
          draft={editingDraft ?? undefined}
          onSent={closeComposer}
          onDiscard={closeComposer}
          onSaved={() => setDraftsVersion((v) => v + 1)}
        />
      ) : (
        <>
          {folder === "inbox" && <ThreadList mailboxId={mailbox.id} basePath={basePath} />}
          {folder === "sent" && <SentList mailboxId={mailbox.id} basePath={basePath} />}
          {folder === "drafts" && (
            <DraftList mailboxId={mailbox.id} version={draftsVersion} onOpen={openDraft} />
          )}
        </>
      )}
    </InboxShell>
  );
}
