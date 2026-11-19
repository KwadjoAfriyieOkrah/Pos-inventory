import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { and, eq } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { auditEvents, branches, organizations, terminals, users } from "../../db/schema";

loadDotenv({ path: ".env.local", quiet: true });

type DbClient = typeof import("../../src/server/db/client")["db"];
type Login = typeof import("../../src/server/auth/login")["login"];
type LoginAction = typeof import("../../src/app/(auth)/login/actions")["loginAction"];
type GenerateTerminalToken = typeof import("../../src/server/auth/terminal")["generateTerminalToken"];
type HashTerminalToken = typeof import("../../src/server/auth/terminal")["hashTerminalToken"];

function reasonOf(result: Awaited<ReturnType<Login>>): string | undefined {
  return "reason" in result ? result.reason : undefined;
}

const TEST_PASSWORD = "correct horse battery staple";
const WRONG_PASSWORD = "wrong horse battery staple";
const ERROR_MESSAGE = "Email or password is incorrect";
const UNREGISTERED_TERMINAL_MESSAGE =
  "This device is not registered. Contact the pharmacy owner.";

const harness = vi.hoisted(() => ({
  insertFailure: undefined as "succeeded" | "failed" | undefined,
  selectError: undefined as unknown,
  selectErrorOnCall: undefined as number | undefined,
  selectCalls: 0,
  cookieToken: undefined as string | undefined,
  lastErrorStage: "none" as string,
  lastErrorInfo: "none" as string,
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
vi.mock("@/lib/env", async () => {
  const real = await import("../../src/lib/env");
  return { env: real.env };
});

vi.mock("@/server/db/client", async () => await import("../../src/server/db/client"));

vi.mock("../../src/server/auth/login-db", async () => {
  const actual = await vi.importActual<typeof import("../../src/server/auth/login-db")>(
    "../../src/server/auth/login-db",
  );

  type WrappedClient = {
    select: (...args: unknown[]) => unknown;
    insert: (...args: unknown[]) => unknown;
    execute: (...args: unknown[]) => unknown;
  };

  const wrapSelect = (client: WrappedClient) =>
    (...args: unknown[]) => {
      harness.selectCalls += 1;
      if (harness.selectError && harness.selectCalls === harness.selectErrorOnCall) {
        throw harness.selectError;
      }
      try {
        return client.select.call(client, ...args);
      } catch (error) {
        harness.lastErrorStage = "select";
        throw error;
      }
    };

  const wrapInsert = (client: WrappedClient) =>
    (...args: unknown[]) => {
      if (harness.insertFailure === "succeeded") {
        throw new Error("simulated auth.login_succeeded insert failure");
      }
      if (harness.insertFailure === "failed") {
        throw new Error("simulated auth.login_failed insert failure");
      }
      try {
        return client.insert.call(client, ...args);
      } catch (error) {
        harness.lastErrorStage = "insert";
        throw error;
      }
    };

  const wrapClient = (client: WrappedClient): WrappedClient => ({
    select: wrapSelect(client),
    insert: wrapInsert(client),
    execute: (...args: unknown[]) => {
      try {
        return client.execute.call(client, ...args);
      } catch (error) {
        harness.lastErrorStage = "execute";
        throw error;
      }
    },
  });

  return {
    ...actual,
    authDb: {
      select: wrapSelect(actual.authDb as unknown as WrappedClient),
      insert: wrapInsert(actual.authDb as unknown as WrappedClient),
      execute: (...args: unknown[]) =>
        (actual.authDb.execute as unknown as (...a: unknown[]) => unknown).call(actual.authDb, ...args),
      transaction: async (run: (client: WrappedClient) => Promise<unknown>) => {
        try {
          return await actual.authDb.transaction(async (client) =>
            run(wrapClient(client as unknown as WrappedClient)),
          );
        } catch (error) {
          harness.lastErrorStage = `transaction:${harness.lastErrorStage}`;
          throw error;
        }
      },
    } as unknown as typeof actual.authDb,
  };
});

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

let db: DbClient;
let pool: typeof import("../../src/server/db/client")["pool"];
let authPool: typeof import("../../src/server/auth/login-db")["authPool"];
let hashPassword: (plain: string) => Promise<string>;
let login: Login;
let loginAction: LoginAction;
let generateTerminalToken: GenerateTerminalToken;
let hashTerminalToken: HashTerminalToken;

beforeAll(async () => {
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

afterEach(() => {
  harness.cookieToken = undefined;
});

afterAll(async () => {
  if (pool) await pool.end();
  if (authPool) await authPool.end();
});

async function withCommittedFixtures(run: (tx: DbClient) => Promise<void>): Promise<void> {
  await run(db);
}

async function insertOrganization(tx: DbClient): Promise<string> {
  const [row] = await tx
    .insert(organizations)
    .values({ name: `login-org-${randomUUID()}` })
    .returning();
  return row.id;
}

async function insertBranch(tx: DbClient, organizationId: string): Promise<string> {
  const [branch] = await tx
    .insert(branches)
    .values({
      organizationId,
      name: `login-branch-${randomUUID()}`,
      digitalAddress: `addr-${randomUUID()}`,
      licenceNumber: randomUUID(),
      licenceExpiresOn: "2030-12-31",
    })
    .returning();
  return branch.id;
}

async function insertTerminal(
  tx: DbClient,
  organizationId: string,
  branchId: string,
  token: string,
): Promise<{ terminalId: string }> {
  const [terminal] = await tx
    .insert(terminals)
    .values({
      organizationId,
      branchId,
      name: `login-terminal-${randomUUID()}`,
      tokenHash: hashTerminalToken(token),
    })
    .returning();
  return { terminalId: terminal.id };
}

async function insertUser(
  tx: DbClient,
  organizationId: string,
  isActive: boolean,
): Promise<{ id: string; email: string }> {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const [row] = await tx
    .insert(users)
    .values({
      organizationId,
      email: `login-user-${randomUUID()}@example.com`,
      fullName: "Login Test User",
      passwordHash,
      isActive,
    })
    .returning();
  return { id: row.id, email: row.email };
}

async function storedPasswordHash(tx: DbClient, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  return row.passwordHash;
}

async function auditRows(
  tx: DbClient,
  action: string,
  actorUserId: string,
) {
  return tx
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.action, action), eq(auditEvents.actorUserId, actorUserId)));
}

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
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const branchId = await insertBranch(tx, organizationId);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      const terminal = await insertTerminal(tx, organizationId, branchId, token);
      const email = `nobody-${randomUUID()}@example.com`;
      const result = await login({ email, password: WRONG_PASSWORD });

      expect(reasonOf(result)).toBe("bad_credentials");
      const rows = await tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "auth.login_failed"),
            eq(auditEvents.organizationId, organizationId),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].organizationId).toBe(organizationId);
      expect(rows[0].branchId).toBe(branchId);
      expect(rows[0].terminalId).toBe(terminal.terminalId);
      expect(rows[0].actorUserId).toBeNull();
      expect((rows[0].payload as { reason?: string }).reason).toBe("unknown_email");
    });
  });

  it("login without the pos_terminal cookie is refused and writes no audit row", async () => {
    await withCommittedFixtures(async (tx) => {
      harness.cookieToken = undefined;
      const organizationId = await insertOrganization(tx);

      const result = await loginAction(
        { error: null },
        formFor(`nobody-${randomUUID()}@example.com`, TEST_PASSWORD),
      );

      expect(result).toEqual({ error: UNREGISTERED_TERMINAL_MESSAGE });
      const rows = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, organizationId));
      expect(rows).toHaveLength(0);
    });
  });

  it("wrong password writes one bad_password audit row without credentials", async () => {
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const user = await insertUser(tx, organizationId, true);

      const result = await login({ email: user.email, password: WRONG_PASSWORD });

      expect(reasonOf(result)).toBe("bad_credentials");
      const rows = await auditRows(tx, "auth.login_failed", user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ reason: "bad_password" });

      const payload = JSON.stringify(rows[0].payload);
      expect(payload).not.toContain(user.email);
      expect(payload).not.toContain(TEST_PASSWORD);
      expect(payload).not.toContain(WRONG_PASSWORD);
    });
  });

  it("inactive user writes one inactive audit row", async () => {
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const user = await insertUser(tx, organizationId, false);

      const result = await login({ email: user.email, password: TEST_PASSWORD });

      expect(reasonOf(result)).toBe("bad_credentials");
      const rows = await auditRows(tx, "auth.login_failed", user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ reason: "inactive" });
    });
  });

  it("correct password for active user writes one login_succeeded audit row", async () => {
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const user = await insertUser(tx, organizationId, true);

      const result = await login({ email: user.email, password: TEST_PASSWORD });

      expect(result.ok, `reason=${reasonOf(result) ?? "none"} stage=${harness.lastErrorStage}`).toBe(true);
      if (result.ok) {
        expect(result.user.id).toBe(user.id);
        expect(result.user.email).toBe(user.email);
      }
      const rows = await auditRows(tx, "auth.login_succeeded", user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({});
    });
  });

  it("failed login_succeeded audit insert returns ok:false and commits no login row", async () => {
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const user = await insertUser(tx, organizationId, true);

      harness.insertFailure = "succeeded";
      let result: Awaited<ReturnType<Login>>;
      try {
        result = await login({ email: user.email, password: TEST_PASSWORD });
      } finally {
        harness.insertFailure = undefined;
      }

      expect(reasonOf(result)).toBe("unavailable");
      const rows = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorUserId, user.id));
      expect(rows).toHaveLength(0);
    });
  });

  it("failed login_failed audit insert still returns ok:false and creates no session", async () => {
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const user = await insertUser(tx, organizationId, true);

      harness.insertFailure = "failed";
      let result: Awaited<ReturnType<Login>>;
      try {
        result = await login({ email: user.email, password: WRONG_PASSWORD });
      } finally {
        harness.insertFailure = undefined;
      }

      expect(reasonOf(result)).toBe("unavailable");
      expect("user" in result).toBe(false);
      const rows = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorUserId, user.id));
      expect(rows).toHaveLength(0);
    });
  });

  it("reports unknown-email and wrong-password timings without failing on them", async () => {
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const user = await insertUser(tx, organizationId, true);
      const unknownEmail = `nobody-${randomUUID()}@example.com`;

      const unknownStart = performance.now();
      await login({ email: unknownEmail, password: WRONG_PASSWORD });
      const unknownMs = performance.now() - unknownStart;

      const wrongStart = performance.now();
      await login({ email: user.email, password: WRONG_PASSWORD });
      const wrongMs = performance.now() - wrongStart;

      console.log(
        `timing report: unknown=${unknownMs.toFixed(1)}ms wrong=${wrongMs.toFixed(1)}ms`,
      );
      expect(Number.isFinite(unknownMs)).toBe(true);
      expect(Number.isFinite(wrongMs)).toBe(true);
    });
  });

  it("shows exactly one error message for every failure path", async () => {
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const active = await insertUser(tx, organizationId, true);
      const inactive = await insertUser(tx, organizationId, false);

      const cases = [
        formFor(`nobody-${randomUUID()}@example.com`, WRONG_PASSWORD),
        formFor(active.email, WRONG_PASSWORD),
        formFor(inactive.email, TEST_PASSWORD),
      ];

      for (const formData of cases) {
        const result = await loginAction({ error: null }, formData);
        expect(result.error).toBe(ERROR_MESSAGE);
      }

      harness.insertFailure = "succeeded";
      try {
        const result = await loginAction(
          { error: null },
          formFor(active.email, TEST_PASSWORD),
        );
        expect(result.error).toBe(ERROR_MESSAGE);
      } finally {
        harness.insertFailure = undefined;
      }
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
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const user = await insertUser(tx, organizationId, true);

      const result = await login({ email: user.email, password: WRONG_PASSWORD });

      expect(reasonOf(result)).toBe("bad_credentials");
      const rows = await auditRows(tx, "auth.login_failed", user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ reason: "bad_password" });
    });
  });

  it("re-review: inactive user with correct password records inactive", async () => {
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const user = await insertUser(tx, organizationId, false);

      const result = await login({ email: user.email, password: TEST_PASSWORD });

      expect(reasonOf(result)).toBe("bad_credentials");
      const rows = await auditRows(tx, "auth.login_failed", user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ reason: "inactive" });
    });
  });

  it("re-review: inactive user with wrong password records inactive_and_bad_password", async () => {
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const user = await insertUser(tx, organizationId, false);

      const result = await login({ email: user.email, password: WRONG_PASSWORD });

      expect(reasonOf(result)).toBe("bad_credentials");
      const rows = await auditRows(tx, "auth.login_failed", user.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ reason: "inactive_and_bad_password" });
    });
  });

  it("re-review: database error keeps SQLSTATE through cause chain and logs only the code", async () => {
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const inner = Object.assign(new Error("db connection failed"), { code: "28P01" });
      const wrapped = new Error("query wrapper", { cause: inner });
      harness.selectCalls = 0;
      harness.selectError = wrapped;
      harness.selectErrorOnCall = 2;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        const result = await login({
          email: `nobody-${randomUUID()}@example.com`,
          password: WRONG_PASSWORD,
        });

        expect(reasonOf(result)).toBe("unavailable");
        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith("28P01");
        for (const call of errorSpy.mock.calls) {
          expect(call).toEqual(["28P01"]);
        }
      } finally {
        harness.selectError = undefined;
        harness.selectErrorOnCall = undefined;
        errorSpy.mockRestore();
      }
    });
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
    await withCommittedFixtures(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const token = generateTerminalToken();
      harness.cookieToken = token;
      await insertTerminal(tx, organizationId, await insertBranch(tx, organizationId), token);
      const activeWrong = await insertUser(tx, organizationId, true);
      const inactiveCorrect = await insertUser(tx, organizationId, false);
      const inactiveWrong = await insertUser(tx, organizationId, false);

      await login({ email: activeWrong.email, password: WRONG_PASSWORD });
      await login({ email: inactiveCorrect.email, password: TEST_PASSWORD });
      await login({ email: inactiveWrong.email, password: WRONG_PASSWORD });

      const cases = [
        { user: activeWrong, reason: "bad_password" },
        { user: inactiveCorrect, reason: "inactive" },
        { user: inactiveWrong, reason: "inactive_and_bad_password" },
      ];
      const serialized: string[] = [];

      for (const testCase of cases) {
        const rows = await auditRows(tx, "auth.login_failed", testCase.user.id);
        expect(rows).toHaveLength(1);
        expect(rows[0].payload).toEqual({ reason: testCase.reason });
        serialized.push(JSON.stringify(rows[0].payload));
      }

      const combined = serialized.join(" ");
      for (const testCase of cases) {
        expect(combined).not.toContain(testCase.user.email);
        const hash = await storedPasswordHash(tx, testCase.user.id);
        if (hash) expect(combined).not.toContain(hash);
      }
      expect(combined).not.toContain(TEST_PASSWORD);
      expect(combined).not.toContain(WRONG_PASSWORD);
      expect(combined).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      expect(combined).not.toMatch(/\b(?:[0-9a-fA-F]{1,4}:){2,}[0-9a-fA-F]{1,4}\b/);
      expect(combined).not.toMatch(/\$argon2/);
    });
  });
});
