-- Storage bucket for message attachments, private by default (accessed via
-- RLS-checked signed URLs / the same mailbox-ownership rule as attachments).

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- Expect objects stored at: <mailbox_id>/<message_id>/<file_name>
-- so ownership can be checked from the path's first segment.
create policy "owner reads own attachment objects"
  on storage.objects for select
  using (
    bucket_id = 'attachments'
    and (
      public.is_admin()
      or exists (
        select 1 from public.mailboxes m
        where m.auth_user_id = auth.uid()
          and m.id::text = (storage.foldername(name))[1]
      )
    )
  );

-- Inserts happen via edge functions using the service role key (inbound
-- webhook, outbound send), which bypasses RLS - no authenticated-insert
-- policy is defined here on purpose.
