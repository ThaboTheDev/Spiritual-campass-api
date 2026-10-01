-- TSHK Compass subscription edition: run in Supabase → SQL Editor.
-- Idempotent: safe to run again on an existing database (see "Upgrading an existing database" at the bottom).
-- After running this, run supabase/seed-centres.sql once to load the 88 centres.

create table if not exists public.members (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  email                text,
  status               text not null default 'trialing'
                       check (status in ('trialing','active','cancelled')),
  trial_ends_at        timestamptz not null,
  paid_through         timestamptz,            -- end of the month already paid for
  payfast_token        text unique,            -- PayFast subscription token (needed to cancel)
  cancel_requested_at  timestamptz,
  subscription_amount  numeric(10,2),          -- monthly amount this member signed up at (renewals are checked against it)
  is_admin             boolean not null default false,          -- admin tools; read from this row on every API call
  must_change_password boolean not null default false,          -- server-enforced: blocks every API route except /api/me and /api/account/password
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.checkouts (
  m_payment_id  text primary key,              -- our reference sent to PayFast
  user_id       uuid not null references auth.users(id) on delete cascade,
  amount        numeric(10,2) not null,
  status        text not null default 'pending', -- pending | complete | cancelled
  created_at    timestamptz not null default now()
);

create table if not exists public.payments (
  id             bigserial primary key,
  user_id        uuid references auth.users(id) on delete set null,  -- financial records are kept when a user is deleted
  pf_payment_id  text unique,                  -- PayFast's id; unique = each notification is applied once
  m_payment_id   text,
  token          text,
  payment_status text,
  amount_gross   numeric(10,2),
  amount_fee     numeric(10,2),
  amount_net     numeric(10,2),
  raw            jsonb,
  applies_until  timestamptz,                  -- paid-through date this payment grants; lets a retried notification finish an interrupted activation
  received_at    timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments(user_id);

create table if not exists public.regions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int  not null default 0,          -- display order used by /api/centres
  created_at timestamptz not null default now()
);

create table if not exists public.centres (
  id         uuid primary key default gen_random_uuid(),
  region     text not null references public.regions(name) on delete restrict,
  name       text not null,
  address    text,
  phone      text,
  lat        double precision not null check (lat  between -90  and 90),
  lng        double precision not null check (lng between -180 and 180),
  sort_order int  not null default 0,          -- keeps the original list order inside a region
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (region, name)
);
create index if not exists centres_region_idx on public.centres(region);

create table if not exists public.admin_audit (
  id            bigserial primary key,
  admin_user_id uuid references auth.users(id) on delete set null,
  action        text not null,                 -- e.g. centre.create, user.password_reset, user.delete
  target_user_id uuid,
  detail        jsonb not null default '{}'::jsonb,   -- NEVER put a password here (see the reset-password route)
  created_at    timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit(created_at desc);

-- Row Level Security: members may read their own row; all writes happen on the server with the service role key.
alter table public.members     enable row level security;
alter table public.checkouts   enable row level security;
alter table public.payments    enable row level security;
alter table public.regions     enable row level security;
alter table public.centres     enable row level security;
alter table public.admin_audit enable row level security;

drop policy if exists "members read own row" on public.members;
create policy "members read own row" on public.members for select using (auth.uid() = user_id);
drop policy if exists "members read own payments" on public.payments;
create policy "members read own payments" on public.payments for select using (auth.uid() = user_id);

-- regions, centres and admin_audit have RLS enabled and NO policies: PostgREST returns nothing for anon/authenticated.
-- Revoke the table privileges too, so even a future accidental policy cannot expose them.
revoke all on public.regions     from anon, authenticated;
revoke all on public.centres     from anon, authenticated;
revoke all on public.admin_audit from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Documented check: a member must NOT be able to make themselves admin.
-- The website/app talks to PostgREST with the member's own access token, and the only
-- policy on public.members is SELECT ("members read own row"). There is no INSERT/UPDATE/DELETE
-- policy, so PostgREST refuses writes (HTTP 401/403) and this must return an error or 0 rows:
--
--   -- as the member, with their own access token:
--   PATCH {SUPABASE_URL}/rest/v1/members?user_id=eq.<their user id>
--   apikey: <anon key>      Authorization: Bearer <member access token>
--   Content-Type: application/json
--   {"is_admin": true}          -- must NOT change the row
--
--   -- as the owner / service role, confirm there is no write policy:
--   select cmd, policyname from pg_policies
--    where schemaname = 'public' and tablename = 'members';   -- expect only cmd = 'SELECT'
-- ---------------------------------------------------------------------------

-- Handy admin view: who is paying, trialling or lapsed, and who is an admin.
create or replace view public.member_overview as
select m.email, m.status, m.trial_ends_at, m.paid_through, m.cancel_requested_at, m.created_at,
       m.is_admin, m.must_change_password,
       (select count(*) from public.payments p where p.user_id = m.user_id and p.payment_status = 'COMPLETE') as payments
from public.members m order by m.created_at desc;
revoke all on public.member_overview from anon, authenticated;

-- ---------------------------------------------------------------------------
-- ONE-TIME: make yourself (the owner) an admin. Sign up in the app and open it once
-- first, so your members row exists, then run:
--
--   update public.members set is_admin = true where email = 'owner@example.org';
--
-- is_admin is read from the database on every API call; it is never read from the JWT or
-- user_metadata, so a member cannot promote themselves by editing their profile.
-- ---------------------------------------------------------------------------

-- Upgrading an existing database? These are safe to run again:
alter table public.members  add column if not exists subscription_amount numeric(10,2);
alter table public.payments add column if not exists applies_until timestamptz;
alter table public.members  add column if not exists is_admin boolean not null default false;
alter table public.members  add column if not exists must_change_password boolean not null default false;
alter table public.centres  add column if not exists sort_order int not null default 0;
