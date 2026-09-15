import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";
import { sendEmail, fileToBase64 } from "../lib/api";
import type { Draft } from "../lib/types";

// Drafts only apply to a fresh compose (no inReplyToMessageId) - replying
// within a thread keeps working exactly as before, send-only. Resuming a
// draft reply would need the thread's current last message to reply
// against, which the Drafts list (on InboxPage, outside any thread
// context) doesn't have; fresh outbound drafts are also the actual
// "unsent new message" case a Drafts folder is for.
export function Composer({
  mailboxId,
  defaultTo,
  defaultSubject,
  inReplyToMessageId,
  draft,
  onSent,
  onSaved,
  onDiscard,
}: {
  mailboxId: string;
  defaultTo?: string;
  defaultSubject?: string;
  inReplyToMessageId?: string;
  draft?: Draft;
  onSent?: () => void;
  onSaved?: () => void;
  onDiscard?: () => void;
}) {
  const isReply = Boolean(inReplyToMessageId);
  const [draftId, setDraftId] = useState<string | undefined>(draft?.id);
  const [to, setTo] = useState(draft ? draft.to_addresses.join(", ") : defaultTo ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? defaultSubject ?? "");
  const [body, setBody] = useState(draft?.body_text ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const attachments = await Promise.all(
        files.map(async (f) => ({
          fileName: f.name,
          contentType: f.type || undefined,
          contentBase64: await fileToBase64(f),
        })),
      );
      await sendEmail({
        mailboxId,
        to: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject,
        text: body,
        inReplyToMessageId,
        attachments: attachments.length ? attachments : undefined,
      });
      if (draftId) {
        await supabase.from("drafts").delete().eq("id", draftId);
      }
      setBody("");
      setFiles([]);
      if (!isReply) {
        setTo("");
        setSubject("");
      }
      setDraftId(undefined);
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function handleSaveDraft() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        mailbox_id: mailboxId,
        to_addresses: to.split(",").map((s) => s.trim()).filter(Boolean),
        subject: subject || null,
        body_text: body || null,
        updated_at: new Date().toISOString(),
      };
      if (draftId) {
        const { error: updateError } = await supabase.from("drafts").update(payload).eq("id", draftId);
        if (updateError) throw updateError;
      } else {
        const { data, error: insertError } = await supabase
          .from("drafts")
          .insert(payload)
          .select("id")
          .single();
        if (insertError) throw insertError;
        setDraftId(data.id as string);
      }
      setSavedAt(new Date().toLocaleTimeString());
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscard() {
    if (draftId) {
      await supabase.from("drafts").delete().eq("id", draftId);
    }
    onDiscard?.();
  }

  return (
    <form className="composer" onSubmit={handleSend}>
      {!isReply && (
        <>
          <input placeholder="To (comma-separated)" value={to} onChange={(e) => setTo(e.target.value)} required />
          <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </>
      )}
      <textarea
        placeholder="Write a message…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        required
      />
      <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      {error && <p className="error">{error}</p>}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button type="submit" disabled={sending}>
          {sending ? "Sending…" : isReply ? "Reply" : "Send"}
        </button>
        {!isReply && (
          <>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saving}
              style={{ background: "transparent", color: "var(--text)", borderColor: "var(--border)" }}
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              style={{ background: "transparent", color: "var(--danger)", borderColor: "var(--danger-soft)" }}
            >
              Discard
            </button>
            {savedAt && <span className="muted">Saved {savedAt}</span>}
          </>
        )}
      </div>
    </form>
  );
}
