import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "./AppHeader";

export type Folder = "inbox" | "sent" | "drafts";

// Persistent app shell (top bar + sidebar) shared by InboxPage and
// ThreadPage, so the sidebar never disappears when you open a message -
// only the main pane content changes. Folder nav are real links
// (?folder=sent etc.) rather than local component state, so the URL
// reflects what you're looking at (shareable, survives a refresh, back
// button works) the way a real mail client's does.
export function InboxShell({
  mailboxAddress,
  basePath,
  activeFolder,
  children,
}: {
  mailboxAddress: string;
  basePath: string;
  activeFolder?: Folder;
  children: ReactNode;
}) {
  return (
    <div className="page page-wide">
      <AppHeader mailboxAddress={mailboxAddress} />
      <div className="inbox-layout">
        <aside className="inbox-sidebar">
          <Link to={`${basePath}?compose=1`} className="compose-button">
            + Compose
          </Link>
          <nav className="folder-nav">
            <Link to={basePath} className={activeFolder === "inbox" ? "folder-active" : ""}>
              Inbox
            </Link>
            <Link to={`${basePath}?folder=sent`} className={activeFolder === "sent" ? "folder-active" : ""}>
              Sent
            </Link>
            <Link to={`${basePath}?folder=drafts`} className={activeFolder === "drafts" ? "folder-active" : ""}>
              Drafts
            </Link>
          </nav>
        </aside>
        <div className="inbox-main">{children}</div>
      </div>
    </div>
  );
}
