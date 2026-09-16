import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createResendAccount,
  listResendAccounts,
  reconfigureResendWebhook,
  setResendApiKey,
  verifyResendApiKey,
  type ResendAccountSummary,
} from "../lib/api";

// Builds the webhook URL Resend needs for a given account label, from the
// same VITE_SUPABASE_URL the app already connects with. Shown for
// reference only - saving the API key registers this automatically, see
// manage-resend-accounts/index.ts's ensureWebhookConfigured().
function webhookUrlFor(label: string): string {
  const projectUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!projectUrl) return "(set VITE_SUPABASE_URL to see this)";
  const functionsHost = projectUrl.replace(".supabase.co", ".functions.supabase.co");
  return `${functionsHost}/inbound-email?account=${label}`;
}

function NewAccountForm({ onCreated }: { onCreated: () => void }) {
  const [label, setLabel] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await createResendAccount({ label: label.trim(), displayName: displayName.trim() });
      setLabel("");
      setDisplayName("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="provision-form" onSubmit={handleSubmit}>
      <label>
        Label (used internally, e.g. resend_account_3)
        <input
          placeholder="resend_account_3"
          value={label}
          onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
          required
        />
      </label>
      <label>
        Display name
        <input
          placeholder="Client batch 3"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Adding…" : "Add Resend account"}
      </button>
    </form>
  );
}

function KeyForm({
  placeholder,
  buttonLabel,
  onSave,
}: {
  placeholder: string;
  buttonLabel: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSave(value.trim());
      setValue("");
      setJustSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="inline-input" onSubmit={handleSubmit}>
      <input
        type="password"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setJustSaved(false);
        }}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? "Checking with Resend…" : justSaved ? "Saved ✓" : buttonLabel}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

function VerifyApiKeyButton({ label }: { label: string }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);

  async function handleClick() {
    setChecking(true);
    setResult(null);
    try {
      const outcome = await verifyResendApiKey(label);
      setResult(outcome);
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setChecking(false);
    }
  }

  return (
    <span>
      <button type="button" onClick={handleClick} disabled={checking}>
        {checking ? "Checking…" : "Verify with Resend"}
      </button>
      {result && (
        <span className={result.ok ? "status-pill status-active" : "status-pill status-suspended_admin"} style={{ marginLeft: "0.5rem" }}>
          {result.ok ? "Still valid" : `Invalid: ${result.error}`}
        </span>
      )}
    </span>
  );
}

function ReconfigureWebhookButton({ label, onChanged }: { label: string; onChanged: () => void }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setWorking(true);
    setError(null);
    try {
      await reconfigureResendWebhook(label);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <span>
      <button type="button" onClick={handleClick} disabled={working}>
        {working ? "Configuring…" : "Reconfigure webhook"}
      </button>
      {error && <span className="error" style={{ marginLeft: "0.5rem" }}>{error}</span>}
    </span>
  );
}

function AccountCard({ account, onChanged }: { account: ResendAccountSummary; onChanged: () => void }) {
  const complete = account.has_api_key && account.has_webhook_secret;
  const webhookUrl = webhookUrlFor(account.label);

  return (
    <div className="composer">
      <div className="app-header-actions" style={{ marginLeft: 0, flexWrap: "wrap" }}>
        <strong>{account.display_name}</strong>
        <span className="muted">{account.label}</span>
        <span className={`status-pill ${account.has_api_key ? "status-active" : "status-suspended_admin"}`}>
          API key {account.has_api_key ? `saved (…${account.api_key_last4})` : "missing"}
        </span>
        {account.has_api_key && <VerifyApiKeyButton label={account.label} />}
        <span className={`status-pill ${account.has_webhook_secret ? "status-active" : "status-suspended_admin"}`}>
          Webhook {account.has_webhook_secret ? `configured (…${account.webhook_secret_last4})` : "not configured"}
        </span>
        {account.has_api_key && <ReconfigureWebhookButton label={account.label} onChanged={onChanged} />}
      </div>

      <details open={!complete}>
        <summary style={{ cursor: "pointer", fontWeight: 600, margin: "0.75rem 0" }}>
          Setup instructions on resend.com
        </summary>
        <ol style={{ paddingLeft: "1.2rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <li>
            Log in to (or create) a Resend account for this batch of domains. The free tier caps at 3
            verified domains per account, hence multiple accounts.
          </li>
          <li>
            In that account, go to <strong>API Keys → Create API Key</strong> and set permission to{" "}
            <strong>Full access</strong>, not Sending access - this system needs to manage domains and
            read received emails, which a sending-only key can't do. Copy it and paste it below.
          </li>
          <li>
            That's it for the webhook - saving the key below automatically registers this endpoint on
            Resend, subscribed to <code>email.received</code>, and saves its signing secret. Nothing to
            create or copy by hand on resend.com's Webhooks page:
            <pre className="dns-records" style={{ marginTop: "0.4rem" }}>{webhookUrl}</pre>
          </li>
          <li>
            Add each client domain that should route through this account from{" "}
            <Link to="/admin/domains/new">Add domain</Link>, picking this account.
          </li>
          <li>
            <strong>Separately, per domain</strong> - domain verification only covers sending, and this
            step genuinely can't be automated (Resend only exposes it as a dashboard toggle). Open the
            domain's page directly on resend.com, turn on the <strong>Receiving</strong> toggle, and add
            the extra MX record it gives you. If the domain already has an MX record for another mail
            provider (e.g. a client's old host), replace it rather than adding alongside it - mail only
            goes to the lowest-priority MX record, so both can't be live at once.
          </li>
        </ol>
      </details>

      <div style={{ maxWidth: 420 }}>
        <KeyForm
          placeholder="re_xxxxxxxxxxxx (API key)"
          buttonLabel="Save, verify & configure webhook"
          onSave={async (v) => {
            await setResendApiKey(account.label, v);
            onChanged();
          }}
        />
      </div>
    </div>
  );
}

export function AdminResendAccountsPage() {
  const queryClient = useQueryClient();
  const { data: accounts, isSuccess } = useQuery({
    queryKey: ["resend-accounts"],
    queryFn: listResendAccounts,
  });
  const reload = () => queryClient.invalidateQueries({ queryKey: ["resend-accounts"] });

  return (
    <div className="page">
      <Link to="/admin" className="back-link">
        ← Back to admin
      </Link>
      <h1>Resend accounts</h1>
      <p className="muted" style={{ marginTop: "-0.5rem", marginBottom: "1.5rem" }}>
        Paste an API key and everything else on Resend's side happens automatically: it's checked
        against Resend before saving (a mistyped key is rejected immediately, not saved), and the
        inbound webhook is created and its signing secret captured for you - no separate webhook step.
        Keys are never shown again after saving; use "Verify with Resend" or "Reconfigure webhook" any
        time to re-check what's already saved. The one thing that can't be automated is enabling
        Receiving per domain - Resend only exposes that as a dashboard toggle.
      </p>

      {isSuccess && accounts.length === 0 && <p className="muted">No Resend accounts yet - add the first one below.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "2rem" }}>
        {accounts?.map((a) => (
          <AccountCard key={a.label} account={a} onChanged={reload} />
        ))}
      </div>

      <h2>Add a Resend account</h2>
      <NewAccountForm onCreated={reload} />
    </div>
  );
}
