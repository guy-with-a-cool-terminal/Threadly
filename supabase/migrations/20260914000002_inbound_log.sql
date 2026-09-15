-- Operational visibility for the inbound pipeline: every email.received
-- webhook that couldn't be routed to a mailbox, or failed to process, lands
-- here so nothing silently vanishes. Admin-only; written by the inbound
-- edge function using the service role key (bypasses RLS), so no insert
-- policy is defined for authenticated users.
create table public.inbound_log (
  id                    uuid primary key default gen_random_uuid(),
  resend_email_id       text,
  resend_account_label  text,
  from_address          text,
  to_addresses          text[],
  subject               text,
  reason                text not null,  -- e.g. 'no_matching_mailbox', 'processing_error'
  detail                text,
  created_at            timestamptz not null default now()
);

create index inbound_log_created_at_idx on public.inbound_log(created_at desc);

alter table public.inbound_log enable row level security;

create policy "admins read inbound_log"
  on public.inbound_log for select
  using (public.is_admin());
