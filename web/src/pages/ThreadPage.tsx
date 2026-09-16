import { Navigate, useParams } from "react-router-dom";

// Thread viewing now lives inline in InboxPage's split view (?thread=<id>)
// instead of a separate route, so the list stays visible while reading a
// message. This route is kept only as a redirect for any old bookmarked
// or externally-linked /inbox/:threadId URLs.
export function ThreadPage() {
  const { mailboxId, threadId } = useParams();
  const base = mailboxId ? `/admin/mailbox/${mailboxId}/inbox` : "/inbox";
  return <Navigate to={`${base}?thread=${threadId}`} replace />;
}
