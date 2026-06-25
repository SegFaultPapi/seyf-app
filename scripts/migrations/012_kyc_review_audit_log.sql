create table if not exists kyc_review_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null check (action in ('approve', 'reject')),
  target_customer_id text not null,
  target_wallet_public_key text not null,
  from_status text,
  to_status text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists kyc_review_audit_log_customer_idx
  on kyc_review_audit_log (target_customer_id, created_at desc);

create index if not exists kyc_review_audit_log_created_idx
  on kyc_review_audit_log (created_at desc);
