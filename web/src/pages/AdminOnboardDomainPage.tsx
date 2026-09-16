import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import {
  addDomain,
  createResendAccount,
  listResendAccounts,
  setResendApiKey,
  type ResendAccountSummary,
} from "../lib/api";
import type { Client } from "../lib/types";

const STEPS = ["Client", "Resend account", "Domain"] as const;

async function fetchClients(): Promise<Client[]> {
  const { data, error } = await supabase.from("clients").select("*").order("name");
  if (error) throw error;
  return (data as Client[]) ?? [];
}

function ApiKeyInlineForm({ account, onSaved }: { account: ResendAccountSummary; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: () => setResendApiKey(account.label, value.trim()),
    onSuccess: () => {
      setValue("");
      onSaved();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <div className="provision-result" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
      <p className="muted" style={{ marginTop: 0 }}>
        On resend.com for <strong>{account.display_name}</strong>: API Keys → Create API Key → set
        permission to <strong>Full access</strong> (not Sending access) → paste it here. This also
        registers the inbound webhook and saves its signing secret automatically.
      </p>
      <form className="inline-input" onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="re_xxxxxxxxxxxx"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
        <button type="submit" disabled={save.isPending}>
          {save.isPending ? "Checking…" : "Save & continue"}
        </button>
      </form>
      {save.error && <p className="error">{save.error instanceof Error ? save.error.message : String(save.error)}</p>}
    </div>
  );
}

// One guided flow for everything that has to happen once per client
// domain: who it's for, which Resend account (and key) routes it, and the
// domain name itself. Replaces three separate pages (client picker, Resend
// account setup, domain form) that made this feel like unrelated stops
// instead of one task. Creating a mailbox afterwards is deliberately a
// separate, much simpler page - see AdminProvisionPage.
export function AdminOnboardDomainPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const [clientMode, setClientMode] = useState<"new" | "existing">("new");
  const [clientId, setClientId] = useState("");
  const [newClientName, setNewClientName] = useState("");

  const { data: resendAccounts } = useQuery({ queryKey: ["resend-accounts"], queryFn: listResendAccounts });
  const [accountLabel, setAccountLabel] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [newAccountLabel, setNewAccountLabel] = useState("");
  const [newAccountDisplayName, setNewAccountDisplayName] = useState("");

  const [domainName, setDomainName] = useState("");

  useEffect(() => {
    if (!accountLabel && resendAccounts?.length) {
      setAccountLabel(resendAccounts.find((a) => a.has_api_key)?.label ?? resendAccounts[0].label);
    }
  }, [resendAccounts, accountLabel]);

  const selectedAccount = resendAccounts?.find((a) => a.label === accountLabel);
  const accountReady = Boolean(selectedAccount?.has_api_key) && !creatingAccount;

  const reloadAccounts = () => queryClient.invalidateQueries({ queryKey: ["resend-accounts"] });

  const createAccount = useMutation({
    mutationFn: async () => {
      const label = newAccountLabel.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      await createResendAccount({ label, displayName: newAccountDisplayName.trim() });
      return label;
    },
    onSuccess: (label) => {
      setAccountLabel(label);
      setCreatingAccount(false);
      setNewAccountLabel("");
      setNewAccountDisplayName("");
      reloadAccounts();
    },
  });

  const finish = useMutation({
    mutationFn: () =>
      addDomain({
        clientId: clientMode === "existing" ? clientId : undefined,
        newClientName: clientMode === "new" ? newClientName.trim() : undefined,
        domainName: domainName.toLowerCase().trim(),
        resendAccountLabel: accountLabel,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    },
  });

  function reset() {
    setStep(0);
    setDomainName("");
    finish.reset();
  }

  return (
    <div className="page">
      <Link to="/admin" className="back-link">
        ← Back to admin
      </Link>
      <h1>Add a domain</h1>

      {finish.data ? (
        <div className="provision-result">
          <h2 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CheckCircle2 size={20} color="var(--accent)" />
            {domainName} {finish.data.alreadyRegistered ? "imported" : "registered"}
          </h2>
          <p>
            Domain status: <strong>{finish.data.domain.status}</strong>
            {finish.data.domain.status !== "verified" && " (add the DNS records below before mail will flow)."}
          </p>
          {Boolean(finish.data.domain.dns_records) && (
            <pre className="dns-records">{JSON.stringify(finish.data.domain.dns_records, null, 2)}</pre>
          )}
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            These records only cover sending. To receive mail on this domain, open it directly on
            resend.com, turn on the <strong>Receiving</strong> toggle, and add the extra MX record it
            gives you - replacing any existing MX record for this domain (e.g. a client's old host), not
            adding alongside it.
          </p>
          <div className="app-header-actions" style={{ marginLeft: 0, marginTop: "1rem" }}>
            <Link to="/admin/provision">Create a mailbox on this domain →</Link>
            <button type="button" onClick={reset}>
              Add another domain
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="wizard-steps">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={`wizard-step ${i === step ? "wizard-step-active" : i < step ? "wizard-step-done" : ""}`}
              >
                {i + 1}. {label}
              </div>
            ))}
          </div>

          {step === 0 && (
            <div className="provision-form">
              {Boolean(clients?.length) && (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    onClick={() => setClientMode("new")}
                    style={clientMode === "existing" ? { background: "transparent", color: "var(--text)", borderColor: "var(--border)" } : undefined}
                  >
                    New client
                  </button>
                  <button
                    type="button"
                    onClick={() => setClientMode("existing")}
                    style={clientMode === "new" ? { background: "transparent", color: "var(--text)", borderColor: "var(--border)" } : undefined}
                  >
                    Existing client
                  </button>
                </div>
              )}

              {clientMode === "new" ? (
                <label>
                  Client name
                  <input
                    autoFocus
                    placeholder="Acme Ltd"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                  />
                </label>
              ) : (
                <label>
                  Client
                  <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                    <option value="">Select a client…</option>
                    {clients?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <button
                type="button"
                onClick={() => setStep(1)}
                disabled={clientMode === "new" ? !newClientName.trim() : !clientId}
              >
                Continue
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="provision-form">
              {Boolean(resendAccounts?.length) && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {resendAccounts?.map((a) => (
                    <label key={a.label} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontWeight: 400 }}>
                      <input
                        type="radio"
                        name="account"
                        checked={accountLabel === a.label && !creatingAccount}
                        onChange={() => {
                          setAccountLabel(a.label);
                          setCreatingAccount(false);
                        }}
                      />
                      {a.display_name}
                      <span className={`status-pill ${a.has_api_key ? "status-active" : "status-suspended_admin"}`}>
                        {a.has_api_key ? "ready" : "needs API key"}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontWeight: 400 }}>
                <input type="radio" name="account" checked={creatingAccount} onChange={() => setCreatingAccount(true)} />
                + New Resend account
              </label>

              {creatingAccount && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", paddingLeft: "1.6rem" }}>
                  <input
                    placeholder="Label, e.g. resend_account_3"
                    value={newAccountLabel}
                    onChange={(e) => setNewAccountLabel(e.target.value)}
                  />
                  <input
                    placeholder="Display name, e.g. Client batch 3"
                    value={newAccountDisplayName}
                    onChange={(e) => setNewAccountDisplayName(e.target.value)}
                  />
                  {createAccount.error && (
                    <p className="error">
                      {createAccount.error instanceof Error ? createAccount.error.message : String(createAccount.error)}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => createAccount.mutate()}
                    disabled={createAccount.isPending || !newAccountLabel.trim() || !newAccountDisplayName.trim()}
                  >
                    {createAccount.isPending ? "Creating…" : "Create account"}
                  </button>
                </div>
              )}

              {selectedAccount && !selectedAccount.has_api_key && !creatingAccount && (
                <ApiKeyInlineForm account={selectedAccount} onSaved={reloadAccounts} />
              )}

              <div className="app-header-actions" style={{ marginLeft: 0 }}>
                <button type="button" onClick={() => setStep(0)} style={{ background: "transparent", color: "var(--text)", borderColor: "var(--border)" }}>
                  Back
                </button>
                <button type="button" onClick={() => setStep(2)} disabled={!accountReady}>
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="provision-form">
              <label>
                Domain
                <input
                  autoFocus
                  placeholder="clientdomain.com"
                  value={domainName}
                  onChange={(e) => setDomainName(e.target.value)}
                  required
                />
              </label>
              {finish.error && (
                <p className="error">{finish.error instanceof Error ? finish.error.message : String(finish.error)}</p>
              )}
              <div className="app-header-actions" style={{ marginLeft: 0 }}>
                <button type="button" onClick={() => setStep(1)} style={{ background: "transparent", color: "var(--text)", borderColor: "var(--border)" }}>
                  Back
                </button>
                <button type="button" onClick={() => finish.mutate()} disabled={finish.isPending || !domainName.trim()}>
                  {finish.isPending ? "Registering…" : "Finish"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
