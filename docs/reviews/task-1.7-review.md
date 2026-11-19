# Task 1.7 Review — Round 3

Reviewer: independent reviewer / test author
Test command: `npx vitest run` (Vitest 4.1.12)
Diff command: `git --no-pager diff HEAD -- tests/integration/login.test.ts tests/integration/terminals.test.ts`
Typecheck: `npx tsc --noEmit` exit `0`
Lint: `npm run lint` → `2 problems (0 errors, 2 warnings)`; both are pre-existing and outside this change.

Write boundary kept to `tests/` and `docs/reviews/`. No `src/`, `db/`, `scripts/`, or config file
was edited. No Docker container was started, stopped, or removed. No secret values were printed.

## Files changed in round 3

- `tests/integration/login.test.ts` — no-cookie test now creates its own organization and asserts zero audit rows for that organization.
- `tests/integration/terminals.test.ts` — same org-scoped zero-audit assertion.
- `tests/unit/data-layer-structure.test.ts` — added generic exported-data-function signature checks and included `tests/fixtures/*.ts` so the negative fixture can prove the checker fails.
- `docs/reviews/task-1.7-review.md` — this review.

## Pass/fail table

| # | File:line | Check | Result |
|---|---:|---|---|
| 1 | `tests/integration/login.test.ts:307` | No-cookie test asserts zero audit rows for its fixture organization | PASS |
| 2 | `tests/integration/terminals.test.ts:404` | No-cookie test asserts zero audit rows for its fixture organization | PASS |
| 3 | `tests/unit/data-layer-structure.test.ts:439` | Generic AST check: first `scope: DataScope`, second `access: AuthorizedBranch`, no `branchId`/`organizationId` parameters | PASS |
| 4 | negative fixture run | `tests/fixtures/bad-data-fn.ts` with `listAllUsers()` fails the structural test and names the function | PASS |
| 5 | `Test-Path` | `tests/fixtures/bad-data-fn.ts` deleted after proof | PASS — `False` |
| 6 | `npx vitest run` | Full suite | PASS — `93 passed (93)` |
| 7 | `git --no-pager diff HEAD ...` | Diff captured without pager | PASS |

## Old and new no-cookie assertion text

### `tests/integration/login.test.ts:307`

Round 2 working-tree assertion removed:

```ts
const rows = await tx
  .select()
  .from(auditEvents)
  .where(eq(auditEvents.action, "auth.login_failed"));
expect(rows).toHaveLength(0);
```

HEAD-relative old assertion shown by `git diff`:

```ts
const rows = await tx.select().from(auditEvents);
expect(rows).toHaveLength(0);
```

New assertion:

```ts
const organizationId = await insertOrganization(tx);
...
const rows = await tx
  .select()
  .from(auditEvents)
  .where(eq(auditEvents.organizationId, organizationId));
expect(rows).toHaveLength(0);
```

### `tests/integration/terminals.test.ts:404`

Round 2 working-tree assertion removed:

```ts
const rows = await tx
  .select()
  .from(auditEvents)
  .where(eq(auditEvents.action, "auth.login_failed"));
expect(rows).toHaveLength(0);
```

HEAD-relative old assertion shown by `git diff`:

```ts
const rows = await tx.select().from(auditEvents);
expect(rows).toHaveLength(0);
```

New assertion:

```ts
const organizationId = await insertOrganization(tx);
...
const rows = await tx
  .select()
  .from(auditEvents)
  .where(eq(auditEvents.organizationId, organizationId));
expect(rows).toHaveLength(0);
```

## Generic signature proof

Fixture created:

```ts
export function listAllUsers() {
  return [];
}
```

Expected structural-test failure:

```text
exported data function signature violations:
tests/fixtures/bad-data-fn.ts: listAllUsers first parameter name is none, expected "scope"
tests/fixtures/bad-data-fn.ts: listAllUsers first parameter type is none, expected "DataScope"
tests/fixtures/bad-data-fn.ts: listAllUsers second parameter name is none, expected "access"
tests/fixtures/bad-data-fn.ts: listAllUsers second parameter type is none, expected "AuthorizedBranch"
```

Cleanup confirmation:

```text
False
```

## Full `npx vitest run` output

```text
npm notice run pharmacy-pos@0.1.0 npx
npm notice run ^"vitest^" run

 RUN  v4.1.12 C:/Users/DELL/pharmacy-pos

pos_test reset complete

 Test Files  8 passed (8)
      Tests  93 passed (93)
   Start at  07:12:40
   Duration  14.55s (transform 1.14s, setup 0ms, import 6.25s, tests 35.00s, environment 1ms)
```

## `git --no-pager diff HEAD` output

```text
warning: in the working copy of 'tests/integration/login.test.ts', LF will be replaced by CRLF the next time Git touches it
diff --git a/tests/integration/login.test.ts b/tests/integration/login.test.ts
index 757035e..4d3ff0d 100644
--- a/tests/integration/login.test.ts
+++ b/tests/integration/login.test.ts
@@ -307,6 +307,7 @@ describe("login", () => {
   it("login without the pos_terminal cookie is refused and writes no audit row", async () => {
     await withLoginTransaction(async (tx) => {
       harness.cookieToken = undefined;
+      const organizationId = await insertOrganization(tx);
 
       const result = await loginAction(
         { error: null },
@@ -314,7 +315,10 @@ describe("login", () => {
       );
 
       expect(result).toEqual({ error: UNREGISTERED_TERMINAL_MESSAGE });
-      const rows = await tx.select().from(auditEvents);
+      const rows = await tx
+        .select()
+        .from(auditEvents)
+        .where(eq(auditEvents.organizationId, organizationId));
       expect(rows).toHaveLength(0);
     });
   });
diff --git a/tests/integration/terminals.test.ts b/tests/integration/terminals.test.ts
index f6e4646..ba1c427 100644
--- a/tests/integration/terminals.test.ts
+++ b/tests/integration/terminals.test.ts
@@ -404,6 +404,7 @@ describe("terminals", () => {
   it("login without terminal cookie is refused and writes no audit row", async () => {
     await withRollback(async (tx) => {
       harness.cookieToken = undefined;
+      const organizationId = await insertOrganization(tx);
 
       const result = await loginAction(
         { error: null },
@@ -416,7 +417,10 @@ describe("terminals", () => {
       );
 
       expect(result).toEqual({ error: UNREGISTERED_TERMINAL_MESSAGE });
-      const rows = await tx.select().from(auditEvents);
+      const rows = await tx
+        .select()
+        .from(auditEvents)
+        .where(eq(auditEvents.organizationId, organizationId));
       expect(rows).toHaveLength(0);
     });
   });
warning: in the working copy of 'tests/integration/terminals.test.ts', LF will be replaced by CRLF the next time Git touches it
```

## Round 2 finding status

| Round 2 finding | Status | Evidence |
|---|---|---|
| High — generic enforcement was missing; `AuthorizedBranch` was only checked in `audit.ts` and `terminals.ts` | **Resolved** | Step 2 added `tests/unit/data-layer-structure.test.ts:439` using helpers at `:215` and `:221` to check every exported data function except `scope.ts`. Step 3 created `tests/fixtures/bad-data-fn.ts`, the test failed naming `listAllUsers` with all four expected violations, then `Test-Path` returned `False` after deletion. Full suite is `93 passed (93)`. |
| Low — `vitest.config.ts:1` ESM-in-`.ts` warning | **Open** | Config remains unchanged. The warning did not appear in the round 3 full run, but no config fix was possible inside this write boundary. |

## Findings

### High

None.

### Medium

None.

### Low

| File | Line | Problem | Fix |
|---|---:|---|---|
| `vitest.config.ts` | 1 | Config still uses ESM syntax in a `.ts` file. The earlier Vite warning did not recur in this run, but the underlying config is unchanged. | Rename to `.mjs` or add `"type": "module"` to `package.json` in a task that allows config changes. |
