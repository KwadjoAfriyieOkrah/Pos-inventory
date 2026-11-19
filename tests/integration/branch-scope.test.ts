import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { eq } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import {
  afterAll,
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
  rolePermissions,
  roles,
  terminals,
  userBranchAssignments,
  users,
} from "../../db/schema";
import {
  FORBIDDEN_MESSAGE,
  ForbiddenError,
} from "../../src/server/data/errors";
import { PERMISSIONS } from "../../src/server/data/permissions";

loadDotenv({ path: ".env.local", quiet: true });

type DbClient = typeof import("../../src/server/db/client")["db"];
type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type LoadScope = typeof import("../../src/server/auth/scope")["loadScope"];
type RequireBranch = typeof import("../../src/server/data/scope")["requireBranch"];
type ListAuditEvents = typeof import("../../src/server/data/audit")["listAuditEvents"];
type ListTerminals = typeof import("../../src/server/data/terminals")["listTerminals"];
type DataScope = import("../../src/server/data/scope").DataScope;

const ROLLBACK = Symbol("rollback");
const harness = vi.hoisted(() => ({
  activeDb: undefined as unknown,
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

let db: DbClient;
let pool: typeof import("../../src/server/db/client")["pool"];
let loadScope: LoadScope;
let requireBranch: RequireBranch;
let listAuditEvents: ListAuditEvents;
let listTerminals: ListTerminals;

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
  ({ loadScope } = await import("../../src/server/auth/scope"));
  ({ requireBranch } = await import("../../src/server/data/scope"));
  ({ listAuditEvents } = await import("../../src/server/data/audit"));
  ({ listTerminals } = await import("../../src/server/data/terminals"));
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

async function captureError(run: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

function expectForbidden(error: unknown): ForbiddenError {
  expect(error).toBeInstanceOf(ForbiddenError);
  const forbidden = error as ForbiddenError;
  expect(forbidden.name).toBe("ForbiddenError");
  expect(forbidden.message).toBe(FORBIDDEN_MESSAGE);
  return forbidden;
}

async function insertOrganization(tx: Tx): Promise<string> {
  const [row] = await tx
    .insert(organizations)
    .values({ name: `scope-org-${randomUUID()}` })
    .returning();
  return row.id;
}

async function insertBranch(tx: Tx, organizationId: string): Promise<string> {
  const [row] = await tx
    .insert(branches)
    .values({
      organizationId,
      name: `scope-branch-${randomUUID()}`,
      digitalAddress: `addr-${randomUUID()}`,
      licenceNumber: randomUUID(),
      licenceExpiresOn: "2030-12-31",
    })
    .returning();
  return row.id;
}

async function insertRole(tx: Tx, organizationId: string): Promise<string> {
  const [row] = await tx
    .insert(roles)
    .values({
      organizationId,
      code: `scope-role-${randomUUID()}`,
      name: "Scope test role",
    })
    .returning();
  return row.id;
}

async function insertRolePermission(tx: Tx, roleId: string, permission: string) {
  await tx.insert(rolePermissions).values({ roleId, permission });
}

async function insertUser(tx: Tx, organizationId: string): Promise<string> {
  const [row] = await tx
    .insert(users)
    .values({
      organizationId,
      email: `scope-${randomUUID()}@example.com`,
      fullName: "Scope test user",
    })
    .returning();
  return row.id;
}

async function insertAssignment(
  tx: Tx,
  organizationId: string,
  userId: string,
  branchId: string,
  roleId: string,
) {
  await tx.insert(userBranchAssignments).values({
    organizationId,
    userId,
    branchId,
    roleId,
  });
}

async function insertAuditEvent(
  tx: Tx,
  organizationId: string,
  branchId: string,
): Promise<string> {
  const [row] = await tx
    .insert(auditEvents)
    .values({
      organizationId,
      branchId,
      action: "scope.test",
      entityType: "test",
      payload: {},
    })
    .returning();
  return row.id;
}

interface Fixture {
  orgA: string;
  orgB: string;
  a1: string;
  a2: string;
  b1: string;
  cashierId: string;
  ownerId: string;
  noAssignmentId: string;
  orgBUserId: string;
  cashierRoleId: string;
  ownerRoleId: string;
}

async function buildFixture(tx: Tx): Promise<Fixture> {
  const orgA = await insertOrganization(tx);
  const orgB = await insertOrganization(tx);
  const a1 = await insertBranch(tx, orgA);
  const a2 = await insertBranch(tx, orgA);
  const b1 = await insertBranch(tx, orgB);

  const cashierRoleId = await insertRole(tx, orgA);
  await insertRolePermission(tx, cashierRoleId, "sale.create");
  const ownerRoleId = await insertRole(tx, orgA);
  await insertRolePermission(tx, ownerRoleId, "audit.view");
  await insertRolePermission(tx, ownerRoleId, "user.manage");
  const orgBRoleId = await insertRole(tx, orgB);
  await insertRolePermission(tx, orgBRoleId, "sale.create");

  const cashierId = await insertUser(tx, orgA);
  const ownerId = await insertUser(tx, orgA);
  const noAssignmentId = await insertUser(tx, orgA);
  const orgBUserId = await insertUser(tx, orgB);

  await insertAssignment(tx, orgA, cashierId, a1, cashierRoleId);
  await insertAssignment(tx, orgA, ownerId, a1, ownerRoleId);
  await insertAssignment(tx, orgA, ownerId, a2, ownerRoleId);
  await insertAssignment(tx, orgB, orgBUserId, b1, orgBRoleId);

  return {
    orgA,
    orgB,
    a1,
    a2,
    b1,
    cashierId,
    ownerId,
    noAssignmentId,
    orgBUserId,
    cashierRoleId,
    ownerRoleId,
  };
}

function runEslint(relativePath: string) {
  const command = process.platform === "win32" ? "cmd.exe" : "sh";
  const args =
    process.platform === "win32"
      ? ["/c", "npx", "eslint", relativePath]
      : ["-c", `npx eslint "${relativePath}"`];
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

describe("branch scope", () => {
  it("cashier scope contains only A1 and only the cashier role's permissions", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      const scope = await loadScope(f.cashierId, f.orgA);
      const expectedRows = await tx
        .select({ permission: rolePermissions.permission })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, f.cashierRoleId));

      expect(scope.userId).toBe(f.cashierId);
      expect(scope.organizationId).toBe(f.orgA);
      expect([...scope.branches.keys()]).toEqual([f.a1]);
      expect(scope.branches.has(f.a2)).toBe(false);
      expect(scope.branches.has(f.b1)).toBe(false);
      expect(scope.branches.get(f.a1)).toEqual(
        new Set(expectedRows.map((row) => row.permission)),
      );
      expect(scope.branches.get(f.a1)?.has("audit.view")).toBe(false);
      expect(scope.branches.get(f.a1)?.has("user.manage")).toBe(false);
    });
  });

  it("owner scope contains A1 and A2", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      const scope = await loadScope(f.ownerId, f.orgA);

      expect([...scope.branches.keys()].sort()).toEqual([f.a1, f.a2].sort());
      expect(scope.branches.has(f.b1)).toBe(false);
      expect(scope.branches.get(f.a1)?.has("audit.view")).toBe(true);
      expect(scope.branches.get(f.a2)?.has("user.manage")).toBe(true);
    });
  });

  it("user with no assignments gets an empty scope without throwing", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      const scope = await loadScope(f.noAssignmentId, f.orgA);

      expect(scope.userId).toBe(f.noAssignmentId);
      expect(scope.organizationId).toBe(f.orgA);
      expect(scope.branches.size).toBe(0);
      expect(scope.branches).toEqual(new Map());
    });
  });

  it("requireBranch rejects A2 for the cashier with ForbiddenError", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      const scope = await loadScope(f.cashierId, f.orgA);

      expectForbidden(
        await captureError(() =>
          requireBranch(scope, f.a2, PERMISSIONS.auditView),
        ),
      );
    });
  });

  it("requireBranch rejects B1 for the owner with ForbiddenError", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      const scope = await loadScope(f.ownerId, f.orgA);

      expectForbidden(
        await captureError(() =>
          requireBranch(scope, f.b1, PERMISSIONS.auditView),
        ),
      );
    });
  });

  it("listAuditEvents rejects A2 for the cashier even when A2 audit rows exist", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      await insertAuditEvent(tx, f.orgA, f.a2);
      const scope = await loadScope(f.cashierId, f.orgA);

      expectForbidden(
        await captureError(async () => {
          const access = await requireBranch(
            scope,
            f.a2,
            PERMISSIONS.auditView,
          );
          await listAuditEvents(scope, access, { limit: 10 });
        }),
      );
    });
  });

  it("listAuditEvents for the owner on A1 returns only A1 rows", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      const a1AuditId = await insertAuditEvent(tx, f.orgA, f.a1);
      const a2AuditId = await insertAuditEvent(tx, f.orgA, f.a2);
      const scope = await loadScope(f.ownerId, f.orgA);
      const access = await requireBranch(
        scope,
        f.a1,
        PERMISSIONS.auditView,
      );

      const rows = await listAuditEvents(scope, access, { limit: 200 });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.branchId === f.a1)).toBe(true);
      expect(rows.map((row) => row.id)).toContain(a1AuditId);
      expect(rows.map((row) => row.id)).not.toContain(a2AuditId);
    });
  });

  it("listAuditEvents excludes organization B rows through its organization_id filter", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      await insertAuditEvent(tx, f.orgB, f.b1);
      const stored = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.branchId, f.b1));
      expect(stored).toHaveLength(1);
      expect(stored[0].organizationId).toBe(f.orgB);

      const crossOrgScope: DataScope = {
        userId: f.ownerId,
        organizationId: f.orgA,
        branches: new Map([[f.b1, new Set([PERMISSIONS.auditView])]]),
      };
      const access = await requireBranch(
        crossOrgScope,
        f.b1,
        PERMISSIONS.auditView,
      );
      const rows = await listAuditEvents(crossOrgScope, access, {
        limit: 200,
      });
      expect(rows).toEqual([]);

      const source = readFileSync(
        join(process.cwd(), "src", "server", "data", "audit.ts"),
        "utf8",
      );
      expect(source).toContain(
        "eq(auditEvents.organizationId, access.organizationId)",
      );
      expect(source).toContain("eq(auditEvents.branchId, access.branchId)");
    });
  });

  it("listAuditEvents caps a 500 limit at 200 rows", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      await tx.insert(auditEvents).values(
        Array.from({ length: 205 }, () => ({
          organizationId: f.orgA,
          branchId: f.a1,
          action: "scope.limit",
          entityType: "test",
          payload: {},
        })),
      );
      const scope = await loadScope(f.ownerId, f.orgA);
      const access = await requireBranch(
        scope,
        f.a1,
        PERMISSIONS.auditView,
      );

      const rows = await listAuditEvents(scope, access, { limit: 500 });
      expect(rows.length).toBeLessThanOrEqual(200);
      expect(rows).toHaveLength(200);
    });
  });

  it("listTerminals never returns a token_hash field", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
      await tx.insert(terminals).values({
        organizationId: f.orgA,
        branchId: f.a1,
        name: `scope-terminal-${randomUUID()}`,
        tokenHash,
      });
      const scope = await loadScope(f.ownerId, f.orgA);
      const access = await requireBranch(
        scope,
        f.a1,
        PERMISSIONS.userManage,
      );

      const rows = await listTerminals(scope, access);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).not.toHaveProperty("tokenHash");
        expect(row).not.toHaveProperty("token_hash");
        expect(JSON.stringify(row)).not.toContain(tokenHash);
      }
      expect(Object.keys(rows[0]).sort()).toEqual(
        ["branchId", "id", "name", "registeredAt", "revokedAt"].sort(),
      );
    });
  });

  it("ForbiddenError messages contain no branch, user, or organization id", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      await insertAuditEvent(tx, f.orgA, f.a2);
      const cashierScope = await loadScope(f.cashierId, f.orgA);
      const ownerScope = await loadScope(f.ownerId, f.orgA);

      const errors = [
        await captureError(() =>
          requireBranch(cashierScope, f.a2, PERMISSIONS.auditView),
        ),
        await captureError(() =>
          requireBranch(ownerScope, f.b1, PERMISSIONS.auditView),
        ),
        await captureError(async () => {
          const access = await requireBranch(
            cashierScope,
            f.a2,
            PERMISSIONS.auditView,
          );
          await listAuditEvents(cashierScope, access, { limit: 10 });
        }),
        await captureError(async () => {
          const access = await requireBranch(
            cashierScope,
            f.a2,
            PERMISSIONS.userManage,
          );
          await listTerminals(cashierScope, access);
        }),
      ];
      const ids = [f.a1, f.a2, f.b1, f.cashierId, f.ownerId, f.orgA, f.orgB];

      for (const error of errors) {
        const forbidden = expectForbidden(error);
        expect(forbidden.message).toBe("Access denied");
        for (const id of ids) {
          expect(forbidden.message).not.toContain(id);
          expect(forbidden.name).not.toContain(id);
        }
      }
    });
  });

  it("ESLint reports no-restricted-imports for a src/features-style database import probe", async () => {
    const directory = join(process.cwd(), "tests", "fixtures");
    const file = join(directory, "restricted-import-probe.ts");
    const relativePath = relative(process.cwd(), file).replace(/\\/g, "/");
    const directoryExisted = existsSync(directory);

    try {
      if (!directoryExisted) mkdirSync(directory, { recursive: true });
      writeFileSync(
        file,
        'import { db } from "@/server/db/client";\n\nexport const featureProbe = db;\n',
      );

      const result = runEslint(relativePath);
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      expect(output, `eslint output: ${output}`).toContain("no-restricted-imports");
      expect(output).toContain(
        "Import the database client only from src/server/data/ or src/server/auth/",
      );
      expect(result.status).toBe(1);
    } finally {
      if (existsSync(file)) rmSync(file, { force: true });
      if (!directoryExisted && existsSync(directory)) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
    // ESLint subprocess timeout can exceed the 5s default under CPU load.
  }, 60000);

  it("ESLint still allows src/server/auth/login.ts to import the database client", () => {
    const result = runEslint("src/server/auth/login.ts");
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    expect(result.status).toBe(0);
    expect(output).not.toContain("no-restricted-imports");
    // ESLint subprocess timeout can exceed the 5s default under CPU load.
  }, 60000);

  it("inactive user gets an empty scope", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      await tx
        .update(users)
        .set({ isActive: false })
        .where(eq(users.id, f.cashierId));

      const scope = await loadScope(f.cashierId, f.orgA);
      expect(scope.branches).toEqual(new Map());
    });
  });

  it("listTerminals caps a 500 limit at 200 rows", async () => {
    await withRollback(async (tx) => {
      const f = await buildFixture(tx);
      await tx.insert(terminals).values(
        Array.from({ length: 205 }, (_, index) => ({
          organizationId: f.orgA,
          branchId: f.a1,
          name: `scope-terminal-${index}`,
          tokenHash: createHash("sha256").update(`${randomUUID()}-${index}`).digest("hex"),
        })),
      );
      const scope = await loadScope(f.ownerId, f.orgA);
      const access = await requireBranch(
        scope,
        f.a1,
        PERMISSIONS.userManage,
      );

      const rows = await listTerminals(scope, access, { limit: 500 });
      expect(rows.length).toBeLessThanOrEqual(200);
      expect(rows).toHaveLength(200);
    });
  });

  it("registration action has no database client import and auth/register does", () => {
    const actionSource = readFileSync(
      join(process.cwd(), "src", "app", "(auth)", "register", "actions.ts"),
      "utf8",
    );
    const registerSource = readFileSync(
      join(process.cwd(), "src", "server", "auth", "register.ts"),
      "utf8",
    );

    expect(actionSource).not.toMatch(/from\s+["']@\/server\/db\/client["']/);
    expect(registerSource).toMatch(/from\s+["']@\/server\/db\/client["']/);
  });

  it("ESLint rejects a temporary src/app database client import and the file is deleted", async () => {
    const file = join(process.cwd(), "src", "app", "temp-scope-check.tsx");
    const relativePath = relative(process.cwd(), file).replace(/\\/g, "/");
    expect(existsSync(file), "temporary path already exists").toBe(false);

    try {
      writeFileSync(
        file,
        'import { db } from "@/server/db/client";\n\nexport const scopeProbe = db;\n',
      );
      const result = runEslint(relativePath);
      const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

      expect(output, `eslint output: ${output}`).toContain("no-restricted-imports");
      expect(result.status).toBe(1);
    } finally {
      if (existsSync(file)) rmSync(file, { force: true });
    }

    expect(existsSync(file)).toBe(false);
    // ESLint subprocess timeout can exceed the 5s default under CPU load.
  }, 60000);

  it("ESLint reports no restricted-import error on src/server/data/scope.ts", () => {
    const result = runEslint("src/server/data/scope.ts");
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    expect(result.status).toBe(0);
    expect(output).not.toContain("no-restricted-imports");
    // ESLint subprocess timeout can exceed the 5s default under CPU load.
  }, 60000);

  it("ADR 0006 contains four Rejected: and four Chosen: phrases", () => {
    const source = readFileSync(
      join(process.cwd(), "docs", "adr", "0006-branch-scope.md"),
      "utf8",
    );
    const count = (phrase: string) => source.split(phrase).length - 1;

    expect(count("Rejected:"), "docs/adr/0006-branch-scope.md Rejected: count").toBe(4);
    expect(count("Chosen:"), "docs/adr/0006-branch-scope.md Chosen: count").toBe(4);
  });
});
