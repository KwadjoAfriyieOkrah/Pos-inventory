import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, count as sqlCount, eq, lt, sql } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditEvents,
  branches,
  loginFailures,
  organizations,
  terminals,
  users,
} from "../../db/schema";
import {
  countFailures,
  EMAIL_LIMIT,
  EMAIL_WINDOW_MINUTES,
  hashKey,
} from "../../src/server/auth/rate-limit";

loadDotenv({ path: ".env.local", quiet: true });

type DbClient = typeof import("../../src/server/db/client")["db"];
type Queryable = { select: DbClient["select"] };
type Login = typeof import("../../src/server/auth/login")["login"];
type LoginResult = Awaited<ReturnType<Login>>;
type GenerateTerminalToken = typeof import("../../src/server/auth/terminal")["generateTerminalToken"];
type HashTerminalToken = typeof import("../../src/server/auth/terminal")["hashTerminalToken"];

const INJECTED_NOW = new Date();
const BOUNDARY_FIRST = new Date(INJECTED_NOW.getTime() - 6 * 60_000);
const BOUNDARY_SECOND = new Date(INJECTED_NOW.getTime() - 4 * 60_000);
const SLIDE_OLD = new Date(INJECTED_NOW.getTime() - 16 * 60_000);
const SLIDE_RECENT = new Date(INJECTED_NOW.getTime() - 14 * 60_000);
const SLIDE_NOW = INJECTED_NOW;

function reasonOf(result: LoginResult): string | undefined {
  return "reason" in result ? result.reason : undefined;
}

const harness = vi.hoisted(() => {
  const correctPassword = "correct horse battery staple";
  const wrongPassword = "wrong horse battery staple";

  return {
    cookieToken: undefined as string | undefined,
    correctPassword,
    wrongPassword,
    verifyPassword: vi.fn(async (_hash: string, plain: string) => plain === correctPassword),
  };
});

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "pos_terminal" && harness.cookieToken !== undefined
        ? { name, value: harness.cookieToken }
        : undefined,
    set: (name: string, value: string) => {
      if (name === "pos_terminal") harness.cookieToken = value;
    },
  }),
}));

vi.mock("@/lib/env", async () => {
  const real = await import("../../src/lib/env");
  return { env: real.env };
});

vi.mock("@/server/db/client", async () => await import("../../src/server/db/client"));

vi.mock("../../src/server/auth/password", () => ({
  DUMMY_HASH: "dummy-hash-for-tests",
  verifyPassword: harness.verifyPassword,
}));

let db: DbClient;
let pool: typeof import("../../src/server/db/client")["pool"];
let authPool: typeof import("../../src/server/auth/login-db")["authPool"];
let login: Login;
let generateTerminalToken: GenerateTerminalToken;
let hashTerminalToken: HashTerminalToken;

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
  ({ authPool } = await import("../../src/server/auth/login-db"));

  ({ login } = await import("../../src/server/auth/login"));
  ({ generateTerminalToken, hashTerminalToken } = await import("../../src/server/auth/terminal"));
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(INJECTED_NOW);
  harness.cookieToken = undefined;
  harness.verifyPassword.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  harness.cookieToken = undefined;
  harness.verifyPassword.mockClear();
});

afterAll(async () => {
  if (pool) await pool.end();
  if (authPool) await authPool.end();
});

async function withCommittedContext(
  run: (tx: DbClient, context: Context) => Promise<void>,
): Promise<void> {
  const context = await createContext(db);
  await run(db, context);
}

function emailFor(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, "")}@example.invalid`;
}

type Context = {
  organizationId: string;
  branchId: string;
  terminalId: string;
  token: string;
  email: string;
  userId: string;
};

async function createContext(tx: DbClient): Promise<Context> {
  const organizationId = randomUUID();
  const branchId = randomUUID();
  const terminalId = randomUUID();
  const userId = randomUUID();
  const token = generateTerminalToken();
  const email = emailFor("rate-limit");

  await tx.insert(organizations).values({
    id: organizationId,
    name: "Rate Limit Organization",
  });

  await tx.insert(branches).values({
    id: branchId,
    organizationId,
    name: "Main",
    digitalAddress: randomUUID(),
    licenceNumber: randomUUID(),
    licenceExpiresOn: "2030-01-01",
  });

  await tx.insert(terminals).values({
    id: terminalId,
    organizationId,
    branchId,
    name: "Rate Limit Terminal",
    tokenHash: hashTerminalToken(token),
  });

  await tx.insert(users).values({
    id: userId,
    organizationId,
    email,
    fullName: "Rate Limit User",
    passwordHash: hashKey("stored-password-hash"),
  });

  return { organizationId, branchId, terminalId, token, email, userId };
}

async function attempt(context: { token: string; email: string }, password: string) {
  harness.cookieToken = context.token;
  return login({ email: context.email, password });
}

async function attemptEmail(
  context: { token: string },
  email: string,
  password: string,
) {
  harness.cookieToken = context.token;
  return login({ email, password });
}

async function lockedRows(client: Queryable, terminalId: string) {
  return client
    .select({ payload: auditEvents.payload })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.terminalId, terminalId),
        eq(auditEvents.action, "auth.login_locked"),
      ),
    );
}

async function emailFailureCount(
  client: Parameters<typeof countFailures>[0] | DbClient,
  email: string,
  now: Date,
) {
  return countFailures(
    client as Parameters<typeof countFailures>[0],
    "email",
    hashKey(email),
    EMAIL_WINDOW_MINUTES,
    now,
  );
}

async function emailStatusRows(
  client: Parameters<typeof countFailures>[0] | DbClient,
  email: string,
) {
  return (client as Parameters<typeof countFailures>[0])
    .select({ id: loginFailures.id, status: loginFailures.status })
    .from(loginFailures)
    .where(
      and(eq(loginFailures.keyType, "email"), eq(loginFailures.keyHash, hashKey(email))),
    );
}

async function oldFailureCount(
  client: Parameters<typeof countFailures>[0] | DbClient,
  keyHash: string,
  now: Date,
): Promise<number> {
  const staleBefore = new Date(now.getTime() - 24 * 60 * 60_000);
  const [row] = await (
    client as Parameters<typeof countFailures>[0]
  )
    .select({ total: sqlCount() })
    .from(loginFailures)
    .where(
      and(
        eq(loginFailures.keyType, "email"),
        eq(loginFailures.keyHash, keyHash),
        lt(loginFailures.failedAt, staleBefore),
      ),
    );

  return row.total;
}

describe("Task 1.8a sliding-window rate limiting", () => {
  it("boundary: five failures at 14:59 lock the attempt at 15:01", async () => {
    await withCommittedContext(async (tx, context) => {

      vi.setSystemTime(BOUNDARY_FIRST);

      for (let index = 0; index < EMAIL_LIMIT; index += 1) {
        const failed = await attempt(context, harness.wrongPassword);
        expect(failed.ok).toBe(false);
        expect(reasonOf(failed)).toBe("bad_credentials");
      }

      vi.setSystemTime(BOUNDARY_SECOND);
      harness.verifyPassword.mockClear();

      const locked = await attempt(context, harness.correctPassword);

      expect(reasonOf(locked)).toBe("locked");
      expect(harness.verifyPassword).toHaveBeenCalledTimes(0);
    });
  });

  it("slide-out: old failures outside the window do not lock the current attempt", async () => {
    await withCommittedContext(async (tx, context) => {

      vi.setSystemTime(SLIDE_OLD);

      for (let index = 0; index < 4; index += 1) {
        const failed = await attempt(context, harness.wrongPassword);
        expect(failed.ok).toBe(false);
        expect(reasonOf(failed)).toBe("bad_credentials");
      }

      vi.setSystemTime(SLIDE_RECENT);
      const recentFailure = await attempt(context, harness.wrongPassword);
      expect(recentFailure.ok).toBe(false);
      expect(reasonOf(recentFailure)).toBe("bad_credentials");

      vi.setSystemTime(SLIDE_NOW);
      harness.verifyPassword.mockClear();

      const unlocked = await attempt(context, harness.correctPassword);

      expect(unlocked.ok).toBe(true);
      expect(reasonOf(unlocked)).toBeUndefined();
      expect(harness.verifyPassword).toHaveBeenCalledTimes(1);
      expect(await emailFailureCount(tx, context.email, SLIDE_NOW)).toBe(1);
    });
  });

  it("records exactly 5 failure rows and 15 refusals for 20 concurrent attempts", async () => {
    const context = await createContext(db);

    harness.verifyPassword.mockClear();

    const startedAt = performance.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => attempt(context, harness.wrongPassword)),
    );
    const elapsed = performance.now() - startedAt;

    const statusRows = await emailStatusRows(db, context.email);
    const failureRows = await emailFailureCount(db, context.email, INJECTED_NOW);
    const pendingOrFailedRows = statusRows.filter(
      ({ status }) => status === "pending" || status === "failed",
    ).length;
    const reservations = statusRows.length;
    const checks = harness.verifyPassword.mock.calls.length;
    const locks = results.filter((result) => reasonOf(result) === "locked").length;
    const busy = results.filter((result) => reasonOf(result) === "busy").length;

    const refusals = results.filter((result) => {
      const reason = reasonOf(result);
      return reason === "locked" || reason === "busy";
    });
    const ordinaryFailures = results.filter(
      (result) => result.ok === false && reasonOf(result) === "bad_credentials",
    );
    const undefinedReasons = results.filter((result) => reasonOf(result) === undefined);
    const observed = `failure rows=${failureRows} pending or failed rows=${pendingOrFailedRows} reservations=${reservations} checks=${checks} locks=${locks} busy=${busy} refusals=${refusals.length} ordinary=${ordinaryFailures.length} undefined reasons=${undefinedReasons.length} elapsedMs=${elapsed.toFixed(1)}`;

    expect(harness.verifyPassword, observed).toHaveBeenCalledTimes(EMAIL_LIMIT);
    expect(failureRows, observed).toBe(EMAIL_LIMIT);
    expect(pendingOrFailedRows, observed).toBe(EMAIL_LIMIT);
    expect(checks, observed).toBe(EMAIL_LIMIT);
    expect(checks, observed).toBeLessThanOrEqual(reservations);
    expect(locks + busy, observed).toBe(20 - EMAIL_LIMIT);
    expect(refusals, observed).toHaveLength(20 - EMAIL_LIMIT);
    expect(results.every((result) => "reason" in result), observed).toBe(true);
    expect(undefinedReasons, observed).toHaveLength(0);
    expect(ordinaryFailures, observed).toHaveLength(EMAIL_LIMIT);
  });

  it("crossed-email parallel calls produce zero SQLSTATE 40P01 errors over 20 runs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const context = await createContext(db);
        const terminalHash = hashKey(context.terminalId);
        let lowerEmail = emailFor("lower");
        let higherEmail = emailFor("higher");

        while (hashKey(lowerEmail) >= terminalHash) lowerEmail = emailFor("lower");
        while (hashKey(higherEmail) <= terminalHash) higherEmail = emailFor("higher");

        const calls =
          iteration % 2 === 0
            ? [
                attemptEmail(context, lowerEmail, harness.wrongPassword),
                attemptEmail(context, higherEmail, harness.wrongPassword),
              ]
            : [
                attemptEmail(context, higherEmail, harness.wrongPassword),
                attemptEmail(context, lowerEmail, harness.wrongPassword),
              ];

        const results = await Promise.all(calls);

        expect(
          results.every(
            (result) => result.ok === false && reasonOf(result) === "bad_credentials",
          ),
        ).toBe(true);
      }

      const deadlocks = errorSpy.mock.calls.filter(
        (call) => String(call[0]) === "40P01",
      );
      expect(deadlocks).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
    // Crossed-email loop can exceed the 5s default under CPU load.
  }, 60000);

  it("uses the same lock reason for existing and non-existing emails", async () => {
    await withCommittedContext(async (tx, context) => {
      const missingEmail = emailFor("missing");

      for (let index = 0; index < EMAIL_LIMIT; index += 1) {
        expect((await attempt(context, harness.wrongPassword)).ok).toBe(false);
        expect((await attemptEmail(context, missingEmail, harness.wrongPassword)).ok).toBe(false);
      }

      const existingLocked = await attempt(context, harness.correctPassword);
      const missingLocked = await attemptEmail(context, missingEmail, harness.correctPassword);

      expect(reasonOf(existingLocked)).toBe("locked");
      expect(reasonOf(missingLocked)).toBe("locked");
    });
  });

  it("writes exactly one scoped email lock audit row with no email text", async () => {
    await withCommittedContext(async (tx, context) => {

      for (let index = 0; index < EMAIL_LIMIT; index += 1) {
        await attempt(context, harness.wrongPassword);
      }

      await attempt(context, harness.correctPassword);
      const rows = await lockedRows(tx, context.terminalId);

      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ scope: "email" });
      expect(JSON.stringify(rows[0].payload ?? {}).includes(context.email)).toBe(false);
    });
  });

  it("locks the 31st terminal failure with a terminal-scoped audit row", async () => {
    await withCommittedContext(async (tx, context) => {

      for (let index = 0; index < 30; index += 1) {
        const failed = await attemptEmail(
          context,
          emailFor("terminal-failure"),
          harness.wrongPassword,
        );
        expect(failed.ok).toBe(false);
        expect(reasonOf(failed)).toBe("bad_credentials");
      }

      harness.verifyPassword.mockClear();
      const locked = await attemptEmail(
        context,
        emailFor("terminal-locked"),
        harness.correctPassword,
      );

      expect(reasonOf(locked)).toBe("locked");
      expect(harness.verifyPassword).toHaveBeenCalledTimes(0);

      const rows = await lockedRows(tx, context.terminalId);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ scope: "terminal" });
    });
  });

  it("does not lock the fifth attempt after four failures", async () => {
    await withCommittedContext(async (tx, context) => {

      for (let index = 0; index < 4; index += 1) {
        const failed = await attempt(context, harness.wrongPassword);
        expect(failed.ok).toBe(false);
        expect(reasonOf(failed)).toBe("bad_credentials");
      }

      const fifth = await attempt(context, harness.correctPassword);

      expect(fifth.ok).toBe(true);
      expect(await emailFailureCount(tx, context.email, INJECTED_NOW)).toBe(4);
    });
  });

  it("does not reset the failure history after a successful login", async () => {
    await withCommittedContext(async (tx, context) => {

      for (let index = 0; index < 4; index += 1) {
        await attempt(context, harness.wrongPassword);
      }

      const succeeded = await attempt(context, harness.correctPassword);
      expect(succeeded.ok).toBe(true);
      expect(reasonOf(succeeded)).toBeUndefined();

      harness.verifyPassword.mockClear();
      const lastWrong = await attempt(context, harness.wrongPassword);
      const lastChecks = harness.verifyPassword.mock.calls.length;
      const statusRows = await emailStatusRows(tx, context.email);
      const failedRows = statusRows.filter(({ status }) => status === "failed");
      const succeededRows = statusRows.filter(({ status }) => status === "succeeded");
      const failureRows = await emailFailureCount(tx, context.email, INJECTED_NOW);
      const observed = `last checks=${lastChecks} failure rows=${failureRows} failed rows=${failedRows.length} succeeded rows=${succeededRows.length}`;

      expect(lastWrong.ok, observed).toBe(false);
      expect(reasonOf(lastWrong), observed).toBe("bad_credentials");
      expect(lastChecks, observed).toBe(1);
      expect(failureRows, observed).toBe(5);
      expect(succeededRows, observed).toHaveLength(1);
      expect(failedRows, observed).toHaveLength(5);

      harness.verifyPassword.mockClear();
      const locked = await attempt(context, harness.correctPassword);

      expect(reasonOf(locked), observed).toBe("locked");
      expect(harness.verifyPassword, observed).toHaveBeenCalledTimes(0);
    });
  });

  it("rolls back the failure row when a failed login audit insert fails", async () => {
    await withCommittedContext(async (tx, context) => {
      const suffix = randomUUID().replace(/-/g, "");
      const functionName = `block_audit_insert_${suffix}`;
      const triggerName = `block_audit_insert_${suffix}`;

      await tx.execute(
        sql.raw(
          `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated audit insert failure'; END; $$`,
        ),
      );
      await tx.execute(
        sql.raw(
          `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${functionName}();`,
        ),
      );

      let result: LoginResult | undefined;

      try {
        harness.verifyPassword.mockClear();
        result = await attempt(context, harness.wrongPassword);
      } finally {
        await tx.execute(sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_events;`));
        await tx.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}();`));
      }

      const observed = `reason=${reasonOf(result as LoginResult) ?? "none"} checks=${harness.verifyPassword.mock.calls.length}`;

      const emailRows = await emailStatusRows(tx, context.email);

      expect(reasonOf(result as LoginResult), observed).toBe("unavailable");
      expect(harness.verifyPassword, observed).toHaveBeenCalledTimes(1);
      expect(emailRows, observed).toHaveLength(1);
      expect(emailRows[0]?.status, observed).toBe("pending");
      expect(await emailFailureCount(tx, context.email, INJECTED_NOW), observed).toBe(1);

      const [terminalReservation] = await tx
        .select({ id: loginFailures.id, status: loginFailures.status })
        .from(loginFailures)
        .where(and(eq(loginFailures.keyType, "terminal"), eq(loginFailures.keyHash, hashKey(context.terminalId))))
        .limit(1);

      expect(terminalReservation, observed).toBeDefined();
      expect(terminalReservation?.status, observed).toBe("pending");
    });
  });

  it("keeps a pending reservation when the T2 finalize update fails", async () => {
    await withCommittedContext(async (_tx, context) => {
      const suffix = randomUUID().replace(/-/g, "");
      const functionName = `fail_t2_${suffix}`;
      const triggerName = `fail_t2_${suffix}`;
      const emailHash = hashKey(context.email);
      let result: LoginResult | undefined;

      try {
        await db.execute(
          sql.raw(
            `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key_hash = '${emailHash}' THEN RAISE EXCEPTION 'simulated T2 finalize failure'; END IF; RETURN NEW; END; $$`,
          ),
        );
        await db.execute(
          sql.raw(
            `CREATE TRIGGER ${triggerName} BEFORE UPDATE ON login_failures FOR EACH ROW EXECUTE FUNCTION ${functionName}();`,
          ),
        );

        harness.verifyPassword.mockClear();
        result = await attempt(context, harness.wrongPassword);
      } finally {
        await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON login_failures;`));
        await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}();`));
      }

      const statusRows = await emailStatusRows(db, context.email);
      const failureRows = await emailFailureCount(db, context.email, INJECTED_NOW);
      const checks = harness.verifyPassword.mock.calls.length;
      const observed = `checks=${checks} status rows=${statusRows.length} failure rows=${failureRows}`;

      expect(reasonOf(result as LoginResult), observed).toBe("unavailable");
      expect(statusRows, observed).toHaveLength(1);
      expect(statusRows[0]?.status, observed).toBe("pending");
      expect(failureRows, observed).toBe(1);
      expect(checks, observed).toBe(1);

      const next = await attempt(context, harness.wrongPassword);
      const nextFailureRows = await emailFailureCount(db, context.email, INJECTED_NOW);
      const nextObserved = `next failure rows=${nextFailureRows}`;

      expect(reasonOf(next), nextObserved).toBe("bad_credentials");
      expect(nextFailureRows, nextObserved).toBe(2);
    });
  });

  it("prunes stale failure rows in batches of at most 100 per login", async () => {
    const context = await createContext(db);
    const keyHash = hashKey(context.email);
    const oldFailedAt = new Date(INJECTED_NOW.getTime() - 25 * 60 * 60_000);

    await db.insert(loginFailures).values(
      Array.from({ length: 150 }, () => ({
        keyType: "email" as const,
        keyHash,
        failedAt: oldFailedAt,
      })),
    );

    expect(await oldFailureCount(db, keyHash, INJECTED_NOW)).toBe(150);

    const first = await attempt(context, harness.wrongPassword);
    expect(first.ok).toBe(false);
    expect(reasonOf(first)).toBe("bad_credentials");

    const remainingAfterFirst = await oldFailureCount(db, keyHash, INJECTED_NOW);
    expect(remainingAfterFirst).toBeLessThanOrEqual(50);

    let attempts = 1;
    while ((await oldFailureCount(db, keyHash, INJECTED_NOW)) > 0 && attempts < 10) {
      await attempt(context, harness.wrongPassword);
      attempts += 1;
    }

    expect(await oldFailureCount(db, keyHash, INJECTED_NOW)).toBe(0);
    console.log(`retention_attempts=${attempts}`);
  });

  it("has no console call that prints an email, key hash, or token", () => {
    const loginSource = readFileSync(
      join(process.cwd(), "src/server/auth/login.ts"),
      "utf8",
    );
    const rateLimitSource = readFileSync(
      join(process.cwd(), "src/server/auth/rate-limit.ts"),
      "utf8",
    );

    expect(rateLimitSource).not.toMatch(/console\./);

    const consoleCalls = [...loginSource.matchAll(/console\.\w+\([^\n]*\)/g)].map(
      (match) => match[0],
    );

    expect(consoleCalls.length).toBeGreaterThan(0);

    for (const call of consoleCalls) {
      expect(
        call === "console.error(errorCode)" ||
          call === "console.error(databaseErrorCode(error))",
        `unexpected console call: ${call}`,
      ).toBe(true);
      expect(call.toLowerCase()).not.toMatch(/email|hash|token|key/);
    }
  });
});
