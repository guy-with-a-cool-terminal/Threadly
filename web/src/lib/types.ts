export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
}

export interface Domain {
  id: string;
  client_id: string;
  domain_name: string;
  resend_account_label: string;
  resend_domain_id: string | null;
  status: "pending" | "verified" | "failed" | "not_started" | "partially_verified" | "partially_failed";
  dns_records: unknown;
  created_at: string;
}

export interface Mailbox {
  id: string;
  domain_id: string;
  local_part: string;
  address: string;
  auth_user_id: string | null;
  monthly_fee_kes: number;
  status: "active" | "suspended_unpaid" | "suspended_admin";
  last_payment_date: string | null;
  late_fee_pending: boolean;
  signature: string | null;
  created_at: string;
}

export interface Thread {
  id: string;
  mailbox_id: string;
  subject: string | null;
  last_message_at: string | null;
  created_at: string;
  is_read: boolean;
  archived_at: string | null;
  deleted_at: string | null;
  is_spam: boolean;
  starred: boolean;
}

export interface Message {
  id: string;
  thread_id: string;
  mailbox_id: string;
  direction: "inbound" | "outbound";
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[] | null;
  bcc_addresses: string[] | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  message_id_header: string | null;
  in_reply_to_header: string | null;
  references_header: string | null;
  resend_message_id: string | null;
  status: "received" | "queued" | "sent" | "failed";
  created_at: string;
}

export interface Draft {
  id: string;
  mailbox_id: string;
  thread_id: string | null;
  to_addresses: string[];
  cc_addresses: string[] | null;
  bcc_addresses: string[] | null;
  subject: string | null;
  body_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  message_id: string;
  mailbox_id: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  created_at: string;
}
