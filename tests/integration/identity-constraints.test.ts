import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { eq } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";
import {
  auditEvents,
  branches,
  organizations,
  rolePermissions,
  roles,
  userBranchAssignments,
  users,
} from "../../db/schema";
import { branchCodeFromName } from "../../src/lib/sale-number";

loadDotenv({ path: ".env.local", quiet: true });

type DbClient = typeof import("../../src/server/db/client")["db"];
type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

let db: DbClient;
let pool: typeof import("../../src/server/db/client")["pool"];

const ROLLBACK = Symbol("rollback");

let branchCodeSequence = 0;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", async () => {
  const real = await import("../../src/lib/env");
  return { env: real.env };
});

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
});

afterAll(async () => {
  if (pool) await pool.end();
});

async function withRollback(run: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await run(tx);
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
  throw new Error("expected the insert to be rejected");
}

async function insertOrganization(tx: Tx): Promise<string> {
  const [row] = await tx
    .insert(organizations)
    .values({ name: `org-${randomUUID()}` })
    .returning();
  return row.id;
}

async function insertUser(
  tx: Tx,
  organizationId: string,
  email = `user-${randomUUID()}@example.com`,
): Promise<string> {
  const [row] = await tx
    .insert(users)
    .values({ organizationId, email, fullName: "Test User" })
    .returning();
  return row.id;
}

async function insertRole(tx: Tx, organizationId: string): Promise<string> {
  const [row] = await tx
    .insert(roles)
    .values({
      organizationId,
      code: `role-${randomUUID()}`,
      name: "Test Role",
    })
    .returning();
  return row.id;
}

async function insertBranch(tx: Tx, organizationId: string, licenceNumber = randomUUID()) {
  const name = `branch-${randomUUID()}-${String.fromCharCode(65 + (branchCodeSequence++ % 26))}`;
  const [row] = await tx
    .insert(branches)
    .values({
      organizationId,
      name,
      branchCode: branchCodeFromName(name),
      digitalAddress: `addr-${randomUUID()}`,
      licenceNumber,
      licenceExpiresOn: "2030-12-31",
    })
    .returning();
  return row;
}

function migrationSnapshot(): { count: number; digest: string } {
  const root = join(process.cwd(), "db", "migrations");
  const paths: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else paths.push(relative(root, full).replace(/\\/g, "/"));
    }
  };
  walk(root);
  paths.sort();

  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(join(root, path)));
  }
  return { count: paths.length, digest: hash.digest("hex") };
}

function runMigrate() {
  return spawnSync("npm run db:migrate", {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    shell: true,
  });
}

function sanitize(value: string): string {
  return value.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted url]");
}

describe("identity constraints", () => {
  it("rejects a role from another organization with 23503", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const orgB = await insertOrganization(tx);
      const userId = await insertUser(tx, orgA);
      const branch = await insertBranch(tx, orgA);
      const roleB = await insertRole(tx, orgB);

      const error = await captureError(
        tx.insert(userBranchAssignments).values({
          userId,
          branchId: branch.id,
          roleId: roleB,
          organizationId: orgA,
        }),
      );
      expect(sqlState(error)).toBe("23503");
    });
  });

  it("rejects a branch from another organization with 23503", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const orgB = await insertOrganization(tx);
      const userId = await insertUser(tx, orgA);
      const roleA = await insertRole(tx, orgA);
      const branchB = await insertBranch(tx, orgB);

      const error = await captureError(
        tx.insert(userBranchAssignments).values({
          userId,
          branchId: branchB.id,
          roleId: roleA,
          organizationId: orgA,
        }),
      );
      expect(sqlState(error)).toBe("23503");
    });
  });

  it("rejects a user from another organization with 23503", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const orgB = await insertOrganization(tx);
      const userB = await insertUser(tx, orgB);
      const branchA = await insertBranch(tx, orgA);
      const roleA = await insertRole(tx, orgA);

      const error = await captureError(
        tx.insert(userBranchAssignments).values({
          userId: userB,
          branchId: branchA.id,
          roleId: roleA,
          organizationId: orgA,
        }),
      );
      expect(sqlState(error)).toBe("23503");
    });
  });

  it("rejects a licence number reused across organizations with 23505", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const orgB = await insertOrganization(tx);
      const licenceNumber = randomUUID();
      await insertBranch(tx, orgA, licenceNumber);

      const error = await captureError(insertBranch(tx, orgB, licenceNumber));
      expect(sqlState(error)).toBe("23505");
    });
  });

  it("rejects a duplicate email in one organization with 23505", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const email = `duplicate-${randomUUID()}@example.com`;
      await insertUser(tx, orgA, email);

      const error = await captureError(insertUser(tx, orgA, email));
      expect(sqlState(error)).toBe("23505");
    });
  });

  it("allows the same email in two different organizations", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const orgB = await insertOrganization(tx);
      const email = `shared-${randomUUID()}@example.com`;

      await expect(insertUser(tx, orgA, email)).resolves.toBeDefined();
      await expect(insertUser(tx, orgB, email)).resolves.toBeDefined();
    });
  });

  it("rejects an email with uppercase letters with 23514", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);

      const error = await captureError(
        tx.insert(users).values({
          organizationId: orgA,
          email: `UPPER-${randomUUID()}@example.com`,
          fullName: "Uppercase Email",
        }),
      );
      expect(sqlState(error)).toBe("23514");
    });
  });

  it("rejects an unlisted permission with 23514", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const roleA = await insertRole(tx, orgA);

      const error = await captureError(
        tx.insert(rolePermissions).values({ roleId: roleA, permission: "sale.delete" }),
      );
      expect(sqlState(error)).toBe("23514");
    });
  });

  it("accepts the listed permission sale.create", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const roleA = await insertRole(tx, orgA);

      await expect(
        tx.insert(rolePermissions).values({ roleId: roleA, permission: "sale.create" }),
      ).resolves.toBeDefined();
    });
  });

  it("accepts an audit event with null branch and actor", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);

      await expect(
        tx.insert(auditEvents).values({
          organizationId: orgA,
          branchId: null,
          actorUserId: null,
          action: "organization.settings_updated",
          entityType: "organization",
          entityId: orgA,
        }),
      ).resolves.toBeDefined();
    });
  });

  it("stores and reads licence_expires_on as a date with no time", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const branch = await insertBranch(tx, orgA);

      const [stored] = await tx
        .select({ licenceExpiresOn: branches.licenceExpiresOn })
        .from(branches)
        .where(eq(branches.id, branch.id));

      expect(stored.licenceExpiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(stored.licenceExpiresOn).not.toMatch(/[T ]/);
    });
  });
});

describe("migration files", () => {
  it("does not change the migration file list or hash across two db:migrate runs", () => {
    const before = migrationSnapshot();
    const first = runMigrate();
    const afterFirst = migrationSnapshot();
    const second = runMigrate();
    const afterSecond = migrationSnapshot();

    expect(
      first.status,
      `first run status=${first.status} output=${sanitize((first.stdout ?? "") + (first.stderr ?? ""))}`,
    ).toBe(0);
    expect(
      second.status,
      `second run status=${second.status} output=${sanitize((second.stdout ?? "") + (second.stderr ?? ""))}`,
    ).toBe(0);
    expect(afterFirst).toEqual(before);
    expect(afterSecond).toEqual(before);
  }, 30000);
});
