-- drafts: unsent messages a mailbox owner is composing. Separate from
-- `messages` (which only ever holds actually sent/received mail) since a
-- draft is edited repeatedly and deleted once sent, unlike the append-only
-- messages/threads tables. thread_id is set for a draft reply within an
-- existing conversation, null for a fresh compose.
create table public.drafts (
  id             uuid primary key default gen_random_uuid(),
  mailbox_id     uuid not null references public.mailboxes(id) on delete cascade,
  thread_id      uuid references public.threads(id) on delete cascade,
  to_addresses   text[] not null default '{}',
  cc_addresses   text[],
  bcc_addresses  text[],
  subject        text,
  body_text      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index drafts_mailbox_id_idx on public.drafts(mailbox_id);

alter table public.drafts enable row level security;

-- Same ownership pattern as threads/messages/attachments via the
-- denormalized mailbox_id, but drafts also need update + delete since
-- they're edited in place and removed once sent or discarded.
create policy "owner reads own drafts"
  on public.drafts for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = drafts.mailbox_id and m.auth_user_id = auth.uid()
    )
  );

create policy "owner inserts own drafts"
  on public.drafts for insert
  with check (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = drafts.mailbox_id and m.auth_user_id = auth.uid()
    )
  );

create policy "owner updates own drafts"
  on public.drafts for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = drafts.mailbox_id and m.auth_user_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = drafts.mailbox_id and m.auth_user_id = auth.uid()
    )
  );

create policy "owner deletes own drafts"
  on public.drafts for delete
  using (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = drafts.mailbox_id and m.auth_user_id = auth.uid()
    )
  );
