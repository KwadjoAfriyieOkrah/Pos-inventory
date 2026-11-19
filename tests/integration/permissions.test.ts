import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  auditEvents,
  branches,
  organizations,
  rolePermissions,
  roles,
  userBranchAssignments,
  users,
} from "../../db/schema";
import { DEFAULT_ROLE_PERMISSIONS } from "../../db/seed/default-role-permissions";
import { ForbiddenError } from "../../src/server/data/errors";
import { PERMISSIONS } from "../../src/server/data/permissions";

loadDotenv({ path: ".env.local", quiet: true });

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", async () => {
  const real = await import("../../src/lib/env");
  return { env: real.env };
});
vi.mock("@/server/db/client", async () => await import("../../src/server/db/client"));

type DbClient = typeof import("../../src/server/db/client")["db"];
type Pool = typeof import("../../src/server/db/client")["pool"];
type DataScope = import("../../src/server/data/scope").DataScope;
type LoadScope = typeof import("../../src/server/auth/scope")["loadScope"];
type RequireBranch = typeof import("../../src/server/data/scope")["requireBranch"];

let db: DbClient;
let pool: Pool;
let loadScope: LoadScope;
let requireBranch: RequireBranch;

function checkListValues(): string[] {
  const path = join(process.cwd(), "db", "schema", "role-permissions.ts");
  const source = readFileSync(path, "utf8");
  const match = source.match(/in \(([^)]*)\)/);
  if (!match) throw new Error("could not locate role_permissions permission CHECK list");
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
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
  expect(forbidden.message).toBe("Access denied");
  return forbidden;
}

function requireSaleVoid(
  scope: DataScope,
  branchId: string,
): ReturnType<RequireBranch> {
  return requireBranch(scope, branchId, PERMISSIONS.saleVoid);
}

async function denialRows(branchId: string, actorUserId?: string) {
  const conditions = [
    eq(auditEvents.branchId, branchId),
    eq(auditEvents.action, "access.denied"),
  ];
  if (actorUserId) conditions.push(eq(auditEvents.actorUserId, actorUserId));

  return db
    .select({
      id: auditEvents.id,
      organizationId: auditEvents.organizationId,
      branchId: auditEvents.branchId,
      actorUserId: auditEvents.actorUserId,
      payload: auditEvents.payload,
    })
    .from(auditEvents)
    .where(and(...conditions));
}

async function createRole(
  organizationId: string,
  permissions: readonly string[],
): Promise<string> {
  const [role] = await db
    .insert(roles)
    .values({
      organizationId,
      code: `permissions-role-${randomUUID()}`,
      name: "Permissions test role",
    })
    .returning();

  await db.insert(rolePermissions).values(
    permissions.map((permission) => ({ roleId: role.id, permission })),
  );
  return role.id;
}

async function createUser(organizationId: string, label: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      organizationId,
      email: `permissions-${label}-${randomUUID()}@example.com`,
      fullName: `Permissions ${label}`,
    })
    .returning();
  return user.id;
}

interface Fixture {
  organizationId: string;
  branchId: string;
  cashierId: string;
  pharmacistId: string;
  ownerId: string;
  noAssignmentId: string;
}

async function createFixture(): Promise<Fixture> {
  const [organization] = await db
    .insert(organizations)
    .values({ name: `permissions-org-${randomUUID()}` })
    .returning();
  const [branch] = await db
    .insert(branches)
    .values({
      organizationId: organization.id,
      name: `permissions-branch-${randomUUID()}`,
      digitalAddress: `addr-${randomUUID()}`,
      licenceNumber: randomUUID(),
      licenceExpiresOn: "2030-12-31",
    })
    .returning();

  const cashierRoleId = await createRole(
    organization.id,
    DEFAULT_ROLE_PERMISSIONS.cashier,
  );
  const pharmacistRoleId = await createRole(
    organization.id,
    DEFAULT_ROLE_PERMISSIONS.pharmacist,
  );
  const ownerRoleId = await createRole(
    organization.id,
    DEFAULT_ROLE_PERMISSIONS.owner,
  );

  const cashierId = await createUser(organization.id, "cashier");
  const pharmacistId = await createUser(organization.id, "pharmacist");
  const ownerId = await createUser(organization.id, "owner");
  const noAssignmentId = await createUser(organization.id, "no-assignment");

  await db.insert(userBranchAssignments).values([
    {
      organizationId: organization.id,
      userId: cashierId,
      branchId: branch.id,
      roleId: cashierRoleId,
    },
    {
      organizationId: organization.id,
      userId: pharmacistId,
      branchId: branch.id,
      roleId: pharmacistRoleId,
    },
    {
      organizationId: organization.id,
      userId: ownerId,
      branchId: branch.id,
      roleId: ownerRoleId,
    },
  ]);

  return {
    organizationId: organization.id,
    branchId: branch.id,
    cashierId,
    pharmacistId,
    ownerId,
    noAssignmentId,
  };
}

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
  ({ loadScope } = await import("../../src/server/auth/scope"));
  ({ requireBranch } = await import("../../src/server/data/scope"));
});

afterAll(async () => {
  if (pool) await pool.end();
});

describe("permissions", () => {
  it("PERMISSIONS has exactly 14 entries matching the role_permissions CHECK list", () => {
    const checkValues = checkListValues();
    const permissionValues: string[] = Object.values(PERMISSIONS);
    const missing = checkValues.filter((value) => !permissionValues.includes(value));
    const extra = permissionValues.filter((value) => !checkValues.includes(value));

    expect(
      permissionValues,
      `PERMISSIONS entries: expected 14, received ${permissionValues.length}: ${permissionValues.join(", ")}`,
    ).toHaveLength(14);
    expect(
      checkValues,
      `CHECK list entries: expected 14, received ${checkValues.length}: ${checkValues.join(", ")}`,
    ).toHaveLength(14);
    expect(
      { missing, extra },
      `missing values: ${missing.join(", ") || "none"}; extra values: ${extra.join(", ") || "none"}`,
    ).toEqual({ missing: [], extra: [] });
  });

  it("DEFAULT_ROLE_PERMISSIONS stays inside the CHECK list and has the expected role permissions", () => {
    const allowed = new Set(checkListValues());
    const outside = Object.values(DEFAULT_ROLE_PERMISSIONS)
      .flat()
      .filter((permission) => !allowed.has(permission));

    expect(
      outside,
      `values outside CHECK list: ${outside.join(", ") || "none"}`,
    ).toEqual([]);
    expect(DEFAULT_ROLE_PERMISSIONS.cashier).not.toContain(PERMISSIONS.saleVoid);
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toContain(PERMISSIONS.reportViewAll);
    expect(DEFAULT_ROLE_PERMISSIONS.owner).not.toContain(PERMISSIONS.batchOverride);
    expect(DEFAULT_ROLE_PERMISSIONS.pharmacist).toContain(PERMISSIONS.auditView);
  });

  it("a cashier requiring saleVoid gets Access denied and one committed denial row", async () => {
    const fixture = await createFixture();
    const scope = await loadScope(fixture.cashierId, fixture.organizationId);

    expect(await denialRows(fixture.branchId, fixture.cashierId)).toHaveLength(0);

    expectForbidden(await captureError(() => requireSaleVoid(scope, fixture.branchId)));

    const rows = await denialRows(fixture.branchId, fixture.cashierId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.organizationId).toBe(fixture.organizationId);
    expect(rows[0]?.payload).toMatchObject({ permission: "sale.void" });
  });

  it("a denial written during requireBranch survives caller transaction rollback", async () => {
    const fixture = await createFixture();
    const scope = await loadScope(fixture.cashierId, fixture.organizationId);
    const callerError = new Error("roll back the caller transaction");
    const before = await denialRows(fixture.branchId, fixture.cashierId);

    const caught = await captureError(async () => {
      await db.transaction(async () => {
        expectForbidden(
          await captureError(() => requireSaleVoid(scope, fixture.branchId)),
        );
        throw callerError;
      });
    });

    expect(caught).toBe(callerError);
    const after = await denialRows(fixture.branchId, fixture.cashierId);
    expect(after).toHaveLength(before.length + 1);
  });

  it("a failed audit insert still denies access", async () => {
    const fixture = await createFixture();
    const scope = await loadScope(fixture.cashierId, fixture.organizationId);
    const suffix = randomUUID().replace(/-/g, "");
    const functionName = `perm_fail_fn_${suffix}`;
    const triggerName = `perm_fail_trg_${suffix}`;

    try {
      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          IF NEW.actor_user_id = '${fixture.cashierId}'::uuid AND NEW.branch_id = '${fixture.branchId}'::uuid THEN
            RAISE EXCEPTION 'audit insert blocked by permissions test';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await pool.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `);

      expectForbidden(await captureError(() => requireSaleVoid(scope, fixture.branchId)));
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_events`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }

    const result = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM pg_trigger
         WHERE tgrelid = 'audit_events'::regclass
           AND tgname = $1
           AND tgisinternal = false
       ) AS exists`,
      [triggerName],
    );
    expect(result.rows[0]?.exists).toBe(false);
  });

  it("a pharmacist with saleVoid succeeds and writes no denial row", async () => {
    const fixture = await createFixture();
    const scope = await loadScope(fixture.pharmacistId, fixture.organizationId);
    const before = await denialRows(fixture.branchId, fixture.pharmacistId);

    await expect(requireSaleVoid(scope, fixture.branchId)).resolves.toMatchObject({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
    });

    const after = await denialRows(fixture.branchId, fixture.pharmacistId);
    expect(after).toHaveLength(before.length);
  });

  it("a user with no assignments is denied and logged in their own organization", async () => {
    const fixture = await createFixture();
    const scope = await loadScope(fixture.noAssignmentId, fixture.organizationId);
    const before = await denialRows(fixture.branchId, fixture.noAssignmentId);

    expectForbidden(await captureError(() => requireSaleVoid(scope, fixture.branchId)));

    const after = await denialRows(fixture.branchId, fixture.noAssignmentId);
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]?.organizationId).toBe(fixture.organizationId);
  });

  it("ForbiddenError messages and denial payloads contain no ids or token", async () => {
    const fixture = await createFixture();
    const scope = await loadScope(fixture.cashierId, fixture.organizationId);

    const error = expectForbidden(
      await captureError(() => requireSaleVoid(scope, fixture.branchId)),
    );
    const ids = [
      fixture.cashierId,
      fixture.organizationId,
      fixture.branchId,
    ];
    for (const id of ids) expect(error.message).not.toContain(id);
    expect(error.message.toLowerCase()).not.toContain("token");

    const [row] = await denialRows(fixture.branchId, fixture.cashierId);
    expect(row).toBeDefined();
    const payloadText = JSON.stringify(row?.payload);
    for (const id of ids) expect(payloadText).not.toContain(id);
    expect(payloadText.toLowerCase()).not.toContain("token");
  });

  it(
    "a denied permission check does not wait on a locked batch row",
    async () => {
      const fixture = await createFixture();
      const scope = await loadScope(fixture.cashierId, fixture.organizationId);
      const batchId = randomUUID();

      await pool.query(`
        CREATE TABLE IF NOT EXISTS permissions_test_batch_rows (
          batch_id uuid PRIMARY KEY,
          label text NOT NULL
        )
      `);
      await pool.query(
        "INSERT INTO permissions_test_batch_rows (batch_id, label) VALUES ($1, $2)",
        [batchId, "locked-batch"],
      );

      const lockClient = await pool.connect();
      try {
        await lockClient.query("BEGIN");
        await lockClient.query(
          "SELECT batch_id FROM permissions_test_batch_rows WHERE batch_id = $1 FOR UPDATE",
          [batchId],
        );

        let timer: NodeJS.Timeout | undefined;
        const denial = requireSaleVoid(scope, fixture.branchId).then(
          () => ({ status: "resolved" as const }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        );
        const timeout = new Promise((resolve: (value: { status: "timeout" }) => void) => {
          timer = setTimeout(() => resolve({ status: "timeout" }), 2000);
        });

        const result = await Promise.race([denial, timeout]);
        if (timer) clearTimeout(timer);

        if (result.status === "timeout") {
          throw new Error("requireBranch waited more than 2 seconds on a locked batch row");
        }
        if (result.status === "rejected") expectForbidden(result.error);

        expect(await denialRows(fixture.branchId, fixture.cashierId)).toHaveLength(1);
      } finally {
        await lockClient.query("ROLLBACK");
        lockClient.release();
      }
    },
    10000,
  );
});
