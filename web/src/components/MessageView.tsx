import DOMPurify from "dompurify";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Attachment, Message } from "../lib/types";

export function MessageView({ message }: { message: Message }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    let active = true;
    supabase
      .from("attachments")
      .select("*")
      .eq("message_id", message.id)
      .then(({ data }) => {
        if (active) setAttachments((data as Attachment[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, [message.id]);

  return (
    <div className={`message message-${message.direction}`}>
      <div className="message-meta">
        <strong>{message.direction === "inbound" ? message.from_address : "You"}</strong>
        <span className="muted"> → {message.to_addresses.join(", ")}</span>
        <span className="message-date muted">{new Date(message.created_at).toLocaleString()}</span>
        {message.status === "failed" && <span className="badge badge-failed">failed to send</span>}
      </div>
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
      {attachments.length > 0 && (
        <div className="attachments">
          {attachments.map((a) => (
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
