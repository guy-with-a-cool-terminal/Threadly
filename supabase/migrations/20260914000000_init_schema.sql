-- Phase 1: core schema for the email hosting platform.
-- Data model: clients -> domains -> mailboxes -> threads -> messages -> attachments.
-- Billing is per-mailbox. Suspension gates access, never deletes data.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,          -- billing/contact email, not a mailbox
  phone       text,
  notes       text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- domains
-- ---------------------------------------------------------------------------
create table public.domains (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid not null references public.clients(id) on delete cascade,
  domain_name             text not null unique,
  -- Label identifying which Resend account/API key routes this domain
  -- (e.g. 'resend_account_1'). The actual key lives in edge function secrets,
  -- never in the DB.
  resend_account_label    text not null,
  -- Resend's own domain id, once created via resend.domains.create().
  resend_domain_id        text,
  -- Mirrors Resend's domain status (resend.domains.create/get response).
  status                  text not null default 'pending'
                             check (status in (
                               'pending', 'verified', 'failed',
                               'not_started', 'partially_verified', 'partially_failed'
                             )),
  -- DNS records Resend asks for (MX/TXT/CNAME, covering SPF/DKIM/etc.), as
  -- returned by resend.domains.get() - kept as the raw array rather than
  -- re-modeled column by column, since it's just displayed to the admin.
  dns_records              jsonb,
  verification_checked_at timestamptz,
  created_at              timestamptz not null default now()
);

create index domains_client_id_idx on public.domains(client_id);

-- ---------------------------------------------------------------------------
-- mailboxes
-- ---------------------------------------------------------------------------
create table public.mailboxes (
  id                uuid primary key default gen_random_uuid(),
  domain_id         uuid not null references public.domains(id) on delete cascade,
  local_part        text not null,                 -- e.g. 'info', 'support'
  address           text not null unique,           -- full address, e.g. 'info@client.com'
  -- One mailbox <-> exactly one Supabase Auth user. Null briefly during
  -- provisioning if an admin creates the row before the auth user exists.
  auth_user_id      uuid unique references auth.users(id) on delete set null,
  monthly_fee_kes   numeric(10,2) not null default 500,
  status            text not null default 'active'
                      check (status in ('active', 'suspended_unpaid', 'suspended_admin')),
  last_payment_date date,
  late_fee_pending  boolean not null default false, -- true once a late reactivation fee is owed
  created_at        timestamptz not null default now(),
  unique (domain_id, local_part)
);

create index mailboxes_domain_id_idx on public.mailboxes(domain_id);
create index mailboxes_auth_user_id_idx on public.mailboxes(auth_user_id);
create index mailboxes_status_idx on public.mailboxes(status);

-- ---------------------------------------------------------------------------
-- mailbox_payments - ledger of payments/late fees per mailbox
-- ---------------------------------------------------------------------------
create table public.mailbox_payments (
  id           uuid primary key default gen_random_uuid(),
  mailbox_id   uuid not null references public.mailboxes(id) on delete cascade,
  amount_kes   numeric(10,2) not null,
  is_late_fee  boolean not null default false,
  paid_at      timestamptz not null default now(),
  note         text
);

create index mailbox_payments_mailbox_id_idx on public.mailbox_payments(mailbox_id);

-- ---------------------------------------------------------------------------
-- threads
-- ---------------------------------------------------------------------------
create table public.threads (
  id               uuid primary key default gen_random_uuid(),
  mailbox_id       uuid not null references public.mailboxes(id) on delete cascade,
  subject          text,
  last_message_at  timestamptz,
  created_at       timestamptz not null default now()
);

create index threads_mailbox_id_idx on public.threads(mailbox_id);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  thread_id           uuid not null references public.threads(id) on delete cascade,
  -- Denormalized from threads.mailbox_id to keep RLS a single-column check.
  mailbox_id          uuid not null references public.mailboxes(id) on delete cascade,
  direction           text not null check (direction in ('inbound', 'outbound')),
  from_address        text not null,
  to_addresses        text[] not null,
  cc_addresses        text[],
  bcc_addresses       text[],
  subject             text,
  body_text           text,
  body_html           text,
  message_id_header   text,   -- RFC5322 Message-ID
  in_reply_to_header  text,
  references_header   text,
  resend_message_id   text,   -- id Resend assigns on send, or the inbound event id
  status              text not null default 'received'
                        check (status in ('received', 'queued', 'sent', 'failed')),
  created_at          timestamptz not null default now()
);

create index messages_thread_id_idx on public.messages(thread_id);
create index messages_mailbox_id_idx on public.messages(mailbox_id);
create index messages_created_at_idx on public.messages(created_at);

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------
create table public.attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.messages(id) on delete cascade,
  -- Denormalized from messages.mailbox_id, same reasoning as above.
  mailbox_id    uuid not null references public.mailboxes(id) on delete cascade,
  file_name     text not null,
  content_type  text,
  size_bytes    bigint,
  storage_path  text not null,   -- path within the Supabase Storage bucket
  created_at    timestamptz not null default now()
);

create index attachments_message_id_idx on public.attachments(message_id);
create index attachments_mailbox_id_idx on public.attachments(mailbox_id);

-- ---------------------------------------------------------------------------
-- admins - business owner(s) with cross-client access via a real Auth login
-- (in addition to the service_role key, which already bypasses RLS entirely
-- for edge functions / trusted server-side jobs).
-- ---------------------------------------------------------------------------
create table public.admins (
  auth_user_id  uuid primary key references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins where auth_user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.clients          enable row level security;
alter table public.domains          enable row level security;
alter table public.mailboxes        enable row level security;
alter table public.mailbox_payments enable row level security;
alter table public.threads          enable row level security;
alter table public.messages         enable row level security;
alter table public.attachments      enable row level security;
alter table public.admins           enable row level security;

-- clients / domains / mailbox_payments / admins: admin-only. Mailbox owners
-- never see billing internals or other clients' domains.
create policy "admins full access to clients"
  on public.clients for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins full access to domains"
  on public.domains for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins full access to mailbox_payments"
  on public.mailbox_payments for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins manage admins"
  on public.admins for all
  using (public.is_admin())
  with check (public.is_admin());

-- mailboxes: owner can read their own row (to see billing/suspension status);
-- only admin can create/update/delete (provisioning, billing changes).
create policy "owner reads own mailbox"
  on public.mailboxes for select
  using (auth_user_id = auth.uid() or public.is_admin());

create policy "admins manage mailboxes"
  on public.mailboxes for insert
  with check (public.is_admin());

create policy "admins update mailboxes"
  on public.mailboxes for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins delete mailboxes"
  on public.mailboxes for delete
  using (public.is_admin());

-- threads: scoped to the owning mailbox via auth_user_id lookup.
create policy "owner reads own threads"
  on public.threads for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = threads.mailbox_id and m.auth_user_id = auth.uid()
    )
  );

create policy "owner inserts own threads"
  on public.threads for insert
  with check (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = threads.mailbox_id and m.auth_user_id = auth.uid()
    )
  );

-- messages: same ownership pattern via the denormalized mailbox_id.
-- Note: actual send/suspension enforcement happens in the outbound edge
-- function (Phase 3), not here - RLS is defense in depth, not the gate.
create policy "owner reads own messages"
  on public.messages for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = messages.mailbox_id and m.auth_user_id = auth.uid()
    )
  );

create policy "owner inserts own messages"
  on public.messages for insert
  with check (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = messages.mailbox_id and m.auth_user_id = auth.uid()
    )
  );

-- attachments: same ownership pattern via the denormalized mailbox_id.
create policy "owner reads own attachments"
  on public.attachments for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = attachments.mailbox_id and m.auth_user_id = auth.uid()
    )
  );

create policy "owner inserts own attachments"
  on public.attachments for insert
  with check (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = attachments.mailbox_id and m.auth_user_id = auth.uid()
    )
  );
