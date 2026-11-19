# Task 1.4 Review — Login

Reviewer: independent reviewer / test author
Implementation author: Copilot
Test command: `npx vitest run` (Vitest 4.1.12)
Test file: `tests/integration/login.test.ts`
Boundary respected: only `tests/` and `docs/reviews/` were written; no Docker container was
started, stopped or removed; no `DATABASE_URL`, `AUTH_SECRET`, or stored password value was
read or printed.

## Method

All test users and organizations are created inside `db.transaction(...)` and the transaction
is always rolled back with a sentinel after assertions. The mocked `@/server/db/client`
delegates `select`, `insert` and `transaction` to that same transaction, so login's audit
writes are visible to assertions and are rolled back too. Simulated audit failures are
application-level stubs that throw. The re-review added a nested-cause SQLSTATE case, source
checks for the exported error constant, and a payload-privacy sweep. Credentials used in tests
are fixed literals defined in the test file, not values read from the environment or database.

## Original pass/fail table

| # | Check | Expected | Result | Observed |
|---|-------|----------|--------|----------|
| 1 | Unknown email | `{ ok: false }`, 0 audit rows | PASS | matched |
| 2 | Wrong password | `{ ok: false }`, 1 `auth.login_failed` payload `{ reason: "bad_password" }`, no email/password text | PASS | matched; payload contained only the reason |
| 3 | Inactive user | `{ ok: false }`, 1 `auth.login_failed` payload `{ reason: "inactive" }` | PASS | matched |
| 4 | Correct password, active user | `{ ok: true }`, 1 `auth.login_succeeded` row | PASS | matched; payload `{}` |
| 5 | `auth.login_succeeded` insert stub throws | `{ ok: false }`, no committed login/audit row | PASS | matched |
| 6 | `auth.login_failed` insert stub throws | `{ ok: false }`, no `user`, no audit row | PASS | matched |
| 7 | Timing: unknown email vs wrong password | report both, no magnitude failure | PASS | `unknown=14.8ms`, `wrong=16.1ms` (same order of magnitude) |
| 8 | Failure message | exactly `Email or password is incorrect` for every failure | PASS | matched for unknown email, wrong password, inactive and audit-failure cases |
| 9 | `src/` console calls | no password, `password_hash`, or `AUTH_SECRET` argument | PASS | no violations found |

## Re-review pass/fail table

| # | Check | Expected | Result | Observed |
|---|-------|----------|--------|----------|
| 1 | Wrong password on active user | payload reason `bad_password` | PASS | matched |
| 2 | Inactive user with correct password | payload reason `inactive` | PASS | matched |
| 3 | Inactive user with wrong password | payload reason `inactive_and_bad_password` | PASS | matched |
| 4 | DB error with nested SQLSTATE | `console.error` receives `28P01` only; result `{ ok: false }` | PASS | one call `["28P01"]`; no full error object logged |
| 5 | Shared error-message constant | exported from `login.ts`, imported by `actions.ts`, single literal in `src/` | PASS | only `src/server/auth/login.ts` contains the literal |
| 6 | ADR 0005 status | `Proposed`, not `Accepted` | **FAIL** | file still says `Accepted` |
| 7 | Failure payload privacy | no IP, email, password, or hash for any failure reason | PASS | payloads contained only the three reason strings |

## Full `npx vitest run` output

```text
 RUN  v4.1.12 C:/Users/DELL/pharmacy-pos

 ❯ tests/integration/login.test.ts (16 tests | 1 failed) 744ms
     × re-review: ADR 0005 status is Proposed 6ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/integration/login.test.ts > login > re-review: ADR 0005 status is Proposed
AssertionError: expected '# ADR 0005: Unresolved events policy\…' to match /## Status\s*\n\s*Proposed\b/

- Expected:
/## Status\s*\n\s*Proposed\b/

+ Received:
"# ADR 0005: Unresolved events policy

## Status

Accepted

## Decision

1. A sale recorded during an outage is never reversed automatically when a later sync or login event is rejected.
2. Each rejected event goes to an unresolved queue with: original timestamp, terminal, cashier, rejection reason, amount, and item count. Nothing in the queue is ever deleted.
3. The owner resolves each item within 24 hours by choosing accept, correct, or refund. A refund is a new record; the original remains.
4. If the owner is the subject of the rejection, or is unavailable for more than 24 hours, a second reviewer named in the branch settings resolves it. The second reviewer is a placeholder until the client names one.
5. Unresolved items are shown on the owner dashboard as a count and a total in GH₵, and appear in the printed end-of-day summary.
6. Sale approval and login authority are separate decisions. A rejected login flags the sales it covered for review; it does not void them.

## Open client questions

- the name of the second reviewer
- the escalation time if both reviewers are unavailable
- whether a printed end-of-day summary is required by law or only by the client
"

 ❯ tests/integration/login.test.ts:498:17

 Test Files  1 failed | 3 passed (4)
      Tests  1 failed | 43 passed | 1 skipped (45)
   Start at  05:32:50
   Duration  3.01s (transform 396ms, setup 0ms, import 2.23s, tests 5.46s, environment 0ms)

    496|     );
    497|
    498|     expect(adr).toMatch(/## Status\s*\n\s*Proposed\b/);
       |                 ^
    499|     expect(adr).not.toMatch(/## Status\s*\n\s*Accepted\b/);
    500|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## Status of earlier findings

| Earlier finding | Status | Evidence |
|---|---|---|
| Medium — `src/server/auth/login.ts:81` inactive + wrong password reason hid bad password | **Resolved** | `login.ts:82-86` now derives `inactive_and_bad_password`; re-review tests 1-3 pass. |
| Medium — `src/server/auth/login.ts:25-37` only top-level SQLSTATE checked | **Resolved** | `login.ts:27-46` now walks `cause` with a cycle guard; re-review test 4 passes with nested `28P01` and logs only `["28P01"]`. |
| Low — `src/server/auth/login.ts:66` logs email domain | **Still open** | Code is now at `login.ts:75` and still calls `console.info(email.slice(email.lastIndexOf("@") + 1))`; original check 9 still passes because a domain is not a forbidden credential value. |
| Low — `src/server/auth/password.ts:22-24` random dummy hash | **Still open** | File still uses `await hashPassword(randomBytes(32).toString("base64url"))`; timing remains adequate but not deterministic. |
| Low — `src/app/(auth)/login/actions.ts:14` duplicated error string | **Resolved** | `login.ts:8` exports `INVALID_LOGIN_MESSAGE`; `actions.ts:5` imports it and `:15` uses it; re-review test 5 finds the literal in exactly one `src/` file. |

## Can any session still be issued if the audit database is unreachable?

**No.** The code path is fail-closed:

1. `src/server/auth/config.ts:34-36` — `authorize` calls `login`, and `if (!result.ok) return null;`.
2. `src/server/auth/login.ts:106-121` — the success audit insert is inside
   `try { await db.transaction(...) } catch { return { ok: false }; }`; line 120 returns
   `{ ok: false }` if the audit DB rejects or is unreachable.
3. `src/server/auth/login.ts:55-71` — a total DB outage during user lookup returns
   `{ ok: false }` at line 70.
4. `src/server/auth/login.ts:81-104` — failed-login audit rejection also returns `{ ok: false }`.
5. `src/server/auth/config.ts:48-57` — `jwt` only creates `sub` and `organizationId` when a
   `user` is supplied; `authorize -> null` supplies none.
6. `src/server/auth/config.ts:58-70` — `session` requires those claims and cannot fabricate
   them after a failed login.

Tests 5 and 6 from the original table prove both audit-insert branches return no `user`, so
no session material is produced.

## New findings

### High

None.

### Medium

1. **File/line:** `docs/adr/0005-unresolved-events-policy.md:5`.
   **Problem:** the ADR status is still `Accepted`, but the re-review requirement says it must
   be `Proposed`. The new test fails with `expected '# ADR 0005: Unresolved events policy\…' to match /## Status\s*\n\s*Proposed\b/`.
   **Fix recommended for owner:** change line 5 from `Accepted` to `Proposed`. This file is
   outside this review's write boundaries, so it was not changed here.

### Low

None new. The two earlier Low findings marked "Still open" above remain unchanged.
