import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { eq, sql } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { auditEvents, branches, organizations, users } from "../../db/schema";

loadDotenv({ path: ".env.local", quiet: true });

type DbClient = typeof import("../../src/server/db/client")["db"];
type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

let db: DbClient;
let pool: typeof import("../../src/server/db/client")["pool"];

const ROLLBACK = Symbol("rollback");

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

function errorMessages(error: unknown): string[] {
  if (error === null || error === undefined) return [];
  if (error instanceof Error) {
    return [error.message, ...errorMessages((error as Error & { cause?: unknown }).cause)];
  }
  if (typeof error === "object") {
    const candidate = error as { message?: unknown; cause?: unknown };
    return [
      ...(typeof candidate.message === "string" ? [candidate.message] : []),
      ...errorMessages(candidate.cause),
    ];
  }
  return [String(error)];
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
    .values({ name: `org-${randomUUID()}` })
    .returning();
  return row.id;
}

async function insertUser(tx: Tx, organizationId: string): Promise<string> {
  const [row] = await tx
    .insert(users)
    .values({
      organizationId,
      email: `user-${randomUUID()}@example.com`,
      fullName: "Test User",
    })
    .returning();
  return row.id;
}

async function insertBranch(tx: Tx, organizationId: string) {
  const [row] = await tx
    .insert(branches)
    .values({
      organizationId,
      name: `branch-${randomUUID()}`,
      digitalAddress: `addr-${randomUUID()}`,
      licenceNumber: randomUUID(),
      licenceExpiresOn: "2030-12-31",
    })
    .returning();
  return row;
}

async function insertAuditEvent(
  tx: Tx,
  organizationId: string,
  branchId: string | null,
  actorUserId: string | null,
) {
  const [row] = await tx
    .insert(auditEvents)
    .values({
      organizationId,
      branchId,
      actorUserId,
      action: "test.action",
      entityType: "organization",
      entityId: organizationId,
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

describe("append-only audit log", () => {
  it("inserts a row with a valid organization, branch and actor", async () => {
    await withRollback(async (tx) => {
      const org = await insertOrganization(tx);
      const branch = await insertBranch(tx, org);
      const actor = await insertUser(tx, org);

      const row = await insertAuditEvent(tx, org, branch.id, actor);
      expect(row.id).toBeDefined();
    });
  });

  it("inserts a row with both branch_id and actor_user_id NULL", async () => {
    await withRollback(async (tx) => {
      const org = await insertOrganization(tx);

      const row = await insertAuditEvent(tx, org, null, null);
      expect(row.branchId).toBeNull();
      expect(row.actorUserId).toBeNull();
    });
  });

  it("rejects UPDATE with 42501 and an append-only message", async () => {
    await withRollback(async (tx) => {
      const org = await insertOrganization(tx);
      const row = await insertAuditEvent(tx, org, null, null);

      const error = await captureError(
        tx.update(auditEvents).set({ action: "changed" }).where(eq(auditEvents.id, row.id)),
      );
      expect(sqlState(error)).toBe("42501");
      expect(errorMessages(error).join(" ")).toContain("append-only");
    });
  });

  it("rejects DELETE with 42501", async () => {
    await withRollback(async (tx) => {
      const org = await insertOrganization(tx);
      const row = await insertAuditEvent(tx, org, null, null);

      const error = await captureError(
        tx.delete(auditEvents).where(eq(auditEvents.id, row.id)),
      );
      expect(sqlState(error)).toBe("42501");
    });
  });

  it("rejects TRUNCATE with 42501 inside a rolled-back transaction", async () => {
    await withRollback(async (tx) => {
      const error = await captureError(tx.execute(sql`TRUNCATE TABLE audit_events`));
      expect(sqlState(error)).toBe("42501");
    });
  });

  it("rejects a branch from another organization with 23503", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const orgB = await insertOrganization(tx);
      const branchB = await insertBranch(tx, orgB);

      const error = await captureError(insertAuditEvent(tx, orgA, branchB.id, null));
      expect(sqlState(error)).toBe("23503");
    });
  });

  it("rejects an actor from another organization with 23503", async () => {
    await withRollback(async (tx) => {
      const orgA = await insertOrganization(tx);
      const orgB = await insertOrganization(tx);
      const actorB = await insertUser(tx, orgB);

      const error = await captureError(insertAuditEvent(tx, orgA, null, actorB));
      expect(sqlState(error)).toBe("23503");
    });
  });

  it("reports two user-defined triggers on audit_events", async () => {
    await withRollback(async (tx) => {
      const result = await tx.execute<{ tgname: string }>(sql`
        SELECT tgname
        FROM pg_trigger
        WHERE tgrelid = 'audit_events'::regclass AND tgisinternal = false
        ORDER BY tgname
      `);
      const names = result.rows.map((row) => row.tgname);

      // UPDATE and DELETE share one row trigger; TRUNCATE needs a separate statement-level trigger.
      expect(names).toStrictEqual([
        "audit_events_block_truncate",
        "audit_events_block_update_or_delete",
      ]);
    });
  });

  it("applies nothing new on a second db:migrate run", () => {
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
  });
});
