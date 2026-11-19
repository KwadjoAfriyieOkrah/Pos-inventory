# Task 1.5 Review — Terminals

Reviewer: independent reviewer / test author
Implementation author: Copilot
Test command: `npx vitest run` (Vitest 4.1.12)
Test files: `tests/integration/login.test.ts`, `tests/integration/terminals.test.ts`
Boundary respected: only `tests/` and `docs/reviews/` were written; no Docker container was
started, stopped, created or removed; no `DATABASE_URL`, `TEST_DATABASE_URL`, token, code, or
password value was read or printed.

## Method

All database fixtures are created inside a transaction that is always rolled back with a
sentinel. `login.test.ts` now uses a fixture that creates a branch, creates a raw token in the
test, passes that raw token as the `pos_terminal` cookie, and stores only
`hashTerminalToken(token)` in the terminal row. The mocked `@/server/db/client` delegates to
the active transaction. `terminals.test.ts` asserts SQLSTATE `23503` for the cross-organization
FK case and uses application-level assertions for the other rejections.

The console-output test now allows exactly one console line: the labeled one-time registration
print in `scripts/register-terminal.ts`. All other `console.*` calls are scanned for token,
code, password, hash, or `DATABASE_URL` identifiers.

## Pass/fail table — `tests/integration/login.test.ts`

| # | Test | Result |
|---|------|--------|
| 1 | unknown email returns ok:false and writes one unknown_email audit row | PASS |
| 2 | login without the pos_terminal cookie is refused and writes no audit row | PASS |
| 3 | wrong password writes one bad_password audit row without credentials | PASS |
| 4 | inactive user writes one inactive audit row | PASS |
| 5 | correct password for active user writes one login_succeeded audit row | PASS |
| 6 | failed login_succeeded audit insert returns ok:false and commits no login row | PASS |
| 7 | failed login_failed audit insert still returns ok:false and creates no session | PASS |
| 8 | reports unknown-email and wrong-password timings without failing on them | PASS |
| 9 | shows exactly one error message for every failure path | PASS |
| 10 | finds no password, password_hash, or AUTH_SECRET in src console calls | PASS |
| 11 | re-review: wrong password on active user records bad_password | PASS |
| 12 | re-review: inactive user with correct password records inactive | PASS |
| 13 | re-review: inactive user with wrong password records inactive_and_bad_password | PASS |
| 14 | re-review: database error keeps SQLSTATE through cause chain and logs only the code | PASS |
| 15 | re-review: INVALID_LOGIN_MESSAGE is exported and imported without duplicate literal | PASS |
| 16 | re-review: ADR 0005 status is Proposed | PASS |
| 17 | re-review: failure payloads contain no IP, email, password, or hash | PASS |

## Pass/fail table — `tests/integration/terminals.test.ts`

| # | Test | Result |
|---|------|--------|
| 1 | terminal in organization A cannot reference branch in organization B | PASS |
| 2 | registration code can be used once and second use returns generic message | PASS |
| 3 | expired registration code is rejected with the same generic message | PASS |
| 4 | stored terminal token_hash is 64 hex characters and never the raw token | PASS |
| 5 | resolveTerminal returns null for revoked, unknown, and missing tokens | PASS |
| 6 | login without terminal cookie is refused and writes no audit row | PASS |
| 7 | unknown email from registered terminal writes one org/branch/terminal-scoped audit row | PASS |
| 8 | same unknown email from two terminals branches writes two branch-scoped rows | PASS |
| 9 | known user failed login records terminal_id and actor_user_id together | PASS |
| 10 | allows exactly one labeled registration console line and no other secret prints | PASS |
| 11 | Task 1.3 audit triggers are still present after later migrations | PASS |

## Full `npx vitest run` output

```text
 RUN  v4.1.12 C:/Users/DELL/pharmacy-pos


 Test Files  5 passed (5)
      Tests  56 passed | 1 skipped (57)
   Start at  05:59:16
   Duration  3.72s (transform 839ms, setup 0ms, import 3.65s, tests 7.39s, environment 1ms)
```

## Previous findings status

| Previous finding | Status | Evidence |
|---|---|---|
| Medium — `scripts/register-terminal.ts:31-33` logged a variable named `code` | **Resolved** | Script now has `getSqlstate` at `:25-37`, logs `sqlstate` at `:46` and `:67`, and uses the single labeled one-time print `console.log("Registration code (shown once):", registrationCode)` at `:64`. The new console test passes. |
| Medium — `src/server/auth/login.ts:105` stores `attempted_email` | **Open item — not a bug** | Still present at `login.ts:104`: `payload: { reason: "unknown_email", attempted_email: email }`. See the Ghanaian data-protection note below. |
| Low — `src/server/auth/login.ts:95` logged email domain | **Resolved** | `login.ts:93-95` no longer contains a `console.info` call; the new unknown-email path goes straight to the audit insert. |
| Low — `src/app/(auth)/login/actions.ts:6-7` duplicate imports from one module | **Resolved** | `actions.ts:6` has a single import of `INVALID_LOGIN_MESSAGE`; `UNREGISTERED_TERMINAL_MESSAGE` is a local constant at `:9-10`. |

## Ghanaian data-protection open item

The field `attempted_email` in the `auth.login_failed` payload at `src/server/auth/login.ts:104`
stores personal data in an append-only audit table. This is recorded as an **open compliance
item, not a bug**: it needs review against Ghanaian data-protection requirements before
go-live. The test suite does not fail on it, and no source change was made in this review.

## Can a stolen terminal token let someone log in as a user?

**No — not by itself.** The token is a device credential only.

Code path:

1. `src/server/auth/terminal.ts:7-9` hashes tokens with SHA-256; only the hash is stored.
2. `src/server/auth/terminal.ts:15-33` resolves a token by comparing its hash and requiring
   `revoked_at IS NULL`. A stolen token can be replayed only while that terminal is active.
3. `src/server/auth/login.ts:59-66` reads the `pos_terminal` cookie and aborts if resolution
   fails.
4. `src/server/auth/login.ts:81-87` selects the user by email **and**
   `users.organizationId = terminal.organizationId`. A token from organization A cannot
   authenticate a user from organization B.
5. `src/server/auth/login.ts:115` verifies the supplied password with Argon2; `:117-142`
   refuses mismatches and inactive users.
6. `src/server/auth/login.ts:145-171` writes the success audit row and returns the user only
   after password verification.
7. `src/server/auth/config.ts:34-44` uses that result in `authorize`; `jwt`/`session` callbacks
   at `:48-70` require the resulting user claims before a session exists.
8. `src/app/(auth)/login/actions.ts:16-25` pre-checks the terminal but still calls `signIn`,
   which runs the full credential check.

A stolen token lets an attacker attempt logins from that terminal's organization/branch
context and write audit rows tied to that terminal, enabling credential-stuffing or
enumeration attempts. It does **not** mint a session without the user's password and matching
organization. Revoking the terminal stops the token at step 2.

## New findings

### High

None.

### Medium

None.

### Low

None.
