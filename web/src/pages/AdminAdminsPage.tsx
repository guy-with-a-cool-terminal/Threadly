import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/useAuth";
import { grantAdmin, listAdmins, revokeAdmin, type AdminSummary } from "../lib/api";

export function AdminAdminsPage() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<AdminSummary[]>([]);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    listAdmins().then(setAdmins);
  }

  useEffect(reload, []);

  async function handleGrant(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await grantAdmin(email.trim());
      setEmail("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(authUserId: string) {
    setError(null);
    try {
      await revokeAdmin(authUserId);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page">
      <Link to="/admin" className="back-link">
        ← Back to admin
      </Link>
      <h1>Admins</h1>
      <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "1.5rem" }}>
        Admins can see every client, provision mailboxes, and manage Resend accounts. Grant it only to
        people who need cross-client access - a mailbox login on its own can't see anything outside its
        own inbox.
      </p>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Since</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {admins.map((a) => (
            <tr key={a.auth_user_id}>
              <td>{a.email}</td>
              <td className="muted">{new Date(a.created_at).toLocaleDateString()}</td>
              <td>
                {a.auth_user_id !== user?.id && admins.length > 1 && (
                  <button type="button" onClick={() => handleRevoke(a.auth_user_id)}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Grant admin access</h2>
      <p className="muted" style={{ marginTop: "-0.5rem" }}>
        The person needs an existing login already (a mailbox or an Auth user created for them) - this
        doesn't create one.
      </p>
      <form className="provision-form" onSubmit={handleGrant}>
        <label>
          Email
          <input
            type="email"
            placeholder="teammate@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Granting…" : "Grant admin"}
        </button>
      </form>
    </div>
  );
}
