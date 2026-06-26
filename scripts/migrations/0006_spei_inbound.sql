-- Migration: 0006_spei_inbound.sql
-- M03-T01: SPEI Inbound — Virtual CLABE Generation & Webhook
--
-- Creates:
--   user_clabes                  — static virtual CLABE per user (MVP: one per user)
--   processed_spei_inbound_events — idempotency table for inbound SPEI webhooks

-- ─── user_clabes ─────────────────────────────────────────────────────────────
create table if not exists user_clabes (
  id                uuid        primary key default gen_random_uuid(),
  user_id           text        not null unique,
  clabe             char(18)    not null unique,
  bank_name         text        not null default 'Etherfuse',
  beneficiary_name  text        not null,
  -- Maximum total deposit the user is allowed (default: 50,000 MXN CNBV standard)
  deposit_limit_mxn numeric(14, 2) not null default 50000,
  -- Raw payload from the CLABE provider (Etherfuse bank-account object)
  raw_provider_data jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table user_clabes is
  'Maps one static virtual CLABE to each Seyf user for MVP inbound SPEI transfers.';

-- ─── processed_spei_inbound_events ───────────────────────────────────────────
create table if not exists processed_spei_inbound_events (
  event_id    text      primary key,
  deposit_id  uuid,                        -- null if we could not create a deposit (refund path)
  created_at  timestamptz not null default now()
);

comment on table processed_spei_inbound_events is
  'Idempotency log for POST /api/webhooks/spei/inbound — prevents duplicate deposit records on re-delivery.';
