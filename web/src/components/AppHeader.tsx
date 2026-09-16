import { Link } from "react-router-dom";
import { useAuth } from "../lib/useAuth";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export function AppHeader({ mailboxAddress }: { mailboxAddress: string }) {
  const { isAdmin, signOut } = useAuth();
  return (
    <header className="app-header">
      <Link to="/inbox" className="app-header-title">
        <Logo compact />
      </Link>
      <span className="muted">{mailboxAddress}</span>
      <div className="app-header-actions">
        {isAdmin && <Link to="/admin">Admin</Link>}
        <ThemeToggle />
        <button type="button" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </header>
  );
}
