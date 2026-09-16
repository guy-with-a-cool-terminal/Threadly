import DOMPurify from "dompurify";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabaseClient";
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
      {message.body_html ? (
        // Email HTML is untrusted content from the open internet - always
        // sanitize before rendering.
        <div
          className="message-body"
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(message.body_html) }}
        />
      ) : (
        <pre className="message-body message-body-text">{message.body_text}</pre>
      )}
      {Boolean(attachments?.length) && (
        <div className="attachments">
          {attachments?.map((a) => (
            <AttachmentLink key={a.id} attachment={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentLink({ attachment }: { attachment: Attachment }) {
  async function open() {
    const { data, error } = await supabase.storage
      .from("attachments")
      .createSignedUrl(attachment.storage_path, 60);
    if (!error && data?.signedUrl) {
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <button type="button" className="attachment-chip" onClick={open}>
      📎 {attachment.file_name}
    </button>
  );
}
