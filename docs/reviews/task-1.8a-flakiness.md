# Task 1.8a Flakiness Diagnosis

Scope: diagnosis plus self-describing assertion hardening. Write boundary kept to `tests/` and `docs/reviews/`. Temporary diagnostic logging was added only to `tests/integration/rate-limit.test.ts` and removed before finishing. No `src/`, `db/`, `scripts/`, config, Docker, or `docs/adr/` change was made. All diffs used `git --no-pager`. No `DATABASE_URL`, `TEST_DATABASE_URL`, token, password, or email address was printed.

The source result does not expose SQLSTATE `55P03` to the test; it maps that error to `LOCK_TIMEOUT_LOGIN_MESSAGE`. The 2-second per-attempt duration check used earlier was only an **indirect stand-in** for a lock timeout, not direct evidence of SQLSTATE `55P03`.

## 1. Test alone, 10 runs

Command: `npx vitest run tests/integration/rate-limit.test.ts -t "20 concurrent"`

Diagnostic metrics were captured with the same test selection plus `--reporter=dot --silent=false`; the exact command above was also run 10 times and produced the same pass/fail results.

| Run | Pass/fail | Failure rows (email key) | Password checks | Lock-message count | Busy-message count | Lock-timeout proxy (>2s) | 20-attempt elapsed |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | PASS | 5 | 5 | 0 | 15 | 0 | 104.7ms |
| 2 | PASS | 5 | 5 | 0 | 15 | 0 | 125.2ms |
| 3 | PASS | 5 | 5 | 0 | 15 | 0 | 110.5ms |
| 4 | PASS | 5 | 5 | 0 | 15 | 0 | 114.7ms |
| 5 | PASS | 5 | 5 | 0 | 15 | 0 | 128.2ms |
| 6 | PASS | 5 | 5 | 0 | 15 | 0 | 128.5ms |
| 7 | PASS | 5 | 5 | 0 | 15 | 0 | 128.1ms |
| 8 | PASS | 5 | 5 | 0 | 15 | 0 | 125.7ms |
| 9 | PASS | 5 | 5 | 0 | 15 | 0 | 122.4ms |
| 10 | PASS | 5 | 5 | 0 | 15 | 0 | 124.2ms |

Alone: `10/10 PASS`. Every run recorded exactly 5 failure rows, 5 password checks, 0 lock messages, 15 busy messages, and 0 attempts over 2 seconds.

## 2. Full suite, 3 runs

Command: `npx vitest run --reporter=verbose --silent=false`

| Run | Full suite | Concurrency test | Reported test duration | Diagnostic elapsed | Failure rows (email key) | Password checks | Lock-message count | Busy-message count | Lock-timeout proxy (>2s) |
|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | PASS | PASS | 159ms | 140.1ms | 5 | 5 | 1 | 14 | 0 |
| 2 | PASS | PASS | 246ms | 221.1ms | 5 | 5 | 1 | 14 | 0 |
| 3 | PASS | PASS | 335ms | 294.8ms | 5 | 5 | 1 | 14 | 0 |

Full suite: `3/3 PASS`. The 20-attempt test passed each time. Durations increased under parallel load, and the refusal mix shifted from `0 lock + 15 busy` when alone to `1 lock + 14 busy` in the full suite, but failure rows stayed at exactly 5.

## 3. Hypothesis verdict

Hypothesis: “A timed-out attempt is refused without a failure row, so the failure count drops below 5 under load.”

Verdict: **Provisionally rejected for the observed runs only.** This verdict remains provisional until a failing run’s self-describing numbers are captured.

Evidence:
- The predicted signature was failure rows of `3` or `4` plus at least one timeout.
- Observed failure rows were `5` in all 13 runs (10 alone + 3 full suite).
- The indirect 2-second timeout stand-in was `0` in all 13 runs; no individual attempt exceeded 2 seconds.
- Password checks were `5` in all 13 runs.
- Busy messages (`15` alone, `14` in full suite) were admission refusals, not observed slow SQLSTATE timeouts.
- The full suite’s extra lock message (`1`) means one subsequently admitted attempt saw the rate limit already reached. It did not reduce failure rows or password checks.

## 4. Alone vs parallel

| Mode | Runs | Result | Failure rows | Password checks | Lock messages | Busy messages | Timeout proxy |
|---|---:|---|---:|---:|---:|---:|---:|
| Alone | 10 | 10/10 PASS | 5 | 5 | 0 | 15 | 0 |
| Full suite parallel | 3 | 3/3 PASS | 5 | 5 | 1 | 14 | 0 |

Difference: parallel execution makes the test slower and changes one refusal from a busy/timeout-style message to the rate-limit lock message. It does **not** drop failure rows and does not produce timeout-like attempts. Both modes pass with the current committed-fixture model.

## 5. Unawaited assertion warning

No current warning was reproduced. Command output from `npx vitest run --reporter=verbose --silent=false | Select-String -Pattern "Promise returned by|resolves\.toBeNull|not awaited"` was empty.

Historical source from the prior review output: `tests/integration/terminals.test.ts:423`, old text:

```ts
expect(resolveTerminal(undefined)).resolves.toBeNull();
```

A prior round already changed the equivalent line to `await expect(...)`; current `git --no-pager diff -- tests/integration/terminals.test.ts` shows the current line at `tests/integration/terminals.test.ts:378`:

```ts
await expect(resolveTerminal(undefined)).resolves.toBeNull();
```

No change was made to that warning in this task.

## 6. Diagnostic logging removal

Temporary marker: `RATE_LIMIT_DIAGNOSTIC`.

Verification after removal:

```text
MATCH_COUNT=0
```

Final checks after removal:
- `npx vitest run tests/integration/rate-limit.test.ts -t "20 concurrent"` → `1 passed | 11 skipped (12)`.
- `npx tsc --noEmit` → exit `0`.

## 7. Self-describing assertion hardening

The `"20 concurrent"` test now records elapsed time with `performance.now()` from immediately before the 20 calls until immediately after the last call. It also counts lock-message and busy-message refusals by exact text and includes all observed values in every assertion message.

Full suite was then run up to 8 times with the operator loop. All 8 runs passed, so no failing assertion line was available to paste. Final result: `8/8 PASS`, `110 passed (110)` each run.

No fix is proposed from the current evidence. The earlier “rejected” verdict remains provisional until a failing run’s self-describing numbers are captured.
