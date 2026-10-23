# VitaGuard AI — Firestore Security Specification

## 1. Data Invariants & Relationship Mapping

- **Master Source of Truth**: `/users/{uid}` is the root identity document. Every subcollection (`/settings/{settingId}`, `/emergencyContacts/{contactId}`, `/observations/{observationId}`, `/riskAssessments/{assessmentId}`, `/alerts/{alertId}`, `/auditEvents/{eventId}`) is strictly owned by `{uid}` (`request.auth.uid == uid`) and requires the parent `/users/{uid}` profile document to exist (`exists(/databases/$(database)/documents/users/$(uid))`).
- **Simulation Labelling Invariant**: All client-written `/observations/{observationId}`, `/riskAssessments/{assessmentId}`, and `/alerts/{alertId}` documents MUST have `isSimulated == true`.
- **Immutable Ownership & Timestamps**: `uid` / `userId` and `createdAt` are immutable once created and must match `request.auth.uid` and `request.time` respectively.
- **Alert Lifecycle State Machine**: Alerts progress from `ACTIVE` -> `ACKNOWLEDGED` or `RESOLVED`. Once an alert reaches `RESOLVED`, it is in a terminal state and cannot be updated. Once `ACKNOWLEDGED`, it cannot revert to `ACTIVE`.
- **Append-Only Telemetry & Audit Trail**: Documents in `observations`, `riskAssessments`, and `auditEvents` are immutable after creation (`allow update, delete: if false`).

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Cross-Tenant Read/Write (IDOR)**: Authenticated user `user_alpha` attempts to read or write `/users/user_beta/alerts/alert_1`. -> `PERMISSION_DENIED`.
2. **Shadow Field Injection**: Client sends a valid `UserProfile` payload plus an undeclared field `{"isAdmin": true}` or `{"role": "superuser"}`. -> Rejected by `data.keys().hasOnly(...)`.
3. **Owner Spoofing in Payload**: Authenticated user `user_alpha` writes to `/users/user_alpha/alerts/alert_1` with `{"userId": "user_beta"}`. -> Rejected by `data.userId == request.auth.uid && data.userId == uid`.
4. **Fake Hardware Telemetry Claim**: Client attempts to create an observation or alert with `{"isSimulated": false}` to disguise sample data as real medical device readings. -> Rejected by `data.isSimulated == true`.
5. **Client Timestamp Forgery**: Client attempts to backdate `createdAt` or `updatedAt` with a custom timestamp instead of `serverTimestamp()` (`request.time`). -> Rejected by `incoming().createdAt == request.time`.
6. **Terminal Alert Re-Activation**: Client attempts to update a `RESOLVED` or `ACKNOWLEDGED` alert back to `{"status": "ACTIVE", "acknowledged": false}`. -> Rejected by terminal state lock.
7. **Audit Log Tampering / Deletion**: Authenticated owner attempts to `update` or `delete` an existing `/users/{uid}/auditEvents/{eventId}` record to erase safety history. -> Rejected (`allow update, delete: if false`).
8. **Orphaned Subcollection Write**: Authenticated user attempts to create `/users/{uid}/settings/default` before `/users/{uid}` exists. -> Rejected by Master Gate `exists(/databases/$(database)/documents/users/$(uid))`.
9. **Path ID Poisoning**: Client uses a 500-character or special-character document ID (`../../admin`). -> Rejected by `isValidId(id)`.
10. **Value Poisoning / Oversized Strings**: Client sends a 50,000-character string in `acknowledgementNote` or `summary`. -> Rejected by `.size() <= MAX` boundary checks.
11. **Immutable Field Mutation**: Client updates `emergencyContacts/{contactId}` while mutating `createdAt` or `userId`. -> Rejected by `affectedKeys().hasOnly(...)` and `incoming().createdAt == existing().createdAt`.
12. **Unauthenticated Scraper Query**: Unauthenticated client attempts `list` on `/users/{uid}/alerts`. -> Rejected by `isOwner(uid) && resource.data.userId == request.auth.uid`.

## 3. Red Team Audit Matrix

| Collection | Identity Spoofing Guard | Shadow Field Guard (`hasOnly`) | Terminal / Immutability Lock | Query Enforcement (`list`) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/users/{uid}` | `incoming().uid == request.auth.uid && uid == request.auth.uid` | Strict 6-key allowlist | `uid`, `createdAt` immutable | `get` only for owner | PASS |
| `/users/{uid}/settings/{settingId}` | `incoming().userId == request.auth.uid` | Strict 20-key allowlist | `userId` immutable | `resource.data.userId == request.auth.uid` | PASS |
| `/users/{uid}/emergencyContacts/{contactId}` | `incoming().userId == request.auth.uid` | Strict 10-key allowlist | `userId`, `createdAt`, `isDemoOnly == true` | `resource.data.userId == request.auth.uid` | PASS |
| `/users/{uid}/observations/{observationId}` | `incoming().userId == request.auth.uid` | Strict 11-key allowlist | Append-only (`update, delete: if false`) | `resource.data.userId == request.auth.uid` | PASS |
| `/users/{uid}/riskAssessments/{assessmentId}` | `incoming().userId == request.auth.uid` | Strict 11-key allowlist | Append-only (`update, delete: if false`) | `resource.data.userId == request.auth.uid` | PASS |
| `/users/{uid}/alerts/{alertId}` | `incoming().userId == request.auth.uid` | Strict 13-key allowlist | Terminal lock on `RESOLVED`; no downgrade from `ACKNOWLEDGED` | `resource.data.userId == request.auth.uid` | PASS |
| `/users/{uid}/auditEvents/{eventId}` | `incoming().userId == request.auth.uid` | Strict 7-key allowlist | Append-only (`update, delete: if false`) | `resource.data.userId == request.auth.uid` | PASS |
