# Slice D review

Command: `npx vitest run`
Database: `pos_test` (enforced by `vitest.config.mts`; the test-local URL was not printed)
New test file: `tests/integration/sales-history.test.ts`

## Full suite summary

```text
 RUN  v4.1.12 C:/Users/DELL/pharmacy-pos

pos_test reset complete

 Test Files  12 passed (12)
      Tests  132 passed (132)
   Start at  04:28:28
   Duration  19.95s (transform 2.30s, setup 0ms, import 13.45s, tests 51.32s, environment 2ms)
```

Exit code: 0.

## First-run failure report

The first run of the new file had one failure. The first assertion error was:

```text
SalesHistoryFilterError: The sales history cursor is invalid.
 ❯ normalizeFilters src/server/data/sales-history.ts:145:13
 ❯ listSales src/server/data/sales-history.ts:218:22
 ❯ expectNoWrites tests/integration/sales-history.test.ts:463:18
 ❯ tests/integration/sales-history.test.ts:975:5
```

First-run summary:

```text
 Test Files  1 failed | 11 passed (12)
      Tests  1 failed | 131 passed (132)
```

Cause: the check-10 fixture built a cursor from `createdAt.toISOString()` (3 fractional digits). The cursor validator requires the 6-digit `cursorTimestamp` that the data layer returns. The fixture was changed to use `cursorTimestamp`; no assertion was relaxed or changed. The final run passed all 132 tests.

## Pass/fail

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Branch A cashier cannot list or open Branch B sales | Pass | Both calls throw `ForbiddenError("Access denied")`; an A-scoped list excludes the Branch B sale; only the two expected `access.denied` audit rows are appended |
| 2 | Newest first, 50-row cap, cursor pagination without duplicates or gaps | Pass | 55 seeded sales: page 1 has 50 with `hasMore=true`, page 2 has 5 with `hasMore=false`; timestamps non-increasing; union of ids equals all 55 seeded ids with no overlap |
| 3 | Sale total equals sum of line totals | Pass | For every row, `totalPesewas` equals the DB `SUM(line_total_pesewas)` and the detail line sum; list and detail totals agree |
| 4 | Detail lines carry batch number and expiry matching the sale movement | Pass | Two branch-A batches asserted by number and expiry; each has exactly one matching `sale` stock movement with `quantityDelta = -line.quantity`; movement count equals line count |
| 5 | Seven-day filter excludes 8-day-old sale, includes 6-day-old sale | Pass | Sale 8 days old absent, sale 6 days old present, and exactly one row returned |
| 6 | MoMo reference returned; cash returns none | Pass | MoMo row/detail expose the exact reference; cash row/detail have no `momoReference` property; cash tender 5000 and change 2500 |
| 7 | No unit cost field in any row or detail | Pass | Key walk and serialized JSON for every row, detail header, and detail line contain no `cost` key or text; `unitCostPesewas` absent |
| 8 | Every money value is a safe integer | Pass | `Number.isSafeInteger` and nonnegativity asserted for every `*Pesewas` value in rows and details, plus `lineCount` |
| 9 | Exported functions take `scope` then `access` first | Pass | AST check on `sales-history.ts` finds exactly `listSales`, `listSaleCashiers`, `getSaleDetail`; each has `scope: DataScope` then `access: AuthorizedBranch` |
| 10 | History calls change no sales, lines, payments, movements, or audit rows | Pass | Counts across all five tables captured before and after each successful call (list, cashier list, detail, filtered list, cursor list) and deep-equal |

Overall: **10 passed, 0 failed** for the new checks; **132 passed, 0 failed** for the full suite.

## Findings

### High

1. **No sales-history defect found.** All ten requested boundaries pass against the final suite; no source, `db/`, `scripts/`, or config file was modified and no assertion was changed to obtain a pass.

2. **Cross-branch reads are denied before any sale data is returned.** `listSales` and `getSaleDetail` both route through `requireBranch` with `PERMISSIONS.reportViewBranch`, producing `ForbiddenError("Access denied")` for a caller scoped only to Branch A.

### Medium

1. **Denials intentionally append an audit row.** `requireBranch` writes `access.denied` when permission is missing, so the no-write invariant is asserted for authorized calls. The denial check separately asserts that exactly two audit rows (and no sale, line, payment, or movement rows) are added by the two denied calls. This is existing authorization behavior, not a history-function write.

2. **Cursors must use the data layer's microsecond timestamp.** `listSales` validates a strict 6-digit `YYYY-MM-DDTHH:MM:SS.ffffffZ` cursor; `createdAt.toISOString()` produces only 3 digits. Callers should use `nextCursor` or the row's `cursorTimestamp`. The first-run failure above came from the test fixture, not from the implementation.

3. **Committed fixtures are isolated by unique identifiers.** Every organization, branch, role, user, medicine, batch, sale, idempotency key, and MoMo reference uses `randomUUID()`. Counts are scoped to the fixture organization so parallel test files cannot affect the no-write assertions.

### Low

1. **Reversals are not built.** The schema has no reversal rows, so the detail screen shows "No reversals". No reversal behavior was asserted or invented.

2. **Sale number is the sale UUID.** The schema has no separate human-readable sale number column; history displays `saleId`.

3. **Money validation covers returned history values.** Stored-side money invariants remain covered by the existing sales tests; this slice checks every monetary value returned by the history functions.
