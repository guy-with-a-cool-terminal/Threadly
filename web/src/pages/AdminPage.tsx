import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";
import { Logo } from "../components/Logo";
import { Segmented } from "../components/Segmented";
import { formatDate, nextMonthlyRenewal } from "../lib/format";
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
        {mailbox.monthly_fee_kes} <Pencil className="muted" size={12} style={{ verticalAlign: "-1px" }} />
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

type Tab = "mailboxes" | "domains" | "clients";
type RenewalView = "all" | "week" | "month" | "suspended";

const DAY_MS = 86_400_000;

function daysUntil(date: Date): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / DAY_MS);
}

function dueLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function dueGroup(m: Mailbox, days: number): string {
  if (m.status !== "active") return "Suspended";
  if (days <= 7) return "Due this week";
  if (days <= 30) return "Due this month";
  return "Later";
}

export function AdminPage() {
  const { user, signOut } = useAuth();
  const queryClient = useQueryClient();
  const [statusPending, setStatusPending] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("mailboxes");
  const [renewalView, setRenewalView] = useState<RenewalView>("all");

  const { data } = useQuery({ queryKey: ["admin-overview"], queryFn: fetchAdminOverview });
  const clients = data?.clients ?? [];
  const domains = data?.domains ?? [];
  const mailboxes = data?.mailboxes ?? [];

  const rows = mailboxes
    .map((m) => {
      const renewal = nextMonthlyRenewal(m.created_at);
      return { m, renewal, days: daysUntil(renewal) };
    })
    .sort((a, b) => a.renewal.getTime() - b.renewal.getTime());
  const activeRows = rows.filter((r) => r.m.status === "active");
  const counts = {
    all: rows.length,
    week: activeRows.filter((r) => r.days <= 7).length,
    month: activeRows.filter((r) => r.days <= 30).length,
    suspended: rows.length - activeRows.length,
  };
  const visibleRows = rows.filter((r) =>
    renewalView === "week"
      ? r.m.status === "active" && r.days <= 7
      : renewalView === "month"
        ? r.m.status === "active" && r.days <= 30
        : renewalView === "suspended"
          ? r.m.status !== "active"
          : true,
  );

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

      <div className="tab-row">
        <Segmented
          label="Admin sections"
          value={tab}
          onChange={setTab}
          options={[
            { value: "mailboxes", label: "Mailboxes", count: mailboxes.length },
            { value: "domains", label: "Domains", count: domains.length },
            { value: "clients", label: "Clients", count: clients.length },
          ]}
        />
      </div>

      {tab === "mailboxes" && (
      <section>
        <div className="tab-row">
          <Segmented
            small
            label="Renewal filter"
            value={renewalView}
            onChange={setRenewalView}
            options={[
              { value: "all", label: "All", count: counts.all },
              { value: "week", label: "Due this week", count: counts.week },
              { value: "month", label: "Due in 30 days", count: counts.month },
              { value: "suspended", label: "Suspended", count: counts.suspended },
            ]}
          />
        </div>
        {visibleRows.length === 0 && <p className="muted">Nothing here.</p>}
        {visibleRows.length > 0 && (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Status</th>
              <th>Fee (KES)</th>
              <th>Created</th>
              <th>Next renewal</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(({ m, renewal, days }, i) => {
              const group = dueGroup(m, days);
              const showGroup = renewalView === "all" && (i === 0 || dueGroup(visibleRows[i - 1].m, visibleRows[i - 1].days) !== group);
              return (
                <Fragment key={m.id}>
                  {showGroup && (
                    <tr className="admin-group-row">
                      <td colSpan={6}>{group}</td>
                    </tr>
                  )}
                  <tr>
                    <td>{m.address}</td>
                    <td>
                      <span className={`status-pill status-${m.status}`}>{m.status}</span>
                    </td>
                    <td>
                      <FeeCell mailbox={m} />
                    </td>
                    <td>{formatDate(m.created_at)}</td>
                    <td>
                      {m.status === "active" ? (
                        <span className={days <= 7 ? "due-soon" : undefined}>
                          {formatDate(renewal.toISOString())} <span className="muted">({dueLabel(days)})</span>
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="app-header-actions" style={{ marginLeft: 0, gap: "0.6rem" }}>
                      <Link to={`/admin/mailbox/${m.id}/inbox`}>View inbox</Link>
                      <button type="button" onClick={() => toggleStatus(m)} disabled={statusPending === m.id}>
                        {statusPending === m.id ? "…" : m.status === "active" ? "Suspend" : "Reactivate"}
                      </button>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
        )}
      </section>
      )}

      {tab === "domains" && (
      <section>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Resend account</th>
              <th>Status</th>
              <th>Onboarded</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.id}>
                <td>{d.domain_name}</td>
                <td>{d.resend_account_label}</td>
                <td>{d.status}</td>
                <td>{formatDate(d.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      )}

      {tab === "clients" && (
      <section>
        <ul>
          {clients.map((c) => (
            <li key={c.id}>{c.name}</li>
          ))}
        </ul>
      </section>
      )}
    </div>
  );
}
