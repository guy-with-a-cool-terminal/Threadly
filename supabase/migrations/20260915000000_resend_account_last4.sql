-- Adds a partial reveal (last 4 characters) of each saved key/secret to
-- list_resend_accounts(), so an admin has something to eyeball-compare
-- against Resend's own (also-masked) key listing without the full value
-- ever leaving the database. Real correctness is enforced separately: the
-- API key is now validated live against Resend's API when saved (see
-- manage-resend-accounts), this is just a recognizability aid.
drop function if exists public.list_resend_accounts();

create function public.list_resend_accounts()
returns table (
  label text,
  display_name text,
  has_api_key boolean,
  api_key_last4 text,
  has_webhook_secret boolean,
  webhook_secret_last4 text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    label,
    display_name,
    api_key is not null,
    right(api_key, 4),
    webhook_secret is not null,
    right(webhook_secret, 4),
    created_at
  from public.resend_accounts
  where public.is_admin()
  order by created_at;
$$;
