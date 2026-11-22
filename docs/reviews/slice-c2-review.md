# Slice C2 review

Command: `npx vitest run`
Database: `pos_test`

## Full suite summary

```text
 Test Files  11 passed (11)
      Tests  122 passed (122)
   Start at  09:59:06
   Duration  18.59s (transform 2.10s, setup 0ms, import 10.72s, tests 49.09s, environment 8ms)
```

Failure report: none in the final run. No assertion was relaxed or changed.

## Pass/fail

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Sale with pending medicine is refused with no sale, line, payment, or movement | Pass | `SaleValidationError("Medicine is not available for sale.")`; sale, sale line, and payment counts are 0; only the seeded receipt movement remains; batch quantity unchanged |
| 2 | Quantities 0, 100, 1.5, and -1 are refused | Pass | Each quantity raises `SaleValidationError("Quantity must be a whole number from 1 to 99.")`; no sale, line, payment, or sale movement written |
| 3 | Cash tender below total refused; exact tender change 0; overpayment exact change | Pass | Under-tender message asserted; exact tender returns 1250 total / 0 change and stores 1250; overpayment returns 1250 total / 750 change and stores 2000; receipt-minus-sale invariant holds after both |
| 4 | MoMo reference of 3 characters refused; valid reference accepted | Pass | `SaleValidationError("MoMo reference must be 4 to 40 characters.")`; valid sale stores `MOMO-REF-1`; no sale was written by the invalid attempt |
| 5 | Earliest-expiry batch is fully used before a later batch | Pass | Sale of 4 across 2+5 batch quantities produces two lines of 2; earlier batch goes 2 to 0, later batch 5 to 3; two sale movements of -2; invariant holds |
| 6 | Expired and zero-quantity batches are never used | Pass | Both are excluded from sale lines and movements; expired batch remains 10, zero batch remains 0, valid batch drops 2 to 0; invariant holds |
| 7 | Oversized sale refused with "Not enough stock for <name>" and nothing changes | Pass | Exact error `Not enough stock for ${name}.`; sale, line, payment, and movement counts unchanged; batch quantity remains 2 |
| 8 | Repeated idempotency key produces one sale and one movement set | Pass | Second result is duplicate with same sale id; one sale, one payment, one sale line, one sale movement; batch drops 5 to 3; invariant holds |
| 9 | Every batch quantity equals receipts minus sales from stock movements | Pass | Helper recomputes grouped movement totals for all branch batches after each successful sale in the relevant tests and in a dedicated multi-batch/multi-medicine test |
| 10 | Two concurrent sales for the last units: exactly one succeeds and quantity never drops below zero | Pass | `Promise.allSettled` gives one fulfilled and one `SaleValidationError("Not enough stock for <name>.")`; one sale and one sale movement; final quantity 0; invariant holds |
| 11 | Browser-supplied fake unit price cannot override database price | Pass | Payload includes extra price fields; result total is 2500; sale line stores 1250 unit price / 2500 line total; payment stores 5000 |
| 12 | Every stored money value is a safe integer | Pass | `Number.isSafeInteger` asserted for result total/change, medicine price, batch cost, sale total, sale line unit/line totals, payment amount, and `sale.completed` audit payload total |

Overall: **12 passed, 0 failed**.

## Findings

### High

1. **No sales behavior defect found.** The final full-suite run passed all 122 tests, including all 12 new checks. No source, `db/`, `scripts/`, or config file was modified.

### Medium

1. **Vitest needs test-local aliases for `sales.ts`.** `sales.ts` imports `@/lib/time`, `@/lib/money`, and `@/server/db/client`; the test re-exports these via `vi.mock` so the shared client is used. Assertions were unchanged.

2. **Concurrent last-unit allocation is locking correctly.** Two simultaneous transactions targeting one batch produced exactly one committed sale. The losing transaction rolled back after the batch lock was released and returned the expected stock error.

### Low

1. **Committed fixtures rely on global reset and unique ids.** No explicit cleanup is performed; every test creates fresh organizations, branches, users, medicines, batches, and idempotency keys with random identifiers, so fixtures remain isolated within `pos_test`.

2. **Money validation is currently asserted on the sale path only.** The checks cover all money values written by `completeSale` plus the seeded medicine and batch; unrelated tables are outside this slice.
