-- Date each mailbox is paid up to. Drives the renewal notice shown to the
-- mailbox owner and the admin "due this week" views.
alter table public.mailboxes
  add column paid_through timestamptz not null default (now() + interval '1 month');

-- Existing mailboxes: start at their next monthly anniversary, so nobody
-- shows as expired just because payments were not tracked before.
update public.mailboxes
set paid_through = created_at + (
  (extract(year from age(now(), created_at))::int * 12 + extract(month from age(now(), created_at))::int + 1)
  * interval '1 month'
);
