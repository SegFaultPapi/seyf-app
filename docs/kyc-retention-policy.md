# KYC retention and deletion policy

- KYC identity data is collected only for onboarding and fraud prevention.
- Raw identity fields are not stored in long-lived logs.
- KYC state snapshots are retained for 180 days unless a legal hold or dispute requires longer retention.
- Deletion requests are handled through the internal support workflow and must remove Redis snapshots and audit entries.
- The system must not log raw PII in application logs.
