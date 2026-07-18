-- Friendy: ensure the users table exists and has what the new
-- friendy-account edge function needs for native (RevenueCat/StoreKit)
-- purchases + account deletion.
--
-- Safe to run even if `users` already exists from the original
-- friendy-api build — every statement is idempotent (IF NOT EXISTS).
--
-- ⚠️ If your live `users` table uses different column names than the
-- ones below, edit this file (and supabase/functions/friendy-account/index.ts)
-- to match before applying — run `select * from users limit 1;` in the
-- Supabase SQL editor first to check.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  plan text not null default 'none',
  plan_status text not null default 'inactive',
  stripe_customer_id text,
  stripe_subscription_id text,
  revenuecat_app_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users add column if not exists revenuecat_app_user_id text;
alter table public.users add column if not exists plan_status text not null default 'inactive';
alter table public.users add column if not exists updated_at timestamptz not null default now();

create index if not exists users_revenuecat_app_user_id_idx on public.users (revenuecat_app_user_id);
create unique index if not exists users_email_idx on public.users (lower(email));
