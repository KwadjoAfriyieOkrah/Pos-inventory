import { randomUUID } from "node:crypto";
import { and, count as sqlCount, eq, gt, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  branches,
  loginFailures,
  organizations,
  terminals,
  users,
} from "../../db/schema";
import {
  EMAIL_LIMIT,
  EMAIL_WINDOW_MINUTES,
  hashKey,
} from "../../src/server/auth/rate-limit";

type DbClient = typeof import("../../src/server/db/client")["db"];
type Login = typeof import("../../src/server/auth/login")["login"];
type LoginResult = Awaited<ReturnType<Login>>;
type GenerateTerminalToken = typeof import("../../src/server/auth/terminal")["generateTerminalToken"];
type HashTerminalToken = typeof import("../../src/server/auth/terminal")["hashTerminalToken"];

const INJECTED_NOW = new Date();

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
  }),
}));
vi.mock("@/lib/env", () => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: "x".repeat(64),
    APP_URL: "http://localhost:3000",
    APP_TIMEZONE: "Africa/Accra",
  },
}));
vi.mock("@/server/db/client", async () => await import("../../src/server/db/client"));
vi.mock("../../src/server/auth/password", () => ({
  DUMMY_HASH: "dummy-hash-for-tests",
  verifyPassword: harness.verifyPassword,
}));

type Context = {
  organizationId: string;
  branchId: string;
  terminalId: string;
  token: string;
  email: string;
  userId: string;
};

let db: DbClient;
let pool: typeof import("../../src/server/db/client")["pool"];
let authPool: typeof import("../../src/server/auth/login-db")["authPool"];
let login: Login;
let generateTerminalToken: GenerateTerminalToken;
let hashTerminalToken: HashTerminalToken;
const createdContexts: Context[] = [];
const usedEmailHashes = new Set<string>();

function reasonOf(result: LoginResult): string | undefined {
  return "reason" in result ? result.reason : undefined;
}

function messageOf(result: LoginResult): string | undefined {
  return "message" in result ? result.message : undefined;
}

function emailFor(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, "")}@example.invalid`;
}

async function createContext(): Promise<Context> {
  const organizationId = randomUUID();
  const branchId = randomUUID();
  const terminalId = randomUUID();
  const userId = randomUUID();
  const token = generateTerminalToken();
  const email = emailFor("rate-limit");

  await db.insert(organizations).values({
    id: organizationId,
    name: `Rate Limit Organization ${randomUUID()}`,
  });
  await db.insert(branches).values({
    id: branchId,
    organizationId,
    name: "Main",
    branchCode: randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase(),
    digitalAddress: randomUUID(),
    licenceNumber: randomUUID(),
    licenceExpiresOn: "2030-01-01",
  });
  await db.insert(terminals).values({
    id: terminalId,
    organizationId,
    branchId,
    name: "Rate Limit Terminal",
    tokenHash: hashTerminalToken(token),
  });
  await db.insert(users).values({
    id: userId,
    organizationId,
    email,
    fullName: "Rate Limit User",
    passwordHash: hashKey("stored-password-hash"),
  });

  const context = { organizationId, branchId, terminalId, token, email, userId };
  createdContexts.push(context);
  usedEmailHashes.add(hashKey(email));
  return context;
}

async function attempt(context: Context, password: string): Promise<LoginResult> {
  harness.cookieToken = context.token;
  return login({ email: context.email, password });
}

async function attemptEmail(
  context: Context,
  email: string,
  password: string,
): Promise<LoginResult> {
  harness.cookieToken = context.token;
  usedEmailHashes.add(hashKey(email));
  return login({ email, password });
}

async function failureCount(
  client: DbClient,
  keyType: "email" | "terminal",
  hash: string,
  since: Date,
): Promise<number> {
  const [row] = await client
    .select({ total: sqlCount() })
    .from(loginFailures)
    .where(
      and(
        eq(loginFailures.keyType, keyType),
        eq(loginFailures.keyHash, hash),
        gt(loginFailures.failedAt, since),
      ),
    );
  return row.total;
}

async function emailStatusRows(client: DbClient, email: string) {
  return client
    .select({ id: loginFailures.id, status: loginFailures.status })
    .from(loginFailures)
    .where(
      and(
        eq(loginFailures.keyType, "email"),
        eq(loginFailures.keyHash, hashKey(email)),
      ),
    );
}

async function cleanUp(): Promise<void> {
  const terminalIds = createdContexts.map((context) => context.terminalId);
  const keyHashes = [
    ...usedEmailHashes,
    ...terminalIds.map((terminalId) => hashKey(terminalId)),
  ];

  if (keyHashes.length > 0) {
    await db.delete(loginFailures).where(inArray(loginFailures.keyHash, keyHashes));
  }

  createdContexts.length = 0;
  usedEmailHashes.clear();
}

beforeAll(async () => {
  const databaseName = new URL(process.env.DATABASE_URL ?? "")
    .pathname.replace(/^\/+/, "")
    .toLowerCase();
  if (databaseName !== "pos_test") {
    throw new Error("Refusing to run: DATABASE_URL must point to pos_test.");
  }

  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
  ({ authPool } = await import("../../src/server/auth/login-db"));
  ({ login } = await import("../../src/server/auth/login"));
  ({ generateTerminalToken, hashTerminalToken } = await import("../../src/server/auth/terminal"));
});

beforeEach(() => {
  vi.useRealTimers();
  harness.cookieToken = undefined;
  harness.verifyPassword.mockClear();
});

afterEach(async () => {
  vi.useRealTimers();
  harness.cookieToken = undefined;
  harness.verifyPassword.mockClear();
  await cleanUp();
});

afterAll(async () => {
  if (pool) await pool.end();
  if (authPool) await authPool.end();
});

describe("login rate limiting", () => {
  it("locks the sixth attempt after five failures without checking its password", async () => {
    const context = await createContext();

    for (let index = 0; index < EMAIL_LIMIT; index += 1) {
      const failed = await attempt(context, harness.wrongPassword);
      expect(failed.ok).toBe(false);
      expect(reasonOf(failed)).toBe("bad_credentials");
    }

    harness.verifyPassword.mockClear();
    const locked = await attempt(context, harness.correctPassword);

    expect(locked.ok).toBe(false);
    expect(reasonOf(locked)).toBe("locked");
    expect(harness.verifyPassword).toHaveBeenCalledTimes(0);
  });

  it("returns the same lock message for an existing and a missing email", async () => {
    const context = await createContext();
    const missingEmail = emailFor("missing");

    for (let index = 0; index < EMAIL_LIMIT; index += 1) {
      expect((await attempt(context, harness.wrongPassword)).ok).toBe(false);
      expect((await attemptEmail(context, missingEmail, harness.wrongPassword)).ok).toBe(false);
    }

    const existingLocked = await attempt(context, harness.correctPassword);
    const missingLocked = await attemptEmail(context, missingEmail, harness.correctPassword);

    expect(reasonOf(existingLocked)).toBe("locked");
    expect(reasonOf(missingLocked)).toBe("locked");
    expect(messageOf(existingLocked)).toBe(messageOf(missingLocked));
    expect(messageOf(existingLocked)).toBeDefined();
  });

  it("records exactly five failure rows and fifteen refusals for twenty concurrent attempts", async () => {
    const context = await createContext();
    harness.verifyPassword.mockClear();

    const results = await Promise.all(
      Array.from({ length: 20 }, () => attempt(context, harness.wrongPassword)),
    );
    const rows = await emailStatusRows(db, context.email);
    const refusals = results.filter((result) => {
      const reason = reasonOf(result);
      return reason === "locked" || reason === "busy";
    });
    const observed = `rows=${rows.length} refusals=${refusals.length}`;

    expect(rows, observed).toHaveLength(EMAIL_LIMIT);
    expect(refusals, observed).toHaveLength(20 - EMAIL_LIMIT);
  });

  it("does not count failures older than the fifteen minute window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(INJECTED_NOW);
    const context = await createContext();
    const hash = hashKey(context.email);
    const oldFailedAt = new Date(INJECTED_NOW.getTime() - 16 * 60_000);

    await db.insert(loginFailures).values(
      Array.from({ length: EMAIL_LIMIT }, () => ({
        keyType: "email" as const,
        keyHash: hash,
        failedAt: oldFailedAt,
        status: "failed" as const,
      })),
    );

    const withinWindow = await failureCount(
      db,
      "email",
      hash,
      new Date(INJECTED_NOW.getTime() - EMAIL_WINDOW_MINUTES * 60_000),
    );
    expect(withinWindow).toBe(0);

    const succeeded = await attempt(context, harness.correctPassword);

    expect(succeeded.ok).toBe(true);
    expect(reasonOf(succeeded)).toBeUndefined();
  });

  it("refuses a login when the auth.login_failed audit insert fails and leaves no failure row", async () => {
    const context = await createContext();
    const suffix = randomUUID().replace(/-/g, "");
    const functionName = `block_failed_audit_${suffix}`;
    const triggerName = `block_failed_audit_${suffix}`;
    let result: LoginResult | undefined;

    try {
      await db.execute(
        sql.raw(
          `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'auth.login_failed' THEN RAISE EXCEPTION 'simulated audit insert failure'; END IF; RETURN NEW; END; $$`,
        ),
      );
      await db.execute(
        sql.raw(
          `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${functionName}();`,
        ),
      );

      harness.verifyPassword.mockClear();
      result = await attempt(context, harness.wrongPassword);
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_events;`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}();`));
    }

    const failedRows = (await emailStatusRows(db, context.email)).filter(
      (row) => row.status === "failed",
    );
    const observed = `reason=${reasonOf(result as LoginResult) ?? "none"} failedRows=${failedRows.length}`;

    expect(result?.ok, observed).toBe(false);
    expect(reasonOf(result as LoginResult), observed).toBe("unavailable");
    expect(failedRows, observed).toHaveLength(0);
  });

  it("produces zero SQLSTATE 40P01 errors over twenty swapped-key runs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      for (let iteration = 0; iteration < 20; iteration += 1) {
        const context = await createContext();
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
  }, 60000);
});
