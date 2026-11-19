# Task 1.1 Review — Database & Environment Foundation (re-review after Copilot's fix)

Reviewer: independent reviewer / test author
Implementation author: Copilot
Test command: `npx vitest run` (Vitest 4.1.12)
Test file: `tests/integration/db-foundation.test.ts`

## Test setup note

The repository had no test script or Vitest dependency. I installed `vitest@4.1.12` as a dev
dependency (Vitest 5 conflicts with the project's `@types/node@20`) and added
`tests/.env.test` with a reviewer-only `TEST_DATABASE_URL`. That URL points at a temporary
Postgres 16 container on host port 55432; no password or full URL is reproduced in this report.
No source, db, or `drizzle.config.ts` file was edited by the reviewer.

Copilot's fix added a guard in `drizzle.config.ts:6-8`, a redacting pool error handler in
`src/server/db/client.ts:8-14`, and a `db:check` diagnostic (`package.json:13`, `db/check.mjs`).
Those changes were re-reviewed; the security-relevant ones are covered below.

## Pass/fail table

| # | Check | Result | Notes |
|---|-------|--------|-------|
| 1 | Missing `DATABASE_URL` throws and names it | PASS | `env.ts` import rejects with `Invalid environment variables: DATABASE_URL (must be a valid URL)`. |
| 2 | Short `AUTH_SECRET` error names the variable and not the value | PASS | Supplied `sh0rt`; message and its string form contain `AUTH_SECRET`, not `sh0rt`. |
| 3 | `APP_TIMEZONE=Europe/London` fails validation | PASS | Rejects with error naming `APP_TIMEZONE`. |
| 4 | `select 1` via exported `db` returns 1 with valid env | PASS | `db.execute(sql\`select 1 as value\`)` returned `1`. |
| 5 | `pool.end()` in `afterAll` releases connections | PASS | In `afterAll`: `ended === true`, `idleCount === 0`, `totalCount === 0`; no open-handle warning in output. |
| 6 | No dependency starting with `prisma` / `@prisma` | PASS | Checked dependencies, devDependencies, optionalDependencies and peerDependencies. |
| 7 | No file in `src/`, `db/` or `tests/` imports `@prisma` | PASS | Recursive scan of text files in all three trees found no match. |
| 8 | `npm run db:migrate` succeeds twice in a row | SKIP | Skipped with reason **"no migrations exist until Task 1.2"**. The check itself is retained in the test file and is tracked in the Task 1.2 section below. |

No Task 1.1 test fails. Check 8 is intentionally not counted as a pass.

## Full `npx vitest run` output

```text
 RUN  v4.1.12 C:/Users/DELL/pharmacy-pos


 Test Files  1 passed (1)
      Tests  7 passed | 1 skipped (8)
   Start at  04:15:10
   Duration  759ms (transform 68ms, setup 0ms, import 258ms, tests 353ms, environment 0ms)
```

## Same test against local Docker database versus `DATABASE_URL`

The `select 1` test (check 4) was run twice with only the target URL changed. Values are
reported as host/port only; the password and the full URL are never printed.

| Target | Source of URL | Result | Diagnostic (no secret shown) |
|--------|---------------|--------|------------------------------|
| Local Docker database | `tests/.env.test` (`localhost`, port 55432) | **PASS** | `1 passed | 7 skipped`; `select 1 as value` returned `1`. |
| `DATABASE_URL` | `.env.local:1` (`pharmacy-pos-db`, port 5432) | **FAIL** | `getaddrinfo ENOTFOUND pharmacy-pos-db`, code `ENOTFOUND`. |

**Which passes:** only the local Docker database run. The `DATABASE_URL` run fails because its
hostname is a Docker-internal name that is not resolvable from the host.

## 28P01 root cause — detection only

`npm run db:check` was run with a URL pointed at `localhost`, port 5432 (where the native
`postgresql-x64-18` service listens, rather than the compose container):

```text
host=localhost port=5432 database=pos_dev user=pos
SQLSTATE=28P01
EXIT=1
```

Against the project's `DATABASE_URL` the same diagnostic reports `SQLSTATE=unavailable`
(`ENOTFOUND` does not match its five-character SQLSTATE pattern).

**Conclusion:** the tests and `db/check.mjs` only **detect** the 28P01 condition; they do
not resolve it. No test changes the port mapping, the host, or the credentials. The root
cause is environmental (`docker-compose.yml:12` publishes 5432 while a native PostgreSQL
already owns that port, so the compose credentials are checked against the wrong server),
plus `.env.local:1` using an unresolvable container hostname on the host. Remediation is a
manual config change, not a test.

## Task 1.2 — deferred `migrate twice` check

The acceptance check "`npm run db:migrate` twice in a row succeeds with no errors" belongs to
Task 1.2 and is therefore skipped in the Task 1.1 suite with the exact reason
"no migrations exist until Task 1.2".

- Skipped test: `tests/integration/db-foundation.test.ts`, `describe("migrations")`.
- It still contains the full check: run `npm run db:migrate` twice via `spawnSync`, assert both
  statuses are `0`, and redact any connection string from the output before reporting.
- Prior evidence (Task 1.1, before the skip): both runs returned status `1` because
  `db/migrations/meta/_journal.json` does not exist. `drizzle-orm/migrator.js:9` throws
  `Can't find meta/_journal.json file`; drizzle-kit hides this behind its spinner.
- To re-enable in Task 1.2: implement the schema, run `npm run db:generate`, commit the SQL and
  `meta/_journal.json`, change `it.skip` back to `it`, and verify two clean runs against a
  reachable database (the local Docker target on port 55432 passed connectivity checks).

## Security section

| Question | Answer | Evidence |
|----------|--------|----------|
| Does any code print `DATABASE_URL`? | No | `src/lib/env.ts:31-35` builds the error from variable names and static rules only. `src/server/db/client.ts:9-13` replaces the connection string and any `postgres(ql)://…` token before logging. `db/check.mjs:25-27` prints host, port, database and user, but never the URL or password. Reviewer test output is passed through `redact()` and shell-side sanitising. |
| Does any code print `AUTH_SECRET`? | No | No `console.*` or interpolation of `AUTH_SECRET` exists outside validation; `src/lib/env.ts:5,12` only reference the key and a static rule. Test 2 explicitly asserts the supplied value is absent from the error. |
| Does any code print the full error object of a connection failure? | No | `src/server/db/client.ts:13` logs only `error.name` and the redacted `error.message`, not `error`, `error.stack`, or `console.error(error)`. `db/check.mjs:34-38` prints only a SQLSTATE-like code. |
| Is the pool error handler present? | Yes | `src/server/db/client.ts:8-14` registers `pool.on("error", …)` with connection-string redaction. |

**Why there are no security findings:** every path that touches credentials was re-read after
the fix (`src/lib/env.ts`, `src/server/db/client.ts`, `db/check.mjs`, `drizzle.config.ts`, and
the reviewer test file). Values are never interpolated into messages or logs; the only
failure output is variable names, static rules, a redacted message, or a SQLSTATE code. The
remaining findings below are configuration and test-infrastructure issues, not secret leakage.

## Findings

### High

None remaining for Task 1.1. The missing-migrations issue was moved to Task 1.2 above.

### Medium

1. **File/line:** `.env.local:1` (`DATABASE_URL`).
   **Problem:** the URL host is `pharmacy-pos-db`, a Docker-internal container name. From the
   Windows host it fails with `ENOTFOUND`, so `npm run db:migrate`, `npm run dev`, and any
   direct `pg` connection fail unless run inside the compose network. Confirmed again by the
   DATABASE_URL run above. This is local config (untracked), not committed source, but it
   blocks the documented workflow.
   **Fix recommended for Copilot:** document/use `localhost` for host-side commands and keep
   the container hostname only for services running inside Docker; add a short note to
   `README.md` or `.env.example` showing the host-vs-container URL distinction.

2. **File/line:** `docker-compose.yml:12` (`"5432:5432"`); diagnostic at `db/check.mjs:31-42`.
   **Problem:** host port 5432 is already bound by the native `postgresql-x64-18` service, so
   localhost connections with the compose credentials get `SQLSTATE=28P01` against the wrong
   server. `db/check.mjs` correctly reports this but does not resolve it.
   **Fix recommended for Copilot:** map a non-conflicting host port (for example
   `"55432:5432"`) and update the host-side `DATABASE_URL` accordingly, or document how to
   stop/disable the local Postgres instance before starting the compose stack. Keep the
   diagnostic as detection; it should not silently rewrite credentials.

### Low

3. **File/line:** `src/lib/env.ts:4` (`DATABASE_URL: z.string().url()`).
   **Problem:** validation accepts any URL scheme (for example `http://…`), so a malformed DB
   URL passes startup validation and only fails later when `pg` constructs the pool.
   **Fix recommended for Copilot:** narrow the schema to Postgres URLs, e.g.
   `z.string().url().refine((v) => /^postgres(?:ql)?:\/\//.test(v), { message: rules.DATABASE_URL })`,
   so configuration errors are reported at the boundary.

4. **File/line:** `package.json:5-14` (scripts) and `package.json:27-38` (devDependencies).
   **Problem:** there is still no `"test"` script, so the acceptance suite is only runnable via
   `npx vitest run` and is not discoverable from `npm test`.
   **Fix recommended for Copilot:** add `"test": "vitest run"` while keeping `vitest@^4.1.12`
   in devDependencies (already present at `package.json:38`).
