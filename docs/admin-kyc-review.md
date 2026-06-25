# Internal Admin KYC Review API

This document provides a reference for the internal admin APIs used for reviewing, approving, and rejecting KYC submissions in Seyf.

## Admin Access Control

Access to all `/api/admin/*` endpoints is controlled via the `assertAdminAccess()` middleware. Access is granted if either of the following environment variables is set and the corresponding header is provided in the request:

1. **`SEYF_ETHERFUSE_OPS_TOKEN`**: Checked against the `x-seyf-ops-token` request header.
2. **`ADMIN_SECRET`**: Checked against the standard `Authorization: Bearer <ADMIN_SECRET>` header.

If neither environment variable is configured in production, the API endpoints will return a `503 Service Unavailable` error.

---

## API Endpoints Reference

### 1. GET /api/admin/kyc/queue

Fetch the list of KYC cases stored in Redis, filtered by status.

- **Query Parameters**:
  - `status` (optional): The KYC status to filter by. Defaults to `proposed`. Allowed values: `not_started`, `proposed`, `approved`, `approved_chain_deploying`, `rejected`.
  - `limit` (optional): Maximum number of cases to return. Defaults to `50`.

- **Example Request**:
  ```bash
  curl -X GET "https://api.seyf.app/api/admin/kyc/queue?status=proposed&limit=10" \
    -H "x-seyf-ops-token: YOUR_OPS_TOKEN"
  ```

- **Example Response**:
  ```json
  {
    "ok": true,
    "count": 1,
    "cases": [
      {
        "customerId": "cust_123",
        "walletPublicKey: "G...",
        "status": "proposed",
        "approvedAt": null,
        "currentRejectionReason": null,
        "updatedAt": "2026-06-24T12:00:00.000Z"
      }
    ]
  }
  ```

---

### 2. PATCH /api/admin/kyc/[customerId]/approve

Approve a customer's KYC submission, transition their state in Redis to `approved`, and record the action in the audit log.

- **Request Body**:
  - `walletPublicKey` (string, required): The wallet public key associated with the KYC record.
  - `note` (string, optional): A descriptive note about the approval.

- **Example Request**:
  ```bash
  curl -X PATCH "https://api.seyf.app/api/admin/kyc/cust_123/approve" \
    -H "x-seyf-ops-token: YOUR_OPS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "walletPublicKey": "GBX...",
      "note": "Document validation verified manually."
    }'
  ```

- **Example Response**:
  ```json
  {
    "ok": true,
    "customerId": "cust_123",
    "walletPublicKey": "GBX...",
    "fromStatus": "proposed",
    "toStatus": "approved"
  }
  ```

---

### 3. PATCH /api/admin/kyc/[customerId]/reject

Reject a customer's KYC submission, transition their state in Redis to `rejected`, and record the action and reason in the audit log.

- **Request Body**:
  - `walletPublicKey` (string, required): The wallet public key associated with the KYC record.
  - `rejectionReason` (string, required): The reason for rejection (e.g., "id_expired", "poor_quality_selfie").
  - `note` (string, optional): A descriptive note about the rejection.

- **Example Request**:
  ```bash
  curl -X PATCH "https://api.seyf.app/api/admin/kyc/cust_123/reject" \
    -H "x-seyf-ops-token: YOUR_OPS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "walletPublicKey": "GBX...",
      "rejectionReason": "poor_quality_selfie",
      "note": "Selfie was blurry. Please resubmit."
    }'
  ```

- **Example Response**:
  ```json
  {
    "ok": true,
    "customerId": "cust_123",
    "walletPublicKey": "GBX...",
    "fromStatus": "proposed",
    "toStatus": "rejected"
  }
  ```

---

### 4. GET /api/admin/kyc/audit-log

Retrieve the audit trail of KYC review actions from the Postgres database.

- **Query Parameters**:
  - `customer_id` (optional): Filter audit records by customer ID.
  - `limit` (optional): Maximum number of entries to return. Defaults to `50`, maximum `200`.

- **Example Request**:
  ```bash
  curl -X GET "https://api.seyf.app/api/admin/kyc/audit-log?limit=25" \
    -H "x-seyf-ops-token: YOUR_OPS_TOKEN"
  ```

- **Example Response**:
  ```json
  {
    "ok": true,
    "count": 2,
    "logs": [
      {
        "id": "7857fa23-...",
        "actor": "ops_token",
        "action": "reject",
        "target_customer_id": "cust_123",
        "target_wallet_public_key": "GBX...",
        "from_status": "proposed",
        "to_status": "rejected",
        "note": "Selfie was blurry. Please resubmit.",
        "created_at": "2026-06-24T12:05:00.000Z"
      },
      {
        "id": "91a84f3e-...",
        "actor": "admin_secret",
        "action": "approve",
        "target_customer_id": "cust_456",
        "target_wallet_public_key": "GCV...",
        "from_status": "proposed",
        "to_status": "approved",
        "note": "Approved on second submission.",
        "created_at": "2026-06-24T12:10:00.000Z"
      }
    ]
  }
  ```

---

## Audit Log Database Schema

Audit entries are persisted in the `kyc_review_audit_log` table in PostgreSQL. The table is append-only for security and durability.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `primary key`, default `gen_random_uuid()` | Unique identifier for the audit entry |
| `actor` | `text` | `not null` | Name/ID of the admin performing the action (extracted from auth headers or fallback) |
| `action` | `text` | `not null`, `check (action in ('approve', 'reject'))` | The type of action performed |
| `target_customer_id` | `text` | `not null` | The Etherfuse customer ID of the target KYC case |
| `target_wallet_public_key` | `text` | `not null` | The wallet public key of the target KYC case |
| `from_status` | `text` | `nullable` | The KYC status prior to this action |
| `to_status` | `text` | `not null` | The KYC status transitioned to by this action |
| `note` | `text` | `nullable` | Additional comments/reasons provided by the admin |
| `created_at` | `timestamptz`| `not null`, default `now()` | Timestamp when the action was recorded |
