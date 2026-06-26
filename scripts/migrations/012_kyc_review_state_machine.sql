-- Migration: 012_kyc_review_state_machine.sql

-- Add KYC status and deposit limit to users
alter table users 
add column if not exists kyc_status text not null default 'NOT_SUBMITTED',
add column if not exists deposit_limit_mxn numeric(20, 2) not null default 0,
add column if not exists kyc_rejection_reason text;

-- Create KYC status history table
create table if not exists kyc_status_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  old_status text not null,
  new_status text not null,
  actor text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists kyc_status_history_user_id_idx on kyc_status_history (user_id, created_at desc);
