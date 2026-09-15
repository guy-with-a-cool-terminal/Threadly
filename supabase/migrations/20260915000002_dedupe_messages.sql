-- Webhook delivery is "at least once", not "exactly once" - Resend (like
-- any webhook provider) can and will redeliver the same event on retry,
-- timeout, or a manual replay. inbound-email had no protection against
-- this, so the same reply could be stored twice. resend_message_id already
-- captures Resend's id for both directions (its own send id, or the
-- inbound event id) - a unique constraint on it, paired with an
-- ON CONFLICT DO NOTHING in inbound-email, makes storing a message
-- actually idempotent. NULLs are unaffected (Postgres never treats two
-- NULLs as equal for uniqueness).
alter table public.messages
  add constraint messages_resend_message_id_key unique (resend_message_id);
