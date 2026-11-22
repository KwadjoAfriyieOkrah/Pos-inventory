# Slice C1 review

Command: `npx vitest run`
Database: `pos_test`

## Full suite summary

```text
 Test Files  10 passed (10)
      Tests  110 passed (110)
   Start at  08:53:14
   Duration  22.59s (transform 2.20s, setup 0ms, import 11.30s, tests 69.15s, environment 2ms)
```

Failure report: none in the final run. No assertion was relaxed or changed.

## Pass/fail

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Receipt with expiry date today is refused with "Expiry date must be after today." | Pass | `ReceivingValidationError` asserted with `name` and exact message |
| 2 | Same receipt repeated with one idempotency key creates one receipt and one movement set | Pass | First result non-duplicate, second duplicate with same receipt id; one receipt row, one movement row, one receipt line row |
| 3 | Two receipts for same batch number and expiry add together | Pass | One batch with quantity 25; receipt movement total is 25 |
| 4 | Same batch number with different expiry is refused and writes no movement | Pass | Exact mismatch error asserted; movement count for the batch unchanged |
| 5 | User without `stockReceive` is denied with one `access.denied` row | Pass | `ForbiddenError("Access denied")`; one denial row for branch/actor with `stock.receive` payload |
| 6 | Pending medicine does not appear in `listSaleableMedicines` | Pass | Pending id absent while active id present |
| 7 | Cashier activation denied; owner activation makes medicine saleable and writes one `medicine.activated` row | Pass | Cashier denial asserted; owner activation sets status active and price 1000; medicine becomes saleable; exactly one activation audit row |
| 8 | Cashier stock result never contains unit cost | Pass | Non-empty cashier stock result; every row fails both `Object.keys` and `toHaveProperty` checks |
| 9 | Every stored and returned money value is a safe integer | Pass | Stored medicine/batch/receipt-line prices and audit payload prices, plus returned saleable and stock prices, all checked with `Number.isSafeInteger` |
| 10 | Every batch quantity equals the sum of its stock movements | Pass | For each fixture batch, `quantityOnHand` equals the grouped movement total |

Overall: **10 passed, 0 failed**.

## Findings

### High

1. **No receiving or activation behavior defect found.** The final full-suite run passed all 110 tests, including all 10 new checks. No source, `db/`, `scripts/`, or config file was modified.

### Medium

1. **Vitest needed test-local aliases for `receiving.ts`.** The first run failed before any receiving assertion with `Error: Cannot find package '@/lib/time' imported from .../src/server/data/receiving.ts`. `tests/integration/receiving.test.ts` now re-exports `@/lib/time` and `@/lib/money` via `vi.mock`; assertions were unchanged.

2. **Existing read-path fixture was stale against the new medicine constraint.** The first run failed at fixture insert with `error: new row for relation "medicines" violates check constraint "medicines_active_fields_check"`. The fixture now supplies `status: "active"` and `classification: "OTC"`; no assertion was changed.

### Low

1. **Committed fixtures rely on global reset and unique ids.** No explicit cleanup is performed; every test creates fresh organizations, branches, users, medicines, batch numbers, and idempotency keys with random identifiers, so fixtures remain isolated within `pos_test`.
