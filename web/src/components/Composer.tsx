import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Reply, Forward, Save, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { sendEmail, fileToBase64 } from "../lib/api";
import type { Draft } from "../lib/types";

function splitAddresses(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

// Drafts only apply to a non-reply compose (fresh message or a forward) -
// replying within a thread keeps working exactly as before, send-only.
// Resuming a draft reply would need the thread's current last message to
// reply against, which the Drafts list (on InboxPage, outside any thread
// context) doesn't have.
export function Composer({
  mailboxId,
  defaultTo,
  defaultCc,
  defaultSubject,
  inReplyToMessageId,
  forwardBody,
  draft,
  signature,
  onSent,
  onSaved,
  onDiscard,
  onForward,
}: {
  mailboxId: string;
  defaultTo?: string;
  defaultCc?: string;
  defaultSubject?: string;
  inReplyToMessageId?: string;
  forwardBody?: string;
  draft?: Draft;
  signature?: string | null;
  onSent?: () => void;
  onSaved?: () => void;
  onDiscard?: () => void;
  onForward?: () => void;
}) {
  const isReply = Boolean(inReplyToMessageId);
  const isForward = forwardBody !== undefined;
  const queryClient = useQueryClient();
  const [draftId, setDraftId] = useState<string | undefined>(draft?.id);
  const [to, setTo] = useState(draft ? draft.to_addresses.join(", ") : defaultTo ?? "");
  const [cc, setCc] = useState(draft?.cc_addresses?.join(", ") ?? defaultCc ?? "");
  const [bcc, setBcc] = useState(draft?.bcc_addresses?.join(", ") ?? "");
  const [showCcBcc, setShowCcBcc] = useState(Boolean(defaultCc || draft?.cc_addresses?.length || draft?.bcc_addresses?.length));
  const [subject, setSubject] = useState(draft?.subject ?? defaultSubject ?? "");
  // A brand new send (not a reply, not a forward, not a resumed draft that
  // already has body content) gets the mailbox's signature prefilled below
  // the cursor's starting point, plain-text-client style ("-- " delimiter
  // line). A resumed draft keeps exactly what was saved, and a reply/
  // forward never gets one auto-appended - see Composer's usage sites.
  const [body, setBody] = useState(() => {
    if (draft?.body_text) return draft.body_text;
    if (isForward) return `\n\n---------- Forwarded message ----------\n${forwardBody}`;
    if (!isReply && signature) return `\n\n-- \n${signature}`;
    return "";
  });
  const [files, setFiles] = useState<File[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const invalidateDrafts = () => queryClient.invalidateQueries({ queryKey: ["drafts", mailboxId] });

  const send = useMutation({
    mutationFn: async () => {
      const attachments = await Promise.all(
        files.map(async (f) => ({
          fileName: f.name,
          contentType: f.type || undefined,
          contentBase64: await fileToBase64(f),
        })),
      );
      await sendEmail({
        mailboxId,
        to: splitAddresses(to),
        cc: splitAddresses(cc),
        bcc: splitAddresses(bcc),
        subject,
        text: body,
        inReplyToMessageId,
        attachments: attachments.length ? attachments : undefined,
      });
      if (draftId) {
        await supabase.from("drafts").delete().eq("id", draftId);
      }
    },
    onSuccess: () => {
      setBody("");
      setFiles([]);
      if (!isReply) {
        setTo("");
        setCc("");
        setBcc("");
        setSubject("");
      }
      setDraftId(undefined);
      invalidateDrafts();
      queryClient.invalidateQueries({ queryKey: ["threads", mailboxId] });
      queryClient.invalidateQueries({ queryKey: ["sent-messages", mailboxId] });
      onSent?.();
    },
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      const payload = {
        mailbox_id: mailboxId,
        to_addresses: splitAddresses(to),
        cc_addresses: splitAddresses(cc),
        bcc_addresses: splitAddresses(bcc),
        subject: subject || null,
        body_text: body || null,
        updated_at: new Date().toISOString(),
      };
      if (draftId) {
        const { error } = await supabase.from("drafts").update(payload).eq("id", draftId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("drafts").insert(payload).select("id").single();
        if (error) throw error;
        setDraftId(data.id as string);
      }
    },
    onSuccess: () => {
      setSavedAt(new Date().toLocaleTimeString());
      invalidateDrafts();
      onSaved?.();
    },
  });

  const discard = useMutation({
    mutationFn: async () => {
      if (draftId) {
        await supabase.from("drafts").delete().eq("id", draftId);
      }
    },
    onSuccess: () => {
      invalidateDrafts();
      onDiscard?.();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    send.mutate();
  }

  const error = send.error ?? saveDraft.error ?? discard.error;
  const canSaveOrDiscard = !isReply;

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <input placeholder="To (comma-separated)" value={to} onChange={(e) => setTo(e.target.value)} required />
      {showCcBcc ? (
        <>
          <input placeholder="Cc (comma-separated)" value={cc} onChange={(e) => setCc(e.target.value)} />
          <input placeholder="Bcc (comma-separated)" value={bcc} onChange={(e) => setBcc(e.target.value)} />
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowCcBcc(true)}
          style={{ alignSelf: "flex-start", background: "transparent", color: "var(--muted)", border: "none", padding: 0, fontWeight: 500 }}
        >
          Add Cc/Bcc
        </button>
      )}
      <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
      <textarea
        placeholder="Write a message…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        required
      />
      <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
      {error && <p className="error">{error instanceof Error ? error.message : String(error)}</p>}
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" disabled={send.isPending} className="icon-label-button">
          {isReply ? <Reply size={16} /> : isForward ? <Forward size={16} /> : <Send size={16} />}
          {send.isPending ? "Sending…" : isReply ? "Reply" : isForward ? "Forward" : "Send"}
        </button>
        {isReply && onForward && (
          <button
            type="button"
            className="icon-button"
            title="Forward"
            aria-label="Forward"
            onClick={onForward}
          >
            <Forward size={18} />
          </button>
        )}
        {canSaveOrDiscard && (
          <>
            <button
              type="button"
              onClick={() => saveDraft.mutate()}
              disabled={saveDraft.isPending}
              className="icon-label-button"
              style={{ background: "transparent", color: "var(--text)", borderColor: "var(--border)" }}
            >
              <Save size={15} />
              {saveDraft.isPending ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={() => discard.mutate()}
              disabled={discard.isPending}
              className="icon-label-button"
              style={{ background: "transparent", color: "var(--danger)", borderColor: "var(--danger-soft)" }}
            >
              <Trash2 size={15} />
              Discard
            </button>
            {savedAt && <span className="muted">Saved {savedAt}</span>}
          </>
        )}
      </div>
    </form>
  );
}
