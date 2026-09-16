import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../lib/useAuth";
import { grantAdmin, listAdmins, revokeAdmin } from "../lib/api";

export function AdminAdminsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  const { data: admins } = useQuery({ queryKey: ["admins"], queryFn: listAdmins });

  const grant = useMutation({
    mutationFn: (email: string) => grantAdmin(email),
    onSuccess: () => {
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["admins"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (authUserId: string) => revokeAdmin(authUserId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admins"] }),
  });

  function handleGrant(e: FormEvent) {
    e.preventDefault();
    grant.mutate(email.trim());
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
          {admins?.map((a) => (
            <tr key={a.auth_user_id}>
              <td>{a.email}</td>
              <td className="muted">{new Date(a.created_at).toLocaleDateString()}</td>
              <td>
                {a.auth_user_id !== user?.id && admins.length > 1 && (
                  <button type="button" onClick={() => revoke.mutate(a.auth_user_id)} disabled={revoke.isPending}>
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
        {(grant.error || revoke.error) && (
          <p className="error">
            {grant.error instanceof Error ? grant.error.message : revoke.error instanceof Error ? revoke.error.message : ""}
          </p>
        )}
        <button type="submit" disabled={grant.isPending}>
          {grant.isPending ? "Granting…" : "Grant admin"}
        </button>
      </form>
    </div>
  );
}
