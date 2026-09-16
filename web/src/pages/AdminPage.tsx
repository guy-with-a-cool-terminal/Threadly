import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";
import { Logo } from "../components/Logo";
import type { Client, Domain, Mailbox } from "../lib/types";

async function fetchAdminOverview() {
  const [c, d, m] = await Promise.all([
    supabase.from("clients").select("*").order("name"),
    supabase.from("domains").select("*").order("domain_name"),
    supabase.from("mailboxes").select("*").order("address"),
  ]);
  if (c.error) throw c.error;
  if (d.error) throw d.error;
  if (m.error) throw m.error;
  return {
    clients: (c.data as Client[]) ?? [],
    domains: (d.data as Domain[]) ?? [],
    mailboxes: (m.data as Mailbox[]) ?? [],
  };
}

function FeeCell({ mailbox }: { mailbox: Mailbox }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(mailbox.monthly_fee_kes);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("mailboxes").update({ monthly_fee_kes: value }).eq("id", mailbox.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
      setEditing(false);
    },
  });

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(mailbox.monthly_fee_kes);
          setEditing(true);
        }}
        style={{ background: "transparent", color: "var(--text)", border: "none", padding: 0, cursor: "pointer" }}
        title="Edit fee"
      >
        {mailbox.monthly_fee_kes} <span className="muted">✎</span>
      </button>
    );
  }

  return (
    <div className="inline-input">
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        style={{ width: "5.5rem" }}
        autoFocus
      />
      <button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
        {save.isPending ? "…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={save.isPending}>
        Cancel
      </button>
    </div>
  );
}

export function AdminPage() {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [statusPending, setStatusPending] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["admin-overview"], queryFn: fetchAdminOverview });
  const clients = data?.clients ?? [];
  const domains = data?.domains ?? [];
  const mailboxes = data?.mailboxes ?? [];

  async function toggleStatus(m: Mailbox) {
    const nextStatus = m.status === "active" ? "suspended_admin" : "active";
    setStatusPending(m.id);
    const { error } = await supabase.from("mailboxes").update({ status: nextStatus }).eq("id", m.id);
    setStatusPending(null);
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    }
  }

  return (
    <div className="page">
      <header className="app-header">
        <span className="app-header-title">
          <Logo compact />
        </span>
        <span className="admin-tag">Admin</span>
        <span className="muted">{user?.email}</span>
        <div className="app-header-actions">
          <Link to="/inbox">My inbox</Link>
          <Link to="/admin/domains/new">+ Add domain</Link>
          <Link to="/admin/provision">+ New mailbox</Link>
          <Link to="/admin/resend">Resend accounts</Link>
          <Link to="/admin/admins">Admins</Link>
          <button type="button" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <section>
        <h2>Mailboxes ({mailboxes.length})</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Status</th>
              <th>Fee (KES)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mailboxes.map((m) => (
              <tr key={m.id}>
                <td>{m.address}</td>
                <td>
                  <span className={`status-pill status-${m.status}`}>{m.status}</span>
                </td>
                <td>
                  <FeeCell mailbox={m} />
                </td>
                <td className="app-header-actions" style={{ marginLeft: 0, gap: "0.6rem" }}>
                  <Link to={`/admin/mailbox/${m.id}/inbox`}>View inbox</Link>
                  <button type="button" onClick={() => toggleStatus(m)} disabled={statusPending === m.id}>
                    {statusPending === m.id ? "…" : m.status === "active" ? "Suspend" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Domains ({domains.length})</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Resend account</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.id}>
                <td>{d.domain_name}</td>
                <td>{d.resend_account_label}</td>
                <td>{d.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Clients ({clients.length})</h2>
        <ul>
          {clients.map((c) => (
            <li key={c.id}>{c.name}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
