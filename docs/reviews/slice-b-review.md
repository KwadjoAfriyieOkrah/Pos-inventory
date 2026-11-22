# Slice B review

Full-suite command: `npx vitest run`
Database: `pos_test`

## Pass/fail

| Result | Evidence |
|---|---|
| Pass | Full suite: 9 test files passed, 100 tests passed; no failures. No assertion was relaxed or changed. |

Summary lines:

```text
 Test Files  9 passed (9)
      Tests  100 passed (100)
   Start at  08:06:14
   Duration  16.47s (transform 1.58s, setup 0ms, import 8.80s, tests 42.13s, environment 1ms)
```

## Findings

### High

1. **Stale migration ledger: RESOLVED.** The test-local schema drop and migration rerun was removed from `tests/integration/read-path.test.ts`; the full suite was run relying only on the global reset. The global reset script now drops the `drizzle` schema before migrating. Evidence: the 100-of-100 full-suite run above.

### Medium

1. **Local env file can point tests at the development database.** The local env file used by integration tests names `pos_dev`, while the test runner targets `pos_test`. Loading it without an explicit override makes the shared client query the wrong schema. `tests/integration/read-path.test.ts` pins its process to the test database before importing the env module; other integration files remain exposed to the same mismatch.

### Low

1. **Denial durability is not covered by this test.** The harness routes the shared client to the rolled-back transaction, so the `access.denied` row is visible to the assertion but is itself rolled back. This verifies the write for Branch B; survival of caller rollback is covered by the existing permissions integration suite and was not duplicated here.
