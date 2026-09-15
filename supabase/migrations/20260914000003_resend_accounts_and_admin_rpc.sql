-- resend_accounts: admin-managed registry of Resend accounts, replacing the
-- old scheme of one RESEND_ACCOUNT_N_API_KEY / _WEBHOOK_SECRET pair per
-- account set via `supabase secrets set`. Admins add accounts and paste
-- keys from the admin UI instead of the CLI.
--
-- This table has RLS enabled with NO policies at all - nobody can read or
-- write it directly from the client, not even an admin. Writes go through
-- the manage-resend-accounts edge function (service role). Reads for
-- display go through list_resend_accounts() below, which reports only
-- whether a key is set, never the value - once a key is saved, it never
-- comes back down to a browser again.
create table public.resend_accounts (
  id              uuid primary key default gen_random_uuid(),
  label           text not null unique,
  display_name    text not null,
  api_key         text,
  webhook_secret  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.resend_accounts enable row level security;

create or replace function public.list_resend_accounts()
returns table (
  label text,
  display_name text,
  has_api_key boolean,
  has_webhook_secret boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select label, display_name, api_key is not null, webhook_secret is not null, created_at
  from public.resend_accounts
  where public.is_admin()
  order by created_at;
$$;

-- list_admins(): admins are rows in `admins` keyed by auth_user_id, but
-- auth.users isn't exposed to the client API, so there's no way to show an
-- admin their email otherwise. security definer + the is_admin() guard in
-- the where clause keeps this readable only by admins, for admins.
create or replace function public.list_admins()
returns table (auth_user_id uuid, email text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.auth_user_id, u.email, a.created_at
  from public.admins a
  join auth.users u on u.id = a.auth_user_id
  where public.is_admin()
  order by a.created_at;
$$;
