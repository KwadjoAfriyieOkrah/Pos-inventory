# Task 1.2 Review — Identity Constraints

Reviewer: independent reviewer / test author
Implementation author: Copilot
Test command: `npx vitest run` (Vitest 4.1.12)
Test file: `tests/integration/identity-constraints.test.ts`
Boundary respected: only `tests/` and `docs/reviews/` were written; no Docker container was
started, stopped, created or removed; no credential value was read or printed.

## Method

Every constraint test runs inside `db.transaction(...)`, imported from
`src/server/db/client.ts`, and deliberately throws a rollback sentinel after the assertions so
no rows persist. Rejected inserts are captured and their SQLSTATE is read from the error (or
its `cause`) and compared to the exact expected code. The database connection is configured by
loading `.env.local` through dotenv; the value is never inspected or logged. The migration
check hashes file names and contents under `db/migrations/` only — it does not query the
database for schema drift.

## Pass/fail table

| # | Check | Expected | Result | Observed |
|---|-------|----------|--------|----------|
| 1 | Role from org B assigned to user/branch in org A | 23503 | PASS | 23503 |
| 2 | Branch from org B assigned to user/role in org A | 23503 | PASS | 23503 |
| 3 | User from org B assigned in org A | 23503 | PASS | 23503 |
| 4 | Duplicate `licence_number` across two orgs | 23505 | PASS | 23505 |
| 5 | Duplicate email in the same org | 23505 | PASS | 23505 |
| 6 | Same email in two different orgs | success | PASS | both inserts succeeded |
| 7 | Uppercase email | 23514 | PASS | 23514 |
| 8 | Permission `sale.delete` | 23514 | PASS | 23514 |
| 9 | Permission `sale.create` | success | PASS | insert succeeded |
| 10 | Audit event with null `branch_id` and null `actor_user_id` | success | PASS | insert succeeded |
| 11 | `licence_expires_on` read back as date-only string | date string, no time | PASS | matched `YYYY-MM-DD`, no `T`/space |
| 12 | `npm run db:migrate` twice leaves migration file count + SHA-256 unchanged | identical snapshots | PASS | both runs exit 0; count and digest unchanged |

All 12 checks pass. No schema was changed to make a test pass.

## Full `npx vitest run` output

```text
 RUN  v4.1.12 C:/Users/DELL/pharmacy-pos


 Test Files  2 passed (2)
      Tests  19 passed | 1 skipped (20)
   Start at  04:46:18
   Duration  3.38s (transform 240ms, setup 0ms, import 1.25ms, tests 2.75ms, environment 0ms)
```

The 19 passes are the 7 active Task 1.1 checks plus these 12 Task 1.2 checks; the single skip
is the Task 1.1 migration check deferred to this task.

## Findings

### High

None.

### Medium

1. **File/line:** `db/schema/audit-events.ts:14-15` (and migration
   `db/migrations/0000_foamy_squirrel_girl.sql:71-72`).
   **Problem:** `branch_id` and `actor_user_id` reference only `branches.id` and `users.id`.
   An audit event whose `organization_id` is org A can therefore point at a branch or actor
   from org B. The identity tables already prevent this for assignments with composite
   foreign keys, but audit attribution is left unguarded.
   **Fix recommended for Copilot:** add composite foreign keys
   `(branch_id, organization_id) -> branches(id, organization_id)` and
   `(actor_user_id, organization_id) -> users(id, organization_id)`, generate a new migration,
   and add a cross-org audit-event test asserting 23503.

2. **File/line:** `db/schema/audit-events.ts:6,19` (and migration line 9).
   **Problem:** the comment says audit payloads must never include passwords or tokens, but
   `payload` is an unconstrained `jsonb` with a `{}` default. Nothing enforces the rule, so a
   caller can persist secrets to an append-only audit table.
   **Fix recommended for Copilot:** redact forbidden keys at the write boundary (single audit
   helper), and add a database-side check or trigger rejecting keys such as `password`,
   `passwordHash`, `token` and `secret`. Add a test that such a payload is rejected.

### Low

3. **File/line:** `db/schema/users.ts:37` (and migration line 67).
   **Problem:** the only email check enforces lowercase; malformed strings such as `abc` pass.
   **Fix recommended for Copilot:** add a syntax check (or validate with a shared Zod email
   schema before insert) while keeping the lowercase rule, so bad addresses fail at the
   boundary.

4. **File/line:** `db/schema/organizations.ts:5` (and migration line 28).
   **Problem:** `name` has no uniqueness constraint, so two organizations can share the same
   display name and become hard to distinguish in reports and audit output.
   **Fix recommended for Copilot:** add a unique constraint on `name` (or on a stable slug) if
   the business requires distinct organizations, and generate the corresponding migration.

5. **File/line:** `db/schema/role-permissions.ts:26` (and migration line 36).
   **Problem:** the permission allow-list is duplicated between the Drizzle schema and the
   generated SQL. Any future edit to one without regenerating the other creates schema drift
   that the file-hash check will flag only after the fact.
   **Fix recommended for Copilot:** keep the Drizzle schema as the single source of truth and
   regenerate migrations with `npm run db:generate`; add a test that compares the live
   constraint to the canonical permission list so drift is detected early.
