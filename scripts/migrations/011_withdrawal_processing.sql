-- M06-T02: Add processing status to withdrawals, user_balances table, updated state machine

alter table withdrawals drop constraint if exists withdrawals_status_check;
alter table withdrawals add constraint withdrawals_status_check
  check (status in ('pending', 'processing', 'completed', 'failed'));

create table if not exists user_balances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  available_balance_mxn numeric(18, 2) not null default 0 check (available_balance_mxn >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_balances_user_id_idx on user_balances (user_id);

create table if not exists processed_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  event_type text not null,
  status text not null default 'processed',
  withdrawal_id uuid references withdrawals (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists processed_webhook_events_event_id_idx on processed_webhook_events (event_id);

create or replace function seyf_is_valid_transaction_transition(
  p_entity_type text,
  p_from_status text,
  p_to_status text
) returns boolean
language plpgsql
immutable
as $$
begin
  if p_from_status is null then
    return p_to_status in ('pending', 'processing', 'completed', 'failed', 'liquidated');
  end if;

  if p_from_status = p_to_status then
    return true;
  end if;

  if p_entity_type = 'deposit' then
    return (p_from_status = 'pending' and p_to_status in ('completed', 'failed'));
  end if;

  if p_entity_type = 'withdrawal' then
    return (
      (p_from_status = 'pending' and p_to_status in ('processing', 'completed', 'failed'))
      or (p_from_status = 'processing' and p_to_status in ('completed', 'failed'))
    );
  end if;

  if p_entity_type = 'advance' then
    return (
      (p_from_status = 'pending' and p_to_status in ('completed', 'failed'))
      or (p_from_status = 'completed' and p_to_status = 'liquidated')
    );
  end if;

  return false;
end;
$$;

insert into user_balances (user_id, available_balance_mxn)
select id, 0 from users
on conflict (user_id) do nothing;
