# Threadly

In-house client email hosting platform. Supabase is the
entire backend (Postgres, Auth, Storage, Edge Functions); Resend handles email
transport (send + inbound parsing) only - all storage, threading, and the
inbox UI are custom. See project memory for the full business/architecture
brief (billing rules, suspension policy, phased plan).

## Status

**Code-complete for Phases 1–4** (schema, inbound pipeline, outbound
pipeline, admin provisioning, client + admin web UI). Deployed: the Supabase
project is live and linked, the schema is pushed, and all five edge
functions are deployed. Not yet done: no Resend account has keys saved
(add one from Admin -> Resend accounts, following its instructions), so no
domain can send or receive mail yet, and `web/` isn't deployed to Vercel.

Two things are intentionally unfinished, by explicit decision, to get
clients onboarded first:

- **Billing/suspension gating is not enforced.** The schema has
  `mailboxes.status` and the late-fee fields, but `send-email` never checks
  it (see the `TODO(billing)` in [supabase/functions/send-email/index.ts](supabase/functions/send-email/index.ts)) and inbound mail is
  always stored regardless of status. Wire this in once clients are live.
- **Composer sends plain text only** (no rich-text/HTML authoring) - kept
  simple deliberately; Resend still delivers it as a normal email.

## Data model

`clients` → `domains` (routes to a Resend account/key, tracks Resend's
verification `status` + the DNS records it asks for) → `mailboxes` (billed
individually, one Supabase Auth user each) → `threads` → `messages` →
`attachments` (Supabase Storage). `mailbox_payments` is a ledger of
payments/late fees (not yet written to by any code path - billing UI is a
later phase). `admins` + `is_admin()` give the business owner cross-client
access through a real Auth login, in addition to the service-role key edge
functions use. `inbound_log` records anything the inbound pipeline couldn't
route or process, so nothing silently vanishes. `resend_accounts` holds
each Resend account's API key and webhook signing secret; it has no RLS
policies at all, so nothing reads or writes it except the service role
inside `manage-resend-accounts` and the edge functions that send/receive
mail. `list_resend_accounts()` is the only client-facing read of it, and it
reports whether a key is set, never the value.

RLS: a mailbox's own Auth user can only ever read (and, for threads/messages/
attachments, insert) rows tied to their own `mailbox_id` - never another
client's. `clients`, `domains`, `mailbox_payments`, and mailbox
provisioning/updates are admin-only.

## What's built

- **supabase/migrations/** - full schema + RLS (see Data model above).
- **supabase/functions/inbound-email/** - Resend `email.received` webhook
  handler: verifies the Svix signature, matches the recipient to a mailbox,
  fetches the full body + attachments, threads it (by In-Reply-To/References,
  falling back to subject match), stores it. Registered once per Resend
  account via a `?account=<label>` query param.
- **supabase/functions/send-email/** - sends a new message or reply as the
  caller's mailbox, via the Resend account that owns the domain; records the
  outbound message and its attachments locally.
- **supabase/functions/add-domain/** - admin-only, one-off per client
  domain: creates the client (if new), then either imports the domain from
  Resend (if it was already added and verified directly on resend.com) or
  registers it fresh and returns the DNS records to configure.
- **supabase/functions/provision-mailbox/** - admin-only: creates a mailbox
  (Auth login + `mailboxes` row) on a domain that's already registered via
  add-domain. Doesn't touch Resend or create a client/domain - deliberately
  just "pick a domain, type a name" so mailbox creation stays trivial once
  a domain is set up.
- **supabase/functions/manage-resend-accounts/** - admin-only: creates a
  Resend account entry and, when its API key is pasted in, validates it
  live against Resend and automatically registers (or reuses) the inbound
  webhook via Resend's Webhooks API, capturing its signing secret - no
  manual webhook step or CLI secret.
- **supabase/functions/manage-admins/** - admin-only: grants or revokes
  cross-client admin access by email, with a guard against removing the
  last admin.
- **web/** - Vite + React SPA: client login → inbox (thread list, search,
  live updates via Supabase Realtime) → thread view (sanitized HTML
  rendering, reply). Admin view lists clients/domains/mailboxes, with a
  suspend/reactivate toggle and inline fee editing per mailbox; a
  provisioning form; a Resend accounts page with step-by-step setup
  instructions per account; and an Admins page to grant/revoke access. An
  admin can open any mailbox's inbox the same way its owner would.

Resend API/webhook shapes used in the edge functions were checked directly
against the `resend` npm package's shipped TypeScript types (v6.28.0), not
just docs, and both migrations and all five edge functions have been
type-checked (`tsc`/`deno check`) and the migrations dry-run against a real
Postgres. What hasn't been exercised: an actual Resend webhook hitting
`inbound-email`, since that needs a live domain + account with keys saved.

## Local setup (not deployed - see below)

**Backend:**
1. `cp .env.example .env` and fill in the Supabase values once you have a
   project. Resend account keys are not set here - see "Deploying" below.
2. `npm install` (installs the `supabase` CLI as a dev dependency).
3. `npm run db:start` for local Postgres/Auth/Storage, or once linked to a
   real project, `npx supabase db push` to apply `supabase/migrations/`.
4. `npx supabase functions serve` to run the edge functions locally.

**Frontend:**
1. `cd web && npm install`
2. `cp .env.example .env` and fill in `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
3. `npm run dev`

## Deploying

1. Create the Supabase project, `npx supabase link --project-ref <ref>`,
   `npx supabase db push`.
2. `npx supabase functions deploy inbound-email send-email add-domain provision-mailbox manage-resend-accounts manage-admins`.
   No function secrets to set - `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` are auto-injected, and Resend keys live in
   the database, not env vars.
3. Insert one row into `admins` (your own auth user id) so you can reach
   `/admin` - there's no UI for the very first admin, since granting one
   requires already being one. Every admin after that can be granted from
   Admin -> Admins.
4. Deploy `web/` to Vercel with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   as project env vars.
5. Sign in, go to Admin -> Resend accounts, add an account, create a Full
   access API key on resend.com, and paste it in - the webhook is
   registered and its secret captured automatically. No CLI or dashboard
   secrets step.
6. Use Admin -> Add domain to register the first client's domain (picking
   whichever Resend account has capacity - 3 verified domains per account
   on the free tier), then Admin -> New mailbox to create their mailbox on
   it.

## Phased plan

0. Decisions - closed (stack, auth model, billing/suspension rules).
1. Foundation - done: schema + RLS.
2. Inbound pipeline - done, unverified against a live webhook (see Status).
3. Outbound pipeline - done, billing gate intentionally not wired in yet.
4. UI - done: client inbox + admin view.
5. Migration - move clients off their previous provider one at a time once
   deployed, monitor deliverability.
6. Hardening - backups, Resend quota monitoring, outbound abuse monitoring,
   and turning on billing/suspension enforcement.
7. (Future) Self-hosted VPS mail server, once advertising for new clients
   makes independence from Resend worth the ops/liability tradeoff.

## Open items

- Whether a suspended mailbox keeps read-only access to old mail, or faces
  full lockout including login - decide once billing enforcement is turned
  back on.
