import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/useAuth";

export function ProtectedRoute({ requireAdmin = false }: { requireAdmin?: boolean }) {
  const { loading, session, isAdmin } = useAuth();

  if (loading) return <div className="centered">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (requireAdmin && !isAdmin) return <Navigate to="/inbox" replace />;

  return <Outlet />;
}
