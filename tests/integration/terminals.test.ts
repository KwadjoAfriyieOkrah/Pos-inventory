import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { eq, sql } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  auditEvents,
  branches,
  organizations,
  terminalRegistrationCodes,
  terminals,
  users,
} from "../../db/schema";

loadDotenv({ path: ".env.local", quiet: true });

type DbClient = typeof import("../../src/server/db/client")["db"];
type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type Login = typeof import("../../src/server/auth/login")["login"];
type ResolveTerminal = typeof import("../../src/server/auth/terminal")["resolveTerminal"];
type GenerateTerminalToken = typeof import("../../src/server/auth/terminal")["generateTerminalToken"];
type HashTerminalToken = typeof import("../../src/server/auth/terminal")["hashTerminalToken"];
type ExchangeCode = typeof import("../../src/app/(auth)/register/actions")["exchangeTerminalRegistrationCode"];
type LoginAction = typeof import("../../src/app/(auth)/login/actions")["loginAction"];

const TEST_PASSWORD = "correct horse battery staple";
const ROLLBACK = Symbol("rollback");
const INVALID_CODE_MESSAGE = "Registration code is not valid.";
const UNREGISTERED_TERMINAL_MESSAGE =
  "This device is not registered. Contact the pharmacy owner.";

const harness = vi.hoisted(() => ({
  activeDb: undefined as unknown,
  cookieToken: undefined as string | undefined,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", async () => {
  const real = await import("../../src/lib/env");
  return { env: real.env };
});

vi.mock("@/server/db/client", () => ({
  get db() {
    const active = harness.activeDb as
      | {
          select: (...args: unknown[]) => unknown;
          insert: (...args: unknown[]) => unknown;
          update: (...args: unknown[]) => unknown;
          transaction: (run: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
        }
      | undefined;

    if (!active) throw new Error("no active test transaction");

    return {
      select: (...args: unknown[]) =>
        (active.select as (...a: unknown[]) => unknown)(...args),
      insert: (...args: unknown[]) =>
        (active.insert as (...a: unknown[]) => unknown)(...args),
      update: (...args: unknown[]) =>
        (active.update as (...a: unknown[]) => unknown)(...args),
      transaction: async (run: (tx: unknown) => Promise<unknown>) => run(active),
    };
  },
  pool: undefined,
}));

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
let hashPassword: (plain: string) => Promise<string>;
let login: Login;
let loginAction: LoginAction;
let resolveTerminal: ResolveTerminal;
let generateTerminalToken: GenerateTerminalToken;
let hashTerminalToken: HashTerminalToken;
let exchangeCode: ExchangeCode;

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
  ({ hashPassword } = await import("../../src/server/auth/password"));
  ({ login } = await import("../../src/server/auth/login"));
  ({ loginAction } = await import("../../src/app/(auth)/login/actions"));
  ({
    resolveTerminal,
    generateTerminalToken,
    hashTerminalToken,
  } = await import("../../src/server/auth/terminal"));
  ({ exchangeTerminalRegistrationCode: exchangeCode } = await import(
    "../../src/app/(auth)/register/actions"
  ));
});

afterEach(() => {
  harness.cookieToken = undefined;
});

afterAll(async () => {
  if (pool) await pool.end();
});

async function withRollback(run: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      harness.activeDb = tx;
      try {
        await run(tx);
      } finally {
        harness.activeDb = undefined;
      }
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  return sqlState(candidate.cause);
}

async function captureError(query: Promise<unknown>): Promise<unknown> {
  try {
    await query;
  } catch (error) {
    return error;
  }
  throw new Error("expected the statement to be rejected");
}

async function insertOrganization(tx: Tx): Promise<string> {
  const [row] = await tx
    .insert(organizations)
    .values({ name: `terminal-org-${randomUUID()}` })
    .returning();
  return row.id;
}

async function insertBranch(tx: Tx, organizationId: string): Promise<string> {
  const [row] = await tx
    .insert(branches)
    .values({
      organizationId,
      name: `terminal-branch-${randomUUID()}`,
      digitalAddress: `addr-${randomUUID()}`,
      licenceNumber: randomUUID(),
      licenceExpiresOn: "2030-12-31",
    })
    .returning();
  return row.id;
}

async function insertUser(
  tx: Tx,
  organizationId: string,
): Promise<{ id: string; email: string }> {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  const [row] = await tx
    .insert(users)
    .values({
      organizationId,
      email: `terminal-user-${randomUUID()}@example.com`,
      fullName: "Terminal Test User",
      passwordHash,
    })
    .returning();
  return { id: row.id, email: row.email };
}

async function insertTerminal(
  tx: Tx,
  organizationId: string,
  branchId: string,
  token: string,
  revoked = false,
): Promise<{ id: string; tokenHash: string }> {
  const tokenHash = hashTerminalToken(token);
  const [row] = await tx
    .insert(terminals)
    .values({
      organizationId,
      branchId,
      name: `terminal-${randomUUID()}`,
      tokenHash,
      revokedAt: revoked ? new Date() : null,
    })
    .returning();
  return { id: row.id, tokenHash };
}

async function insertRegistrationCode(
  tx: Tx,
  organizationId: string,
  branchId: string,
  code: string,
  expiresAt: Date,
): Promise<void> {
  await tx.insert(terminalRegistrationCodes).values({
    organizationId,
    branchId,
    name: `register-${randomUUID()}`,
    codeHash: createHash("sha256").update(code).digest("hex"),
    expiresAt,
  });
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [full] : [];
  });
}

function consoleCalls(
  source: string,
): { method: string; args: string; line: number }[] {
  const results: { method: string; args: string; line: number }[] = [];
  const pattern = /console\.(log|info|warn|error|debug|trace)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
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

    results.push({
      method: match[1],
      args: source.slice(start, Math.max(start, index - 1)),
      line: source.slice(0, match.index).split("\n").length,
    });
    pattern.lastIndex = index;
  }

  return results;
}

describe("terminals", () => {
  it("terminal in organization A cannot reference branch in organization B", async () => {
    await withRollback(async (tx) => {
      const organizationA = await insertOrganization(tx);
      const organizationB = await insertOrganization(tx);
      const branchB = await insertBranch(tx, organizationB);
      const token = generateTerminalToken();

      const error = await captureError(
        tx.insert(terminals).values({
          organizationId: organizationA,
          branchId: branchB,
          name: "cross-org-terminal",
          tokenHash: hashTerminalToken(token),
        }),
      );

      expect(sqlState(error)).toBe("23503");
    });
  });

  it("registration code can be used once and second use returns generic message", async () => {
    await withRollback(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const branchId = await insertBranch(tx, organizationId);
      const code = "ABCDEFGHIJ";
      await insertRegistrationCode(
        tx,
        organizationId,
        branchId,
        code,
        new Date(Date.now() + 60_000),
      );

      const first = await exchangeCode(code);
      expect(first).toEqual({ ok: true });
      expect(harness.cookieToken).toBeTypeOf("string");

      const second = await exchangeCode(code);
      expect(second).toEqual({ ok: false, message: INVALID_CODE_MESSAGE });
    });
  });

  it("expired registration code is rejected with the same generic message", async () => {
    await withRollback(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const branchId = await insertBranch(tx, organizationId);
      const code = "KLMNOPQRST";
      await insertRegistrationCode(
        tx,
        organizationId,
        branchId,
        code,
        new Date(Date.now() - 60_000),
      );

      const result = await exchangeCode(code);
      expect(result).toEqual({ ok: false, message: INVALID_CODE_MESSAGE });
    });
  });

  it("stored terminal token_hash is 64 hex characters and never the raw token", async () => {
    await withRollback(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const branchId = await insertBranch(tx, organizationId);
      const token = generateTerminalToken();
      const stored = await insertTerminal(tx, organizationId, branchId, token);

      const [row] = await tx
        .select({ tokenHash: terminals.tokenHash })
        .from(terminals)
        .where(eq(terminals.id, stored.id));

      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.tokenHash).not.toBe(token);
      expect(row.tokenHash).toBe(stored.tokenHash);
    });
  });

  it("resolveTerminal returns null for revoked, unknown, and missing tokens", async () => {
    await withRollback(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const branchId = await insertBranch(tx, organizationId);
      const activeToken = generateTerminalToken();
      const revokedToken = generateTerminalToken();
      const active = await insertTerminal(tx, organizationId, branchId, activeToken);
      await insertTerminal(tx, organizationId, branchId, revokedToken, true);

      expect(resolveTerminal(undefined)).resolves.toBeNull();
      await expect(resolveTerminal("")).resolves.toBeNull();
      await expect(resolveTerminal("unknown-token-value")).resolves.toBeNull();
      await expect(resolveTerminal(revokedToken)).resolves.toBeNull();
      await expect(resolveTerminal(activeToken)).resolves.toMatchObject({
        id: active.id,
        organizationId,
        branchId,
      });
    });
  });

  it("login without terminal cookie is refused and writes no audit row", async () => {
    await withRollback(async (tx) => {
      harness.cookieToken = undefined;
      const organizationId = await insertOrganization(tx);

      const result = await loginAction(
        { error: null },
        (() => {
          const formData = new FormData();
          formData.set("email", `nobody-${randomUUID()}@example.com`);
          formData.set("password", TEST_PASSWORD);
          return formData;
        })(),
      );

      expect(result).toEqual({ error: UNREGISTERED_TERMINAL_MESSAGE });
      const rows = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, organizationId));
      expect(rows).toHaveLength(0);
    });
  });

  it("unknown email from registered terminal writes one org/branch/terminal-scoped audit row", async () => {
    await withRollback(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const branchId = await insertBranch(tx, organizationId);
      const token = generateTerminalToken();
      const terminal = await insertTerminal(tx, organizationId, branchId, token);
      harness.cookieToken = token;
      const email = `nobody-${randomUUID()}@example.com`;

      const result = await login({ email, password: TEST_PASSWORD });

      expect(result).toEqual({ ok: false });
      const rows = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "auth.login_failed"));
      expect(rows).toHaveLength(1);
      expect(rows[0].organizationId).toBe(organizationId);
      expect(rows[0].branchId).toBe(branchId);
      expect(rows[0].terminalId).toBe(terminal.id);
      expect(rows[0].actorUserId).toBeNull();
      expect((rows[0].payload as { reason?: string }).reason).toBe("unknown_email");
    });
  });

  it("same unknown email from two terminals branches writes two branch-scoped rows", async () => {
    await withRollback(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const branchOne = await insertBranch(tx, organizationId);
      const branchTwo = await insertBranch(tx, organizationId);
      const tokenOne = generateTerminalToken();
      const tokenTwo = generateTerminalToken();
      const terminalOne = await insertTerminal(tx, organizationId, branchOne, tokenOne);
      const terminalTwo = await insertTerminal(tx, organizationId, branchTwo, tokenTwo);
      const email = `nobody-${randomUUID()}@example.com`;

      harness.cookieToken = tokenOne;
      await login({ email, password: TEST_PASSWORD });
      harness.cookieToken = tokenTwo;
      await login({ email, password: TEST_PASSWORD });

      const rows = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "auth.login_failed"));
      expect(rows).toHaveLength(2);

      const byTerminal = new Map(rows.map((row) => [row.terminalId, row]));
      expect(byTerminal.get(terminalOne.id)).toMatchObject({
        organizationId,
        branchId: branchOne,
      });
      expect(byTerminal.get(terminalTwo.id)).toMatchObject({
        organizationId,
        branchId: branchTwo,
      });
    });
  });

  it("known user failed login records terminal_id and actor_user_id together", async () => {
    await withRollback(async (tx) => {
      const organizationId = await insertOrganization(tx);
      const branchId = await insertBranch(tx, organizationId);
      const token = generateTerminalToken();
      const terminal = await insertTerminal(tx, organizationId, branchId, token);
      const user = await insertUser(tx, organizationId);
      harness.cookieToken = token;

      const result = await login({ email: user.email, password: "wrong-password" });

      expect(result).toEqual({ ok: false });
      const rows = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "auth.login_failed"));
      expect(rows).toHaveLength(1);
      expect(rows[0].terminalId).toBe(terminal.id);
      expect(rows[0].actorUserId).toBe(user.id);
      expect(rows[0].branchId).toBe(branchId);
      expect(rows[0].organizationId).toBe(organizationId);
      expect((rows[0].payload as { reason?: string }).reason).toBe("bad_password");
    });
  });

  it("allows exactly one labeled registration console line and no other secret prints", () => {
    const forbidden = /\b(token|code|codes|password|hash|databaseUrl)\b/i;
    const label = '"Registration code (shown once):"';
    const violations: string[] = [];
    const allCalls: {
      path: string;
      line: number;
      method: string;
      args: string;
    }[] = [];
    const files = [
      ...sourceFiles(join(process.cwd(), "src")),
      ...sourceFiles(join(process.cwd(), "scripts")),
    ];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const path = relative(process.cwd(), file).replace(/\\/g, "/");
      for (const call of consoleCalls(source)) {
        allCalls.push({ path, ...call });
      }
    }

    const allowed = allCalls.filter(
      (call) =>
        call.path === "scripts/register-terminal.ts" &&
        call.method === "log" &&
        call.args.startsWith(label),
    );

    expect(allowed, "expected exactly one labeled registration print").toHaveLength(1);
    expect(allowed[0].args).toContain("registrationCode");

    for (const call of allCalls) {
      if (call === allowed[0]) continue;
      if (call.args.includes("Registration code (shown once):")) {
        violations.push(
          `${call.path}:${call.line} duplicate registration label in console.${call.method}`,
        );
        continue;
      }

      const identifiers = call.args.replace(
        /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
        '""',
      );
      if (forbidden.test(identifiers)) {
        violations.push(
          `${call.path}:${call.line} console.${call.method}(${call.args.trim()})`,
        );
      }
    }

    expect(violations, `secret console prints: ${violations.join(" | ")}`).toEqual([]);
  });

  it("Task 1.3 audit triggers are still present after later migrations", async () => {
    await withRollback(async (tx) => {
      const result = await tx.execute<{ tgname: string }>(sql`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = 'audit_events'::regclass AND tgisinternal = false
        ORDER BY tgname
      `);
      const names = result.rows.map((row) => row.tgname);

      expect(names, `triggers found: ${names.join(", ") || "none"}`).toContain(
        "audit_events_block_update_or_delete",
      );
      expect(names).toContain("audit_events_block_truncate");
    });
  });
});
