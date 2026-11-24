import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
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
  auditEvents,
  branches,
  loginFailures,
  organizations,
  terminals,
  users,
} from "../../db/schema";
import { branchCodeFromName } from "../../src/lib/sale-number";
import { authDb } from "../../src/server/auth/login-db";
import { hashKey } from "../../src/server/auth/rate-limit";

loadDotenv({ path: ".env.local", quiet: true });

type DbClient = typeof import("../../src/server/db/client")["db"];
type Login = typeof import("../../src/server/auth/login")["login"];
type FailedLogin = Extract<Awaited<ReturnType<Login>>, { ok: false }>;
type LoginAction = typeof import("../../src/app/(auth)/login/actions")["loginAction"];
type GenerateTerminalToken = typeof import("../../src/server/auth/terminal")["generateTerminalToken"];
type HashTerminalToken = typeof import("../../src/server/auth/terminal")["hashTerminalToken"];

const TEST_PASSWORD = "correct horse battery staple";
const WRONG_PASSWORD = "wrong horse battery staple";
const ERROR_MESSAGE = "Email or password is incorrect";

let branchCodeSequence = 0;
const UNREGISTERED_TERMINAL_MESSAGE =
  "This device is not registered. Contact the pharmacy owner.";

const harness = vi.hoisted(() => ({
  cookieToken: undefined as string | undefined,
}));

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
vi.mock("@/lib/env", () => ({
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: "x".repeat(64),
    APP_URL: "http://localhost:3000",
    APP_TIMEZONE: "Africa/Accra",
  },
}));
vi.mock("@/server/db/client", async () => await import("../../src/server/db/client"));

vi.mock("next-auth", () => {
  class AuthError extends Error {
    type = "CredentialsSignin";

    constructor(message = "Auth error") {
      super(message);
      this.name = "AuthError";
    }
  }

  return { AuthError };
});

vi.mock("@/server/auth", async () => {
  const { AuthError } = await import("next-auth");
  return {
    signIn: async () => {
      throw new AuthError("CredentialsSignin");
    },
  };
});

type Context = {
  id: string;
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
let hashPassword: (plain: string) => Promise<string>;
let login: Login;
let loginAction: LoginAction;
let generateTerminalToken: GenerateTerminalToken;
let hashTerminalToken: HashTerminalToken;
const createdContexts: Context[] = [];
const usedEmailHashes = new Set<string>();

function emailFor(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, "")}@example.invalid`;
}

async function createContext(isActive = true): Promise<Context> {
  const organizationId = randomUUID();
  const branchId = randomUUID();
  const terminalId = randomUUID();
  const userId = randomUUID();
  const token = generateTerminalToken();
  const email = emailFor("login-user");
  const branchName = `login-branch-${randomUUID()}-${String.fromCharCode(65 + (branchCodeSequence++ % 26))}`;

  await db.insert(organizations).values({
    id: organizationId,
    name: `Login Organization ${randomUUID()}`,
  });
  await db.insert(branches).values({
    id: branchId,
    organizationId,
    name: branchName,
    branchCode: branchCodeFromName(branchName),
    digitalAddress: randomUUID(),
    licenceNumber: randomUUID(),
    licenceExpiresOn: "2030-01-01",
  });
  await db.insert(terminals).values({
    id: terminalId,
    organizationId,
    branchId,
    name: `Login Terminal ${randomUUID()}`,
    tokenHash: hashTerminalToken(token),
  });
  await db.insert(users).values({
    id: userId,
    organizationId,
    email,
    fullName: "Login Test User",
    passwordHash: await hashPassword(TEST_PASSWORD),
    isActive,
  });

  const context = { id: userId, organizationId, branchId, terminalId, token, email, userId };
  createdContexts.push(context);
  usedEmailHashes.add(hashKey(email));
  return context;
}

async function attemptEmail(
  context: Context,
  email: string,
  password: string,
): Promise<Awaited<ReturnType<Login>>> {
  harness.cookieToken = context.token;
  usedEmailHashes.add(hashKey(email));
  return login({ email, password });
}

async function auditRows(
  client: DbClient,
  action: string,
  actorUserId: string,
) {
  return client
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.action, action), eq(auditEvents.actorUserId, actorUserId)));
}

async function storedPasswordHash(client: DbClient, userId: string): Promise<string | null> {
  const [row] = await client
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  return row.passwordHash;
}

async function withAuditInsertFailure(action: string, run: () => Promise<void>): Promise<void> {
  const suffix = randomUUID().replace(/-/g, "");
  const functionName = `block_${suffix}`;
  const triggerName = `block_${suffix}`;

  try {
    await db.execute(
      sql.raw(
        `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'simulated audit insert failure'; END IF; RETURN NEW; END; $$`,
      ),
    );
    await db.execute(
      sql.raw(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${functionName}();`,
      ),
    );
    await run();
  } finally {
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_events;`));
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}();`));
  }
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
  ({ hashPassword } = await import("../../src/server/auth/password"));
  ({ login } = await import("../../src/server/auth/login"));
  ({ loginAction } = await import("../../src/app/(auth)/login/actions"));
  ({
    generateTerminalToken,
    hashTerminalToken,
  } = await import("../../src/server/auth/terminal"));
});

beforeEach(() => {
  harness.cookieToken = undefined;
});

afterEach(async () => {
  harness.cookieToken = undefined;
  vi.restoreAllMocks();
  await cleanUp();
});

afterAll(async () => {
  if (pool) await pool.end();
  if (authPool) await authPool.end();
});

function formFor(email: string, password: string): FormData {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return formData;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

function consoleCallArguments(source: string): string[] {
  const results: string[] = [];
  const pattern = /console\.(log|info|warn|error|debug|trace)\s*\(/g;

  while (pattern.exec(source) !== null) {
    const start = pattern.lastIndex;
    let depth = 1;
    let index = start;
    let quote: string | null = null;
    let escaped = false;

    while (index < source.length && depth > 0) {
      const character = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
      } else if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "(") {
        depth += 1;
      } else if (character === ")") {
        depth -= 1;
      }
      index += 1;
    }

    results.push(source.slice(start, Math.max(start, index - 1)));
    pattern.lastIndex = index;
  }

  return results;
}

describe("login", () => {
  it("unknown email returns ok:false and writes one unknown_email audit row", async () => {
    const context = await createContext();
    const organizationId = context.organizationId;
    const branchId = context.branchId;
    const terminal = { terminalId: context.terminalId };
    const email = emailFor("nobody");
    const result = await attemptEmail(context, email, WRONG_PASSWORD);

    expect(result.ok).toBe(false);
    expect((result as FailedLogin).reason).toBe("bad_credentials");
    expect((result as FailedLogin).message).toBe("Email or password is incorrect");
    const rows = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationId),
          eq(auditEvents.action, "auth.login_failed"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(organizationId);
    expect(rows[0].branchId).toBe(branchId);
    expect(rows[0].terminalId).toBe(terminal.terminalId);
    expect(rows[0].actorUserId).toBeNull();
    expect((rows[0].payload as { reason?: string }).reason).toBe("unknown_email");
  });

  it("login without the pos_terminal cookie is refused and writes no audit row", async () => {
    const context = await createContext();
    harness.cookieToken = undefined;

    const result = await loginAction(
      { error: null },
      formFor(emailFor("nobody"), TEST_PASSWORD),
    );

    expect(result).toEqual({ error: UNREGISTERED_TERMINAL_MESSAGE });
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, context.organizationId));
    expect(rows).toHaveLength(0);
  });

  it("wrong password writes one bad_password audit row without credentials", async () => {
    const context = await createContext();
    const user = { id: context.userId, email: context.email };
    const result = await attemptEmail(context, user.email, WRONG_PASSWORD);

    expect(result.ok).toBe(false);
    expect((result as FailedLogin).reason).toBe("bad_credentials");
    expect((result as FailedLogin).message).toBe("Email or password is incorrect");
    const rows = await auditRows(db, "auth.login_failed", user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ reason: "bad_password" });

    const payload = JSON.stringify(rows[0].payload);
    expect(payload).not.toContain(user.email);
    expect(payload).not.toContain(TEST_PASSWORD);
    expect(payload).not.toContain(WRONG_PASSWORD);
  });

  it("inactive user writes one inactive audit row", async () => {
    const context = await createContext(false);
    const result = await attemptEmail(context, context.email, TEST_PASSWORD);

    expect(result.ok).toBe(false);
    expect((result as FailedLogin).reason).toBe("bad_credentials");
    expect((result as FailedLogin).message).toBe("Email or password is incorrect");
    const rows = await auditRows(db, "auth.login_failed", context.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ reason: "inactive" });
  });

  it("correct password for active user writes one login_succeeded audit row", async () => {
    const context = await createContext();
    const user = { id: context.userId, email: context.email };
    const result = await attemptEmail(context, user.email, TEST_PASSWORD);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(user.id);
      expect(result.user.email).toBe(user.email);
    }
    const rows = await auditRows(db, "auth.login_succeeded", user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({});
  });

  it("failed login_succeeded audit insert returns ok:false and commits no login row", async () => {
    const context = await createContext();
    let result: Awaited<ReturnType<Login>> | undefined;

    await withAuditInsertFailure("auth.login_succeeded", async () => {
      result = await attemptEmail(context, context.email, TEST_PASSWORD);
    });

    expect(result!.ok).toBe(false);
    expect((result as FailedLogin).reason).toBe("unavailable");
    expect((result as FailedLogin).message).toBe(
      "Login is temporarily unavailable. Try again shortly.",
    );
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, context.userId));
    expect(rows).toHaveLength(0);
  });

  it("failed login_failed audit insert still returns ok:false and creates no session", async () => {
    const context = await createContext();
    let result!: Awaited<ReturnType<Login>>;

    await withAuditInsertFailure("auth.login_failed", async () => {
      result = await attemptEmail(context, context.email, WRONG_PASSWORD);
    });

    expect(result.ok).toBe(false);
    expect((result as FailedLogin).reason).toBe("unavailable");
    expect((result as FailedLogin).message).toBe(
      "Login is temporarily unavailable. Try again shortly.",
    );
    expect("user" in result).toBe(false);
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, context.userId));
    expect(rows).toHaveLength(0);
  });

  it("reports unknown-email and wrong-password timings without failing on them", async () => {
    const context = await createContext();
    const unknownEmail = emailFor("nobody");

    const unknownStart = performance.now();
    await attemptEmail(context, unknownEmail, WRONG_PASSWORD);
    const unknownMs = performance.now() - unknownStart;

    const wrongStart = performance.now();
    await attemptEmail(context, context.email, WRONG_PASSWORD);
    const wrongMs = performance.now() - wrongStart;

    console.log(
      `timing report: unknown=${unknownMs.toFixed(1)}ms wrong=${wrongMs.toFixed(1)}ms`,
    );
    expect(Number.isFinite(unknownMs)).toBe(true);
    expect(Number.isFinite(wrongMs)).toBe(true);
  });

  it("shows exactly one error message for every failure path", async () => {
    const active = await createContext();
    const inactive = await createContext(false);

    const cases = [
      formFor(emailFor("nobody"), WRONG_PASSWORD),
      formFor(active.email, WRONG_PASSWORD),
      formFor(inactive.email, TEST_PASSWORD),
    ];

    for (const formData of cases) {
      harness.cookieToken = active.token;
      const result = await loginAction({ error: null }, formData);
      expect(result.error).toBe(ERROR_MESSAGE);
    }

    await withAuditInsertFailure("auth.login_succeeded", async () => {
      harness.cookieToken = active.token;
      const result = await loginAction(
        { error: null },
        formFor(active.email, TEST_PASSWORD),
      );
      expect(result.error).toBe(ERROR_MESSAGE);
    });
  });

  it("finds no password, password_hash, or AUTH_SECRET in src console calls", () => {
    const root = join(process.cwd(), "src");
    const forbidden = [/\bpassword\b/i, /\bpassword_hash\b/i, /\bAUTH_SECRET\b/];
    const violations: string[] = [];

    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, "utf8");
      for (const args of consoleCallArguments(source)) {
        if (forbidden.some((pattern) => pattern.test(args))) {
          violations.push(`${relative(process.cwd(), file)}: ${args.trim()}`);
        }
      }
    }

    expect(violations, `console leaks: ${violations.join(" | ")}`).toEqual([]);
  });

  it("re-review: wrong password on active user records bad_password", async () => {
    const context = await createContext();
    const result = await attemptEmail(context, context.email, WRONG_PASSWORD);

    expect(result.ok).toBe(false);
    expect((result as FailedLogin).reason).toBe("bad_credentials");
    expect((result as FailedLogin).message).toBe("Email or password is incorrect");
    const rows = await auditRows(db, "auth.login_failed", context.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ reason: "bad_password" });
  });

  it("re-review: inactive user with correct password records inactive", async () => {
    const context = await createContext(false);
    const result = await attemptEmail(context, context.email, TEST_PASSWORD);

    expect(result.ok).toBe(false);
    expect((result as FailedLogin).reason).toBe("bad_credentials");
    expect((result as FailedLogin).message).toBe("Email or password is incorrect");
    const rows = await auditRows(db, "auth.login_failed", context.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ reason: "inactive" });
  });

  it("re-review: inactive user with wrong password records inactive_and_bad_password", async () => {
    const context = await createContext(false);
    const result = await attemptEmail(context, context.email, WRONG_PASSWORD);

    expect(result.ok).toBe(false);
    expect((result as FailedLogin).reason).toBe("bad_credentials");
    expect((result as FailedLogin).message).toBe("Email or password is incorrect");
    const rows = await auditRows(db, "auth.login_failed", context.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ reason: "inactive_and_bad_password" });
  });

  it("re-review: database error keeps SQLSTATE through cause chain and logs only the code", async () => {
    const context = await createContext();
    const inner = Object.assign(new Error("db connection failed"), { code: "28P01" });
    const wrapped = new Error("query wrapper", { cause: inner });
    const selectSpy = vi.spyOn(authDb, "select").mockImplementationOnce(() => {
      throw wrapped;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await attemptEmail(context, emailFor("nobody"), WRONG_PASSWORD);

      expect(result.ok).toBe(false);
      expect((result as FailedLogin).reason).toBe("unavailable");
      expect((result as FailedLogin).message).toBe(
        "Login is temporarily unavailable. Try again shortly.",
      );
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith("28P01");
      for (const call of errorSpy.mock.calls) {
        expect(call).toEqual(["28P01"]);
      }
    } finally {
      selectSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("re-review: INVALID_LOGIN_MESSAGE is exported and imported without duplicate literal", () => {
    const root = join(process.cwd(), "src");
    const loginSource = readFileSync(join(root, "server/auth/login.ts"), "utf8");
    const actionSource = readFileSync(
      join(root, "app/(auth)/login/actions.ts"),
      "utf8",
    );

    expect(loginSource).toMatch(
      /export const INVALID_LOGIN_MESSAGE = "Email or password is incorrect";/,
    );
    expect(actionSource).toMatch(
      /import \{ INVALID_LOGIN_MESSAGE \} from "\.\.\/\.\.\/\.\.\/server\/auth\/login";/,
    );
    expect(actionSource).toMatch(/return \{ error: INVALID_LOGIN_MESSAGE \};/);

    const literalFiles = sourceFiles(root)
      .filter((file) => readFileSync(file, "utf8").includes(ERROR_MESSAGE))
      .map((file) => relative(process.cwd(), file).replace(/\\/g, "/"));

    expect(literalFiles, `literal found in ${literalFiles.join(", ")}`).toEqual([
      "src/server/auth/login.ts",
    ]);
  });

  it("re-review: ADR 0005 status is Proposed", () => {
    const adr = readFileSync(
      join(process.cwd(), "docs/adr/0005-unresolved-events-policy.md"),
      "utf8",
    );

    expect(adr).toMatch(/## Status\s*\n\s*Proposed\b/);
    expect(adr).not.toMatch(/## Status\s*\n\s*Accepted\b/);
  });

  it("re-review: failure payloads contain no IP, email, password, or hash", async () => {
    const activeWrong = await createContext();
    const inactiveCorrect = await createContext(false);
    const inactiveWrong = await createContext(false);

    await attemptEmail(activeWrong, activeWrong.email, WRONG_PASSWORD);
    await attemptEmail(inactiveCorrect, inactiveCorrect.email, TEST_PASSWORD);
    await attemptEmail(inactiveWrong, inactiveWrong.email, WRONG_PASSWORD);

    const cases = [
      { user: activeWrong, reason: "bad_password" },
      { user: inactiveCorrect, reason: "inactive" },
      { user: inactiveWrong, reason: "inactive_and_bad_password" },
    ];
    const serialized: string[] = [];

    for (const testCase of cases) {
      const rows = await auditRows(db, "auth.login_failed", testCase.user.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ reason: testCase.reason });
      serialized.push(JSON.stringify(rows[0].payload));
    }

    const combined = serialized.join(" ");
    for (const testCase of cases) {
      expect(combined).not.toContain(testCase.user.email);
      const hash = await storedPasswordHash(db, testCase.user.id);
      if (hash) expect(combined).not.toContain(hash);
    }
    expect(combined).not.toContain(TEST_PASSWORD);
    expect(combined).not.toContain(WRONG_PASSWORD);
    expect(combined).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
    expect(combined).not.toMatch(/\b(?:[0-9a-fA-F]{1,4}:){2,}[0-9a-fA-F]{1,4}\b/);
    expect(combined).not.toMatch(/\$argon2/);
  });
});
