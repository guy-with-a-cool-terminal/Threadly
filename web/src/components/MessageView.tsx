import DOMPurify from "dompurify";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
import { splitQuotedHtml, splitQuotedText } from "../lib/quoteSplit";
import { Avatar } from "./Avatar";
import type { Attachment, Message } from "../lib/types";

async function fetchAttachments(messageId: string): Promise<Attachment[]> {
  const { data, error } = await supabase.from("attachments").select("*").eq("message_id", messageId);
  if (error) throw error;
  return (data as Attachment[]) ?? [];
}

// A short preview shown on a collapsed message row, the way Gmail shows a
// one-line snippet for every message in a thread except the one you're
// actually reading.
function snippetFor(message: Message): string {
  const raw = message.body_text || (message.body_html ? message.body_html.replace(/<[^>]+>/g, " ") : "");
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > 100 ? `${collapsed.slice(0, 100)}…` : collapsed;
}

export function MessageView({
  message,
  expanded,
  onToggle,
}: {
  message: Message;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const avatarLabel = message.direction === "inbound" ? message.from_address : message.to_addresses[0] ?? "?";
  const sender = message.direction === "inbound" ? message.from_address : "You";

  const { data: attachments } = useQuery({
    queryKey: ["attachments", message.id],
    queryFn: () => fetchAttachments(message.id),
    enabled: expanded,
  });

  if (!expanded) {
    return (
      <button type="button" className="message-row-collapsed" onClick={onToggle}>
        <Avatar label={avatarLabel} />
        <span className="message-row-sender">{sender}</span>
        <span className="message-row-snippet">{snippetFor(message) || "(no content)"}</span>
        {message.status === "failed" && <span className="badge badge-failed">failed</span>}
        <span className="thread-date">{new Date(message.created_at).toLocaleDateString()}</span>
      </button>
    );
  }

  const isHtml = Boolean(message.body_html);
  const { main, quoted } = isHtml
    ? splitQuotedHtml(message.body_html as string)
    : splitQuotedText(message.body_text ?? "");

  return (
    <div className={`message message-${message.direction}`}>
      <button type="button" className="message-header" onClick={onToggle}>
        <Avatar label={avatarLabel} />
        <span className="message-header-main">
          <span className="message-header-top">
            <strong>{sender}</strong>
            {message.status === "failed" && <span className="badge badge-failed">failed to send</span>}
          </span>
          <span className="muted message-header-to">to {message.to_addresses.join(", ")}</span>
        </span>
        <span className="message-date muted">{new Date(message.created_at).toLocaleString()}</span>
      </button>

      {isHtml ? (
        // Email HTML is untrusted content from the open internet - always
        // sanitize before rendering.
        <div className="message-body" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(main) }} />
      ) : (
        <pre className="message-body message-body-text">{main}</pre>
      )}

      {quoted && (
        <div className="quote-block">
          <button type="button" className="quote-toggle" onClick={() => setShowQuoted((v) => !v)}>
            {showQuoted ? "Hide quoted text" : "•••"}
          </button>
          {showQuoted && (
            isHtml ? (
              <div
                className="message-body quoted-content"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(quoted) }}
              />
            ) : (
              <pre className="message-body message-body-text quoted-content">{quoted}</pre>
            )
          )}
        </div>
      )}

      {Boolean(attachments?.length) && (
        <div className="attachments">
          {attachments?.map((a) => (
            <AttachmentCard key={a.id} attachment={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function iconFor(contentType: string | null, fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (contentType === "application/pdf" || ext === "pdf") return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜️";
  return "📎";
}

async function fetchSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from("attachments").createSignedUrl(storagePath, 3600);
  if (error) return null;
  return data?.signedUrl ?? null;
}

function AttachmentCard({ attachment }: { attachment: Attachment }) {
  const isImage = attachment.content_type?.startsWith("image/") ?? false;

  const { data: signedUrl } = useQuery({
    queryKey: ["attachment-url", attachment.id],
    queryFn: () => fetchSignedUrl(attachment.storage_path),
    enabled: isImage,
    staleTime: 30 * 60_000,
  });

  async function open() {
    const url = signedUrl ?? (await fetchSignedUrl(attachment.storage_path));
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  if (isImage) {
    return (
      <button type="button" className="attachment-thumb" onClick={open} title={attachment.file_name}>
        {signedUrl ? (
          <img src={signedUrl} alt={attachment.file_name} />
        ) : (
          <span className="attachment-thumb-placeholder">🖼️</span>
        )}
        <span className="attachment-thumb-name">{attachment.file_name}</span>
      </button>
    );
  }

  return (
    <button type="button" className="attachment-card" onClick={open}>
      <span className="attachment-card-icon">{iconFor(attachment.content_type, attachment.file_name)}</span>
      <span className="attachment-card-main">
        <span className="attachment-card-name">{attachment.file_name}</span>
        {Boolean(attachment.size_bytes) && (
          <span className="attachment-card-size muted">{formatBytes(attachment.size_bytes)}</span>
        )}
      </span>
    </button>
  );
}
