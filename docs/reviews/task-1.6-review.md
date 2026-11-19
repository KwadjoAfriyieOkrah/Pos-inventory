# Task 1.6 Review — Branch Scope (Final)

Reviewer: independent reviewer / test author
Test command: `npx vitest run` (Vitest 4.1.12)
Typecheck command: `npx tsc --noEmit`
Structural test command: `npx vitest run tests/unit/data-layer-structure.test.ts`

Writes stayed in `tests/` and `docs/reviews/`. No `src/`, `db/`, config, `docs/adr/`, or `.env`
file was edited. No Docker container was started, stopped, or removed; no `DATABASE_URL`,
`TEST_DATABASE_URL`, token, or password value was read or printed.

## Compatibility re-export — resolved

Command:

```powershell
$hits = Select-String -LiteralPath "src/server/data/scope.ts" -Pattern "loadScope" -CaseSensitive:$false; if ($hits) { $hits | ForEach-Object { "$($_.LineNumber):$($_.Line)" } } else { "NO_MATCHES" }
```

Result:

```text
NO_MATCHES
```

The former line 3 re-export `export { loadScope } from "../auth/scope";` is gone. `loadScope`
no longer appears anywhere in `src/server/data/scope.ts`, so the compatibility re-export
finding is **Resolved**.

## Final structural test result

```text
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  444ms (transform 71ms, setup 0ms, import 293ms, tests 22ms, environment 0ms)
```

All three tests in `tests/unit/data-layer-structure.test.ts` pass, including:

- `every exported function in src/server/data has scope as its first parameter`
- `the checker flags an exported listAllUsers() with no scope parameter`
- `loadScope is exported from auth/scope.ts and not from src/server/data`

There is no skip, todo, allowlist, or per-function exemption in the structural test file;
the earlier `Select-String` check returned `NO_MATCHES` for those terms.

## Final `npx tsc --noEmit`

```text
npm notice run pharmacy-pos@0.1.0 npx
npm notice run ^"tsc^" --noEmit
EXIT_CODE=0
```

## Final `npm run lint`

```text
✖ 2 problems (0 errors, 2 warnings)
```

Both warnings are pre-existing unused-variable warnings outside this change.

## Final full `npx vitest run` output

```text
npm notice run pharmacy-pos@0.1.0 npx
npm notice run ^"vitest^" run

 RUN  v4.1.12 C:/Users/DELL/pharmacy-pos


 Test Files  7 passed (7)
      Tests  78 passed | 1 skipped (79)
   Start at  06:38:32
   Duration  12.79s (transform 1.13s, setup 0ms, import 5.89s, tests 20.61s, environment 1ms)
```

## Previous findings status

| Previous finding | Status | Evidence |
|---|---|---|
| High — compatibility re-export kept `loadScope` exported from `src/server/data/scope.ts` | **Resolved** | `Select-String` for `loadScope` in `src/server/data/scope.ts` returned `NO_MATCHES`; the former line 3 re-export is gone. Export-location test passes. |
| High — integration test still imported `loadScope` from `src/server/data/scope.ts` | **Resolved** | `tests/integration/branch-scope.test.ts:34` now types `loadScope` from `src/server/auth/scope`; line 86 now dynamically imports it from `src/server/auth/scope`. Full suite passes. |
| High — unscoped helper `listAllUsers()` would not be caught | **Resolved** | Structural test passes; synthetic checker test passes. |
| High — register action imported DB client directly | **Resolved** | Source-import test passes. |
| Medium — inactive users received a populated scope | **Resolved** | Filter is in `src/server/auth/scope.ts:49`; inactive-user test passes. |
| Low — `listTerminals` had no row cap | **Resolved** | `src/server/data/terminals.ts:13-17,34`; cap test passes. |
| Medium — ADR 0006 lacked exact `Chosen:`/`Rejected:` phrases | **Resolved** | Earlier Select-String counts were 4 and 4. |

## Remaining findings

### High

None.

### Medium

None.

### Low

None.
