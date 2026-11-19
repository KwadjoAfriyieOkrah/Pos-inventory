# Task 1.8a Round 5 Review — Real connection model

Test files:
- `tests/integration/login.test.ts`
- `tests/integration/rate-limit.test.ts`
- `tests/integration/terminals.test.ts`
- `tests/integration/login-pool.test.ts`
- `tests/integration/reset-ledger.test.ts`

Test command: `npx vitest run` (Vitest 4.1.12)
Typecheck: `npx tsc --noEmit` exit `0`
Lint: `npm run lint` → `2 problems (0 errors, 2 warnings)`; both are pre-existing in `src/lib/money.ts`.

Write boundary kept to `tests/` and `docs/reviews/`. No `src/`, `db/`, `scripts/`, config, or `docs/adr/` file was edited. No Docker container was started, stopped, or removed. No `DATABASE_URL`, `TEST_DATABASE_URL`, token, password, or email address was printed. All diffs used `git --no-pager`.

## 1. Pass/fail table

| # | File:line / command | Check | Result |
|---|---:|---|---|
| 1 | `tests/integration/login.test.ts:154` | Login-test org/branch/user/terminal fixtures are committed through the shared client | PASS |
| 2 | `tests/integration/rate-limit.test.ts:119` | Rate-limit org/branch/user/terminal fixtures are committed through the shared client | PASS |
| 3 | `tests/integration/terminals.test.ts:145` | Login-path terminal fixtures are committed through the shared client; rollback remains only for direct-client tests | PASS |
| 4 | `tests/integration/login.test.ts:48`, `rate-limit.test.ts:74`, `terminals.test.ts:52`, `login-pool.test.ts:60` | Behavioral mocks of `@/server/db/client` removed; only an alias passthrough to the real client remains | PASS |
| 5 | `tests/integration/login.test.ts:50` | Failing audit insert is injected inside the real `authDb.transaction` | PASS |
| 6 | `tests/integration/rate-limit.test.ts:309-312` | Concurrency assertion unchanged: 5 password checks, 5 failure rows, 15 refusals | PASS |
| 7 | `npx vitest run` | Full suite | PASS — `110 passed (110)` |
| 8 | `npx vitest run 2>&1 \| Select-String "FAIL"` | FAIL grep | PASS — no output |
| 9 | `tests/integration/login-pool.test.ts:230` | Terminal B login threshold remains `3000ms` | PASS — 3 runs `2127.0ms`, `2145.4ms`, `2135.9ms` |
| 10 | `tests/integration/login-pool.test.ts:292` | Auth pool connection-wait measured while pool is full | PASS — `1012.0ms`, `1004.3ms`, `1001.0ms`; all timed out |
| 11 | `npx tsc --noEmit` | Typecheck | PASS — exit `0` |
| 12 | `npm run lint` | Lint | PASS — 0 errors, 2 pre-existing warnings |

## 2. Connection-model changes

- Login-test fixtures now run through the real shared `db` client and commit before login. The old `activeDb` transaction bridge is gone.
- `login.test.ts` mocks `../../src/server/auth/login-db` only to wrap the real `authDb`. `transaction()` delegates to the real `authDb.transaction()` and injects the failure inside that transaction callback.
- `rate-limit.test.ts`, `terminals.test.ts`, and `login-pool.test.ts` no longer mock `authDb`; login runs on the real separate auth pool.
- The `@/server/db/client` mock in each file is now a module-resolution passthrough: `vi.mock("@/server/db/client", async () => await import("../../src/server/db/client"))`. It does not redirect query behavior.
- `withRollback` remains only in `terminals.test.ts` tests that use a transaction client directly and never call `login` or `exchangeCode`.
- Both shared pool and auth pool are closed in `afterAll` for each test file.

## 3. Changed assertions

No `expect()` line was removed. No existing assertion was weakened. The concurrency assertion remains exactly:

```ts
expect(harness.verifyPassword).toHaveBeenCalledTimes(EMAIL_LIMIT);
expect(await emailFailureCount(db, context.email, INJECTED_NOW)).toBe(EMAIL_LIMIT);
expect(refusals).toHaveLength(20 - EMAIL_LIMIT);
expect(ordinaryFailures).toHaveLength(EMAIL_LIMIT);
```

Every `expect()` line changed in round 5:

| File:line | Old text | New text |
|---|---|---|
| `tests/integration/terminals.test.ts:378` | `expect(resolveTerminal(undefined)).resolves.toBeNull();` | `await expect(resolveTerminal(undefined)).resolves.toBeNull();` |
| `tests/integration/login-pool.test.ts:312` | `(none)` | `expect(waitError, "expected the ninth auth pool connection request to time out").toBeDefined();` |
| `tests/integration/login-pool.test.ts:313` | `(none)` | `expect(waitMs).toBeGreaterThanOrEqual(900);` |
| `tests/integration/login-pool.test.ts:314` | `(none)` | `expect(waitMs).toBeLessThan(2000);` |

## 4. Pool timings

The 3-second terminal B threshold was not changed. `pool_watcher_ms` is the terminal B login time.

| Run | `pool_watcher_ms` | `pool_busy` | `pool_max_attempt_ms` | `pool_ordinary_read_ms` | `auth_pool_wait_ms` | `auth_pool_wait_timed_out` |
|---:|---:|---:|---:|---:|---:|---|
| 1 | 2127.0 | 49 | 2127.7 | 10.0 | 1012.0 | true |
| 2 | 2145.4 | 49 | 2145.9 | 7.6 | 1004.3 | true |
| 3 | 2135.9 | 49 | 2136.4 | 7.7 | 1001.0 | true |

Auth-pool wait was measured by holding all 8 `authPool` clients and timing the 9th `authPool.connect()` request. It waited about one second before rejecting with the configured `connectionTimeoutMillis: 1000`, then the held clients were released.

## 5. Full `npx vitest run` output

```text
npx : npm notice run pharmacy-pos@0.1.0 npx
At line:1 char:1
+ npx vitest run 2>&1 | Tee-Object -FilePath "C:\Users\DELL\AppData\Local\Temp\opencode\round5-full.txt"
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (npm notice run pharmacy-pos@0.1.0 npx:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
 
npm notice run ^"vitest^" run

 RUN  v4.1.12 C:/Users/DELL/pharmacy-pos

pos_test reset complete

 Test Files  11 passed (11)
      Tests  110 passed (110)
   Start at  14:17:14
   Duration  18.89s (transform 1.60s, setup 0ms, import 11.30s, tests 57.74s, environment 2ms)
```

## 6. FAIL grep output

Command: `npx vitest run 2>&1 | Select-String "FAIL"`

```text
EXIT_CODE=0
```

No `FAIL` lines were emitted. Final failing tests: none.

Interim full-suite failures were fixed at the root and no test was skipped or deleted:
- `Task 1.8a sliding-window rate limiting > boundary: five failures at 14:59 lock the attempt at 15:01` — first assertion error: `AssertionError: expected { ok: true, user: { …(4) } } to deeply equal { ok: false, …(1) }`. Cause: the fixed historical fake clock made these failure rows look stale to real-clock logins in other files, which pruned them globally.
- `terminals > registration code can be used once and second use returns generic message` — first assertion error: `duplicate key value violates unique constraint "terminal_registration_codes_code_hash_unique"`. Cause: fixed code literal collided across committed fixtures.
- `terminals > expired registration code is rejected with the same generic message` — first assertion error: `duplicate key value violates unique constraint "terminal_registration_codes_code_hash_unique"`. Cause: fixed code literal collided across committed fixtures.

## Findings

### High

| File | Line | Problem | Fix |
|---|---:|---|---|
| `tests/integration/rate-limit.test.ts` | 31 | Fixed `INJECTED_NOW = new Date("2026-01-01T15:05:00.000Z")` made committed failure rows stale relative to real-clock logins in other test files; concurrent `pruneStaleFailures` deleted them and the boundary test failed only in the full suite. | Changed to `const INJECTED_NOW = new Date();`; all offset fixtures still derive from the injected clock, but they no longer look stale to real-clock files. Full suite passed. |
| `tests/integration/terminals.test.ts` | 42 | Fixed registration-code literals collided after fixtures became committed (`23505`). | Added `randomRegistrationCode()` using the allowed `A-Z2-7` alphabet and used it in both registration-code tests. Full suite passed. |

### Medium

| File | Line | Problem | Fix |
|---|---:|---|---|
| `tests/integration/login.test.ts` | 48 | Behavioral `@/server/db/client` mock routed login through the test transaction instead of the real connection model. | Replaced with a real-client alias passthrough; fixtures commit through shared `db`. |
| `tests/integration/login.test.ts` | 50 | Fault injection needed to follow the new `authDb` path without bypassing real transaction behavior. | `authDb` wrapper delegates to real `authDb.transaction()` and throws on `insert` inside the transaction callback. |
| `tests/integration/rate-limit.test.ts` | 74 | Behavioral shared-client and `authDb` mocks hid the separate-pool model. | Removed both; kept only alias passthrough and committed fixtures. |
| `tests/integration/terminals.test.ts` | 52 | Behavioral shared-client and `authDb` mocks hid the separate-pool model. | Removed both; kept only alias passthrough and committed fixtures for tests that call `login`, `loginAction`, `resolveTerminal`, or `exchangeCode`. |
| `tests/integration/login-pool.test.ts` | 60 | Behavioral shared-client wrapper was unnecessary after the real connection-model change. | Replaced with real-client alias passthrough. |

### Low

| File | Line | Problem | Fix |
|---|---:|---|---|
| `tests/integration/terminals.test.ts` | 378 | Unawaited `.resolves` assertion produced a Vitest deprecation warning. | Added `await`; assertion text otherwise unchanged. |
| `tests/integration/login.test.ts` | 70 | Two injected-failure tests log `unknown` from the production error-code logger. | Expected result of fault injection; no credential or email text is printed. No change needed. |
| `src/lib/money.ts` | 4, 10 | Two pre-existing ESLint unused-variable warnings. | Out of write boundary; left unchanged. |
