-- Migration: 013_auth_tables.sql

-- Add password_hash column to users table
alter table users 
add column if not exists password_hash text;

-- Create refresh_tokens table for database-backed sessions
create table if not exists refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists refresh_tokens_token_hash_idx on refresh_tokens(token_hash);
create index if not exists refresh_tokens_user_id_idx on refresh_tokens(user_id);

-- Create login_attempts table for IP-based rate limiting
create table if not exists login_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists login_attempts_ip_time_idx on login_attempts(ip, attempted_at desc);
