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
application-level stubs that throw; no database error is expected in the 9 checks, so no
SQLSTATE assertion applies. Credentials used in tests are fixed literals defined in the test
file, not values read from the environment or database.

## Pass/fail table

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

## Full `npx vitest run` output

```text
 RUN  v4.1.12 C:/Users/DELL/pharmacy-pos


 Test Files  4 passed (4)
      Tests  37 passed | 1 skipped (38)
   Start at  05:20:56
   Duration  4.54s (transform 366ms, setup 0ms, import 2.41s, tests 8.35s, environment 0ms)
```

Timing values recorded by a focused verbose run of test 7:

```text
stdout | tests/integration/login.test.ts > login > reports unknown-email and wrong-password timings without failing on them
timing report: unknown=14.8ms wrong=16.1ms
```

## Can any session still be issued if the audit database is unreachable?

**No.** The code path is fail-closed:

1. `src/server/auth/config.ts:34-36` — the credentials provider calls
   `const result = await login(credentials); if (!result.ok) return null;`. Returning `null`
   tells NextAuth not to issue a session for these credentials.
2. `src/server/auth/login.ts:91-106` — the `auth.login_succeeded` insert is wrapped in
   `try { await db.transaction(...) } catch (error) { ... return { ok: false }; }`. If the
   audit insert throws (unreachable audit DB, missing permission, trigger rejection), line 105
   returns `{ ok: false }`.
3. `src/server/auth/login.ts:46-62` — if the database is unreachable even before audit,
   the user lookup throws and line 61 also returns `{ ok: false }`.
4. `src/server/auth/login.ts:72-88` and `:91-106` — both failed-audit insert paths also
   return `{ ok: false }`.
5. `src/server/auth/config.ts:48-57` — the `jwt` callback only creates `sub` and
   `organizationId` claims when NextAuth supplies a `user`. With `authorize` returning
   `null`, no such user exists, so no authenticated token claims are minted.
6. `src/server/auth/config.ts:58-70` — the `session` callback throws unless `token.sub` and
   `token.organizationId` are strings; there is no path that fabricates them after a failed
   login.
7. `src/app/(auth)/login/actions.ts:11-15` — `signIn` throws `AuthError` and the action
   returns the generic message, which `page.tsx:45-48` renders.

Tests 5 and 6 prove both audit-insert branches return `{ ok: false }` and contain no `user`
field, so no session material can be produced.

## Findings

### High

None.

### Medium

1. **File/line:** `src/server/auth/login.ts:81`.
   **Problem:** the failed-login reason is chosen with
   `user.isActive ? "bad_password" : "inactive"`. An inactive user who also submits a wrong
   password is recorded as `inactive`, hiding the actual bad-password event in the audit log.
   **Fix recommended for Copilot:** derive the reason from the password result first:
   `const reason = !passwordMatches ? "bad_password" : "inactive";` then use `reason` in the
   payload.

2. **File/line:** `src/server/auth/login.ts:25-37`, used at `:60`, `:84` and `:104`.
   **Problem:** `databaseErrorCode` only inspects the top-level `error.code`. Drizzle wraps
   PostgreSQL errors, so in earlier integration tests the useful SQLSTATE was on a nested
   `cause`; production logs can degrade to `"unknown"` and lose the SQLSTATE.
   **Fix recommended for Copilot:** walk the `cause` chain recursively, log the first
   `/^[0-9A-Z]{5}$/` code found, and include a redacted cause message.

### Low

3. **File/line:** `src/server/auth/login.ts:66`.
   **Problem:** `console.info(email.slice(email.lastIndexOf("@") + 1))` logs the email domain
   for unknown-email attempts. It is not a credential leak, but it exposes tenant/domain
   information to logs and can aid enumeration review.
   **Fix recommended for Copilot:** remove the statement or replace it with a constant metric
   label such as `unknown_email_attempt` that carries no user-controlled domain.

4. **File/line:** `src/server/auth/password.ts:22-24`.
   **Problem:** `DUMMY_HASH` is generated at module load with top-level `await` and a random
   value. It provides good timing equalisation, but the random value is never reproducible
   across restarts, making cold-start timing comparisons slightly noisy.
   **Fix recommended for Copilot:** leave as-is unless deterministic benchmarks are required;
   if so, use a fixed, obviously non-secret dummy hash checked into source with a comment
   explaining that it is only for timing equalisation.

5. **File/line:** `src/app/(auth)/login/actions.ts:14`.
   **Problem:** the error string is duplicated between server action and UI expectation; a
   future typo would be caught only by the new test, not by a shared constant.
   **Fix recommended for Copilot:** export a `LOGIN_ERROR_MESSAGE` constant from a shared
   module and use it in the action and the test.
