import { Navigate, Route, Routes } from "react-router-dom";
import { isSupabaseConfigured } from "./lib/supabaseClient";
import { AuthProvider, useAuth } from "./lib/useAuth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { InboxPage } from "./pages/InboxPage";
import { ThreadPage } from "./pages/ThreadPage";
import { AdminPage } from "./pages/AdminPage";
import { AdminProvisionPage } from "./pages/AdminProvisionPage";
import { AdminOnboardDomainPage } from "./pages/AdminOnboardDomainPage";
import { AdminResendAccountsPage } from "./pages/AdminResendAccountsPage";
import { AdminAdminsPage } from "./pages/AdminAdminsPage";
import { MissingConfigScreen } from "./pages/MissingConfigScreen";

// Where "/" and any unmatched path should land, based on what kind of
// account is signed in. A plain mailbox user goes to their inbox; an
// admin-only account (no mailboxes row of their own - admins are
// cross-client, not tied to one inbox) goes to the admin view instead,
// since sending them to /inbox would just hang waiting for a mailbox that
// will never load.
function RootRedirect() {
  const { loading, session, mailbox, isAdmin } = useAuth();
  if (loading) return <div className="centered">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (mailbox) return <Navigate to="/inbox" replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  return <Navigate to="/inbox" replace />;
}

export function App() {
  if (!isSupabaseConfigured) {
    return <MissingConfigScreen />;
  }

  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/inbox/:threadId" element={<ThreadPage />} />
        </Route>

        <Route element={<ProtectedRoute requireAdmin />}>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/provision" element={<AdminProvisionPage />} />
          <Route path="/admin/domains/new" element={<AdminOnboardDomainPage />} />
          <Route path="/admin/resend" element={<AdminResendAccountsPage />} />
          <Route path="/admin/admins" element={<AdminAdminsPage />} />
          <Route path="/admin/mailbox/:mailboxId/inbox" element={<InboxPage />} />
          <Route path="/admin/mailbox/:mailboxId/inbox/:threadId" element={<ThreadPage />} />
        </Route>

        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
    </AuthProvider>
  );
}
