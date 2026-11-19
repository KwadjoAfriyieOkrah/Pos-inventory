# Task 1.3 Review — Append-only Audit Log

Reviewer: independent reviewer / test author
Implementation author: Copilot
Test command: `npx vitest run` (Vitest 4.1.12)
Test file: `tests/integration/audit-append-only.test.ts`
Boundary respected: only `tests/` and `docs/reviews/` were written; no Docker container was
started, stopped, created or removed; no credential value was read or printed.

## Method

Each rejected statement runs in its own `db.transaction(...)` obtained from
`src/server/db/client.ts`, and the transaction is rolled back via a sentinel after assertions.
The TRUNCATE case is therefore safe even if the trigger is missing: its transaction is always
rolled back. SQLSTATE is read recursively from the error (top-level Drizzle wrapper and its
`cause`) and asserted exactly for every rejected case.

## Pass/fail table

| # | Check | Expected | Result | Observed |
|---|-------|----------|--------|----------|
| 1 | Insert with valid org, branch, actor | success | PASS | row returned |
| 2 | Insert with NULL branch and NULL actor | success | PASS | both columns NULL |
| 3 | UPDATE an audit row | 42501 + "append-only" | PASS | 42501; cause message contains `audit_events is append-only` |
| 4 | DELETE an audit row | 42501 | PASS | 42501 |
| 5 | TRUNCATE audit_events | 42501 | PASS | 42501; transaction rolled back |
| 6 | Branch from a different organization | 23503 | PASS | 23503 |
| 7 | Actor from a different organization | 23503 | PASS | 23503 |
| 8 | Three user-defined triggers on audit_events | 3 triggers | **FAIL** | only 2 found: `audit_events_block_truncate`, `audit_events_block_update_or_delete`; no SQLSTATE (assertion on count) |
| 9 | Second `npm run db:migrate` applies nothing new | count + hash unchanged | PASS | both runs exit 0; migrations folder count and SHA-256 unchanged |

No schema was changed to make a test pass. The only failing test is #8; no SQLSTATE was
returned for it because it is a metadata assertion, not a rejected statement.

## Full `npx vitest run` output

```text
 RUN  v4.1.12 C:/Users/DELL/pharmacy-pos

 ❯ tests/integration/audit-append-only.test.ts (9 tests | 1 failed) 2582ms
     × reports three user-defined triggers on audit_events 11ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/integration/audit-append-only.test.ts > append-only audit log > reports three user-defined triggers on audit_events
AssertionError: triggers found: audit_events_block_truncate, audit_events_block_update_or_delete: expected [ 'audit_events_block_truncate', …(1) ] to have a length of 3 but got 2

- Expected
+ Received

- 3
+ 2

 ❯ tests/integration/audit-append-only.test.ts:253:70
    251|       const names = result.rows.map((row) => row.tgname);
    252|
    253|       expect(names, `triggers found: ${names.join(", ") || "none"}`).t…
       |       ^
    254|     });
    255|   });
 ❯ tests/integration/audit-append-only.test.ts:39:7
 ❯ NodePgSession.transaction node_modules/src/node-postgres/session.ts:259:18
 ❯ withRollback tests/integration/audit-append-only.test.ts:38:5
 ❯ tests/integration/audit-append-only.test.ts:244:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 27 passed | 1 skipped (29)
   Start at  04:56:02
   Duration  3.32s (transform 273ms, setup 0ms, import 1.41s, tests 5.52s, environment 0ms)
```

## Trigger bypass by the table owner

**Yes, the trigger can be bypassed by the table owner.** A role that owns `audit_events` can
run `ALTER TABLE audit_events DISABLE TRIGGER ...` or `DROP TRIGGER ...`, and a superuser can
set `session_replication_role = replica` to suppress trigger execution. The tests do not
attempt a bypass; they only verify that normal UPDATE/DELETE/TRUNCATE statements fail with
42501.

`docs/adr/0004-app-database-role.md` records this risk explicitly: line 9 states that the
append-only trigger can be bypassed by the table owner, lines 10-12 require the application to
connect with a role holding only INSERT and SELECT on `audit_events`, and lines 14-15 call the
role split a required step before first deployment while noting it is not yet implemented.

## Findings

### High

None.

### Medium

1. **File/line:** `db/migrations/0002_audit_events_append_only.sql:11-19`.
   **Problem:** only two user-defined triggers are created: one `BEFORE UPDATE OR DELETE`
   row trigger and one `BEFORE TRUNCATE` statement trigger. The acceptance criterion expects
   three triggers (separate UPDATE, DELETE and TRUNCATE), so test 8 fails with 2 found:
   `audit_events_block_truncate` and `audit_events_block_update_or_delete`. The enforcement
   itself works (42501 for all three operations), but the trigger inventory does not match
   the requirement and is harder to audit.
   **Fix recommended for Copilot:** either split the combined trigger into
   `audit_events_block_update` and `audit_events_block_delete` (keeping
   `audit_events_block_truncate`) in a new migration, or obtain agreement that two triggers
   covering three events is acceptable and update the acceptance criterion/test accordingly.
   Do not edit an already-applied migration; add a new one.

2. **File/line:** `docs/adr/0004-app-database-role.md:14-15`.
   **Problem:** the ADR says the least-privilege application role is required before first
   deployment and that the decision does not create or configure it. No role provisioning or
   grant script was found in the repository, so the documented append-only guarantee still
   depends on the connection role being correct at deploy time.
   **Fix recommended for Copilot:** add a deployment migration/script that creates the
   application role, grants only INSERT and SELECT on `audit_events`, and verifies the app's
   `DATABASE_URL` uses that role. Keep the owner role for migrations only.

### Low

3. **File/line:** `db/migrations/0002_audit_events_append_only.sql:1-19` (no corresponding
   Drizzle schema entry in `db/schema/audit-events.ts`).
   **Problem:** the trigger and function exist only as raw SQL in a migration. A future
   `npm run db:generate` from the schema will not know about them, so schema drift can be
   introduced silently; the file-hash check only detects changes to files, not missing DB
   objects.
   **Fix recommended for Copilot:** document that this migration is hand-written and must be
   preserved, or add a regression test that asserts the trigger names and function body (the
   current test 8 is the start of that coverage).

4. **File/line:** `src/server/db/client.ts:13`.
   **Problem:** the pool error handler logs only `error.name` and `error.message`. For wrapped
   query errors the useful cause message (here `audit_events is append-only`) is not included,
   which makes production diagnosis harder; the test had to walk the `cause` chain to find it.
   **Fix recommended for Copilot:** when reporting query failures, include the innermost
   cause message after redaction, while still never logging the connection string or the
   full error object.
