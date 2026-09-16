-- Lets a mailbox owner set an email signature that gets appended to
-- outgoing mail (client-side, on the Composer).

alter table public.mailboxes add column signature text;

-- No blanket owner-UPDATE RLS policy on mailboxes: a raw REST update can't
-- be restricted to a single column, so any owner-UPDATE policy on the
-- whole row would also let a client tamper with monthly_fee_kes, status,
-- or other admin-only columns. Instead, a security definer function (same
-- pattern as is_admin() above) that only ever touches the signature
-- column, scoped to the caller's own row via auth.uid(). No explicit
-- grant needed, same as the other functions here - default PUBLIC execute
-- plus the auth.uid() scoping inside the function is enough, and it's a
-- no-op for a caller with no mailbox of their own.
create or replace function public.update_my_signature(new_signature text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mailboxes
  set signature = new_signature
  where auth_user_id = auth.uid();
end;
$$;
