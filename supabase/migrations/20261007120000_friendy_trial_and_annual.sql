-- 3-day free trial (once per account) and yearly plans.
alter table public.users add column if not exists trial_used_at timestamptz;
alter table public.friendy_orders add column if not exists billing text not null default 'monthly';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'friendy_orders_billing_check') then
    alter table public.friendy_orders add constraint friendy_orders_billing_check check (billing in ('monthly','annual'));
  end if;
end $$;
