import { randomUUID } from "node:crypto";
import { and, count, eq, like, sql } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { auditEvents, branches, loginFailures, organizations, terminals, users } from "../../db/schema";
import { hashKey } from "../../src/server/auth/rate-limit";

loadDotenv({ path: ".env.local", quiet: true });

type CookieStore = import("node:async_hooks").AsyncLocalStorage<string>;
type DbClient = typeof import("../../src/server/db/client")["db"];
type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type Login = typeof import("../../src/server/auth/login")["login"];
type GenerateTerminalToken = typeof import("../../src/server/auth/terminal")["generateTerminalToken"];
type HashTerminalToken = typeof import("../../src/server/auth/terminal")["hashTerminalToken"];

function reasonOf(result: Awaited<ReturnType<Login>>): string | undefined {
  return "reason" in result ? result.reason : undefined;
}

const harness = vi.hoisted(() => {
  const correctPassword = "correct horse battery staple";
  const wrongPassword = "wrong horse battery staple";
  let slowChecks = 0;

  return {
    cookieStore: undefined as CookieStore | undefined,
    correctPassword,
    wrongPassword,
    verifyPassword: vi.fn(async (_hash: string, plain: string) => {
      if (plain === correctPassword) return true;
      slowChecks += 1;
      if (slowChecks === 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2050));
      }
      return false;
    }),
  };
});

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const token = (harness.cookieStore as CookieStore).getStore();
      return name === "pos_terminal" && token !== undefined
        ? { name, value: token }
        : undefined;
    },
    set: () => undefined,
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
  const { AsyncLocalStorage } = await import("node:async_hooks");
  harness.cookieStore = new AsyncLocalStorage<string>();

  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;

  ({ login } = await import("../../src/server/auth/login"));
  ({ authPool } = await import("../../src/server/auth/login-db"));
  ({ generateTerminalToken, hashTerminalToken } = await import("../../src/server/auth/terminal"));
});

afterAll(async () => {
  if (pool) await pool.end();
  if (authPool) await authPool.end();
});

function emailFor(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, "")}@example.invalid`;
}

async function createContext(tx: Tx): Promise<{
  organizationId: string;
  branchId: string;
  terminalId: string;
  token: string;
  email: string;
  userId: string;
}> {
  const organizationId = randomUUID();
  const branchId = randomUUID();
  const terminalId = randomUUID();
  const userId = randomUUID();
  const token = generateTerminalToken();
  const email = emailFor("pool");

  await tx.insert(organizations).values({
    id: organizationId,
    name: "Pool Organization",
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
    name: "Pool Terminal",
    tokenHash: hashTerminalToken(token),
  });

  await tx.insert(users).values({
    id: userId,
    organizationId,
    email,
    fullName: "Pool User",
    passwordHash: "stored-password-hash",
  });

  return { organizationId, branchId, terminalId, token, email, userId };
}

async function attemptEmail(
  context: { token: string },
  email: string,
  password: string,
) {
  return (harness.cookieStore as CookieStore).run(context.token, () =>
    login({ email, password }),
  );
}

async function attempt(context: { token: string; email: string }, password: string) {
  return attemptEmail(context, context.email, password);
}

async function terminalFailureCount(keyHash: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(loginFailures)
    .where(and(eq(loginFailures.keyType, "terminal"), eq(loginFailures.keyHash, keyHash)));

  return row.total;
}

async function authAuditCount(terminalId: string): Promise<number> {
  const rows = await db
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(and(eq(auditEvents.terminalId, terminalId), like(auditEvents.action, "auth.%")));

  return rows.length;
}

describe("Task 1.8a login pool behavior", () => {
  it("keeps a different terminal and ordinary reads responsive during 50 parallel failed logins", async () => {
    const loaded = process.env.TASK_1_8A_LOADED === "1";
    const watcherLimitMs = loaded ? 15000 : 3000;
    const busy = await db.transaction((tx) => createContext(tx as Tx));
    const observer = await db.transaction((tx) => createContext(tx as Tx));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const pendingAttempts = Array.from({ length: 50 }, () => {
        const start = performance.now();
        return attemptEmail(busy, emailFor("pool-failure"), harness.wrongPassword).then(
          (result) => ({ result, duration: performance.now() - start }),
        );
      });

      const readStart = performance.now();
      const readPromise = db.execute(sql`select 1`).then(() => ({
        duration: performance.now() - readStart,
      }));
      const watcherStart = performance.now();
      const watcherPromise = attempt(observer, harness.correctPassword);

      const [outcomes, watcherResult, readOutcome] = await Promise.all([
        Promise.all(pendingAttempts),
        watcherPromise,
        readPromise,
      ]);

      const readMs = readOutcome.duration;
      const watcherMs = performance.now() - watcherStart;
      const busyCount = outcomes.filter(
        ({ result }) => result.ok === false && reasonOf(result) === "busy",
      ).length;
      const maxAttemptMs = Math.max(...outcomes.map(({ duration }) => duration));
      const observed = `loaded=${loaded} watcher ms=${watcherMs.toFixed(1)} read ms=${readMs.toFixed(1)} busy=${busyCount} max attempt ms=${maxAttemptMs.toFixed(1)} watcher reason=${reasonOf(watcherResult) ?? "none"}`;

      console.log(
        `pool_loaded=${loaded} pool_watcher_ms=${watcherMs.toFixed(1)} pool_busy=${busyCount} pool_max_attempt_ms=${maxAttemptMs.toFixed(1)} pool_ordinary_read_ms=${readMs.toFixed(1)} pool_watcher_reason=${reasonOf(watcherResult) ?? "none"} pool_error_codes=${errorSpy.mock.calls.map((call) => String(call[0])).join(",")}`,
      );

      expect(watcherResult.ok, observed).toBe(true);
      expect(watcherMs, observed).toBeLessThan(watcherLimitMs);
      expect(readMs, observed).toBeLessThan(500);
      expect(busyCount, observed).toBeGreaterThan(0);
      expect(maxAttemptMs, observed).toBeLessThan(5000);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("writes no failure row or auth audit row when a lock wait times out", async () => {
    const context = await db.transaction((tx) => createContext(tx as Tx));
    const keyHash = hashKey(context.terminalId);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const beforeFailures = await terminalFailureCount(keyHash);
    const beforeAudit = await authAuditCount(context.terminalId);
    const client = await pool.connect();

    try {
      await client.query("SELECT pg_advisory_lock(hashtext($1))", [`terminal:${keyHash}`]);
      const result = await attemptEmail(
        context,
        emailFor("timeout"),
        harness.wrongPassword,
      );
      expect(reasonOf(result)).toBe("busy");
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`terminal:${keyHash}`]);
      client.release();
      errorSpy.mockRestore();
    }

    expect(await terminalFailureCount(keyHash)).toBe(beforeFailures);
    expect(await authAuditCount(context.terminalId)).toBe(beforeAudit);
  });

  it("writes no failure row or auth audit row for a busy result", async () => {
    const context = await db.transaction((tx) => createContext(tx as Tx));
    const keyHash = hashKey(context.terminalId);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let verifyStarted = 0;

    harness.verifyPassword.mockImplementation(async (_hash: string, plain: string) => {
      if (plain === harness.correctPassword) return true;
      verifyStarted += 1;
      await gate;
      return false;
    });

    const pending = Array.from({ length: 5 }, () =>
      attemptEmail(context, emailFor("gate"), harness.wrongPassword),
    );

    try {
      await vi.waitFor(() => expect(verifyStarted).toBeGreaterThan(0));

      const beforeFailures = await terminalFailureCount(keyHash);
      const beforeAudit = await authAuditCount(context.terminalId);
      const busy = await attemptEmail(context, emailFor("busy"), harness.wrongPassword);

      expect(reasonOf(busy)).toBe("busy");
      expect(await terminalFailureCount(keyHash)).toBe(beforeFailures);
      expect(await authAuditCount(context.terminalId)).toBe(beforeAudit);
    } finally {
      release();
      await Promise.all(pending);
      errorSpy.mockRestore();
    }
  });

  it("measures auth pool connection wait when all clients are occupied", async () => {
    const held = await Promise.all(Array.from({ length: 8 }, () => authPool.connect()));
    let waitError: unknown;
    const waitStart = performance.now();

    try {
      const client = await authPool.connect();
      client.release();
    } catch (error) {
      waitError = error;
    } finally {
      for (const client of held) client.release();
    }

    const waitMs = performance.now() - waitStart;

    console.log(
      `auth_pool_wait_ms=${waitMs.toFixed(1)} auth_pool_wait_timed_out=${waitError !== undefined}`,
    );

    expect(waitError, "expected the ninth auth pool connection request to time out").toBeDefined();
    expect(waitMs).toBeGreaterThanOrEqual(900);
    expect(waitMs).toBeLessThan(2000);
  });
});
