-- Friendy web app: password accounts, owner roles, plan expiry,
-- Cash App / card orders, private config, chat history indexes.
-- Idempotent. All tables stay RLS-locked (service role only, via friendy-api).

alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists password_salt text;
alter table public.users add column if not exists display_name text;
alter table public.users add column if not exists is_owner boolean not null default false;
alter table public.users add column if not exists plan_expires_at timestamptz;
alter table public.users add column if not exists payment_method text;
alter table public.users add column if not exists setup_code_hash text;
alter table public.users add column if not exists revenuecat_app_user_id text;
alter table public.users add column if not exists last_seen_at timestamptz;
alter table public.users add column if not exists updated_at timestamptz not null default now();

create unique index if not exists users_email_lower_idx on public.users (lower(email));
create index if not exists users_revenuecat_app_user_id_idx on public.users (revenuecat_app_user_id);
create index if not exists users_stripe_customer_idx on public.users (stripe_customer_id);

create table if not exists public.friendy_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  email text not null,
  plan text not null check (plan in ('basic','plus','premium')),
  amount_cents integer not null,
  method text not null check (method in ('cashapp','card')),
  order_code text unique not null,
  payer_handle text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid_unclaimed')),
  stripe_session_id text unique,
  note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);
create index if not exists friendy_orders_status_idx on public.friendy_orders (status, created_at desc);
create index if not exists friendy_orders_user_idx on public.friendy_orders (user_id, created_at desc);
create index if not exists friendy_orders_email_idx on public.friendy_orders (lower(email));
alter table public.friendy_orders enable row level security;

create table if not exists public.friendy_config (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.friendy_config enable row level security;

create index if not exists chat_messages_thread_idx on public.chat_messages (user_id, friend, created_at);
create index if not exists chat_messages_user_day_idx on public.chat_messages (user_id, created_at);

alter table public.users enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.friendy_orders, public.friendy_config from anon, authenticated;

alter table public.users add column if not exists failed_logins integer not null default 0;
alter table public.users add column if not exists lock_until timestamptz;

-- Session-signing secret (generated once, never leaves the database).
insert into public.friendy_config(key, value)
values ('jwt_secret', encode(extensions.gen_random_bytes(48), 'hex'))
on conflict (key) do nothing;

-- Owner accounts (hsw365media@gmail.com, hoodstarent365@gmail.com) are seeded
-- out-of-band with is_owner = true and a one-time setup_code_hash; they never pay
-- and never expire. Do not commit setup codes here.
