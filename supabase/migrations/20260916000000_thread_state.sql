-- Thread-level state for the mailbox UI: unread tracking, archive, trash
-- (soft delete, with a separate hard-delete path via an edge function),
-- spam marking, and starring. All boolean/timestamp flags on the thread
-- rather than per-message, matching how every mailbox client actually
-- treats "read" and folder membership as a conversation-level concept.
alter table public.threads
  add column is_read     boolean not null default true,
  add column archived_at timestamptz,
  add column deleted_at  timestamptz,
  add column is_spam     boolean not null default false,
  add column starred     boolean not null default false;

-- New threads default to read=true (a fresh outbound compose is "seen" by
-- definition); inbound-email explicitly sets is_read=false whenever a new
-- message lands, which is what actually drives the unread state.

create index threads_mailbox_inbox_idx
  on public.threads(mailbox_id, last_message_at desc)
  where archived_at is null and deleted_at is null and is_spam = false;

-- threads had select/insert policies only - nothing let an owner update
-- read state, archive, trash, spam-mark, or star their own threads.
create policy "owner updates own threads"
  on public.threads for update
  using (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = threads.mailbox_id and m.auth_user_id = auth.uid()
    )
  )
  with check (
    public.is_admin()
    or exists (
      select 1 from public.mailboxes m
      where m.id = threads.mailbox_id and m.auth_user_id = auth.uid()
    )
  );
