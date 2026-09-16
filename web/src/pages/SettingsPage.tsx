import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";
import { updateMySignature } from "../lib/api";
import type { Mailbox } from "../lib/types";

async function fetchMailboxById(id: string): Promise<Mailbox | null> {
  const { data, error } = await supabase.from("mailboxes").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Mailbox) ?? null;
}

// Password + signature for the mailbox that's currently logged in. This
// reads the mailbox row through its own query (keyed on mailboxId) rather
// than through useAuth().mailbox directly - the auth context only reloads
// that row on sign-in or a token refresh, so a plain queryClient
// invalidation after saving the signature wouldn't reliably make this page
// (or a freshly opened one) show the new value. Querying it here keeps
// this page's own state correct regardless of when the auth context
// happens to refresh.
export function SettingsPage() {
  const { mailbox: ownMailbox } = useAuth();
  const mailboxId = ownMailbox?.id;
  const queryClient = useQueryClient();

  const { data: mailbox } = useQuery({
    queryKey: ["mailbox", mailboxId],
    queryFn: () => fetchMailboxById(mailboxId as string),
    enabled: Boolean(mailboxId),
    initialData: ownMailbox ?? undefined,
  });

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signature, setSignature] = useState(mailbox?.signature ?? "");

  // Only seed the textarea from the fetched row once it arrives - typing
  // shouldn't get clobbered by a background refetch resolving mid-edit.
  useEffect(() => {
    if (mailbox) setSignature(mailbox.signature ?? "");
  }, [mailbox?.signature]);

  const changePassword = useMutation({
    mutationFn: async () => {
      if (newPassword.length < 8) {
        throw new Error("Password must be at least 8 characters.");
      }
      if (newPassword !== confirmPassword) {
        throw new Error("Passwords don't match.");
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewPassword("");
      setConfirmPassword("");
    },
  });

  const saveSignature = useMutation({
    mutationFn: () => updateMySignature(signature || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox", mailboxId] });
    },
  });

  function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    changePassword.mutate();
  }

  function handleSignatureSubmit(e: FormEvent) {
    e.preventDefault();
    saveSignature.mutate();
  }

  return (
    <div className="page">
      <Link to="/inbox" className="back-link">
        ← Back to inbox
      </Link>
      <h1>Settings</h1>

      <h2>Change password</h2>
      <form className="provision-form" onSubmit={handlePasswordSubmit}>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </label>
        {changePassword.error && (
          <p className="error">
            {changePassword.error instanceof Error ? changePassword.error.message : String(changePassword.error)}
          </p>
        )}
        {changePassword.isSuccess && <p className="muted">Password updated.</p>}
        <button type="submit" disabled={changePassword.isPending}>
          {changePassword.isPending ? "Updating…" : "Update password"}
        </button>
      </form>

      <h2>Email signature</h2>
      <p className="muted" style={{ marginTop: "-0.5rem" }}>
        Appended to the bottom of new messages you send - not to replies or forwards.
      </p>
      <form className="provision-form" onSubmit={handleSignatureSubmit}>
        <label>
          Signature
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={5}
            placeholder={"Jane Doe\nSupport team"}
          />
        </label>
        {saveSignature.error && (
          <p className="error">
            {saveSignature.error instanceof Error ? saveSignature.error.message : String(saveSignature.error)}
          </p>
        )}
        {saveSignature.isSuccess && !saveSignature.isPending && <p className="muted">Signature saved.</p>}
        <button type="submit" disabled={saveSignature.isPending}>
          {saveSignature.isPending ? "Saving…" : "Save signature"}
        </button>
      </form>
    </div>
  );
}
