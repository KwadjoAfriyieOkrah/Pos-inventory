import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import * as ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  auditEvents,
  batches,
  branches,
  medicines,
  organizations,
  rolePermissions,
  roles,
  saleLines,
  sales,
  userBranchAssignments,
  users,
} from "../../db/schema";
import { accraToday } from "../../src/lib/time";
import {
  FORBIDDEN_MESSAGE,
  ForbiddenError,
} from "../../src/server/data/errors";
import { PERMISSIONS } from "../../src/server/data/permissions";

loadDotenv({ path: ".env.local", quiet: true });
loadDotenv({
  path: join(process.cwd(), "tests", ".env.test"),
  quiet: true,
});
if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required for read-path integration tests");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

type DbClient = typeof import("../../src/server/db/client")["db"];
type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type DataScope = import("../../src/server/data/scope").DataScope;
type AuthorizedBranch = import("../../src/server/data/scope").AuthorizedBranch;
type LoadScope = typeof import("../../src/server/auth/scope")["loadScope"];
type RequireBranch = typeof import("../../src/server/data/scope")["requireBranch"];
type ListSaleableMedicines =
  typeof import("../../src/server/data/catalog")["listSaleableMedicines"];
type ListBranchBatches =
  typeof import("../../src/server/data/stock")["listBranchBatches"];
type BranchDashboard =
  typeof import("../../src/server/data/dashboard")["branchDashboard"];

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
let listSaleableMedicines: ListSaleableMedicines;
let listBranchBatches: ListBranchBatches;
let branchDashboard: BranchDashboard;

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;

  ({ loadScope } = await import("../../src/server/auth/scope"));
  ({ requireBranch } = await import("../../src/server/data/scope"));
  ({ listSaleableMedicines } = await import("../../src/server/data/catalog"));
  ({ listBranchBatches } = await import("../../src/server/data/stock"));
  ({ branchDashboard } = await import("../../src/server/data/dashboard"));
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
  const organizationId = randomUUID();
  await tx.insert(organizations).values({
    id: organizationId,
    name: `read-path-org-${randomUUID()}`,
  });
  return organizationId;
}

async function insertBranch(
  tx: Tx,
  organizationId: string,
  label: string,
): Promise<string> {
  const branchId = randomUUID();
  await tx.insert(branches).values({
    id: branchId,
    organizationId,
    name: `read-path-${label}-${randomUUID()}`,
    digitalAddress: `read-path-addr-${randomUUID()}`,
    licenceNumber: randomUUID(),
    licenceExpiresOn: "2030-12-31",
  });
  return branchId;
}

async function insertRole(
  tx: Tx,
  organizationId: string,
  label: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = randomUUID();
  await tx.insert(roles).values({
    id: roleId,
    organizationId,
    code: `read-path-${label}-${randomUUID()}`,
    name: `Read path ${label} role`,
  });
  if (permissions.length > 0) {
    await tx
      .insert(rolePermissions)
      .values(permissions.map((permission) => ({ roleId, permission })));
  }
  return roleId;
}

async function insertUser(
  tx: Tx,
  organizationId: string,
  label: string,
): Promise<string> {
  const userId = randomUUID();
  await tx.insert(users).values({
    id: userId,
    organizationId,
    email: `read-path-${label}-${randomUUID()}@example.com`,
    fullName: `Read path ${label}`,
  });
  return userId;
}

async function insertAssignment(
  tx: Tx,
  organizationId: string,
  userId: string,
  branchId: string,
  roleId: string,
): Promise<void> {
  await tx.insert(userBranchAssignments).values({
    organizationId,
    userId,
    branchId,
    roleId,
  });
}

async function insertMedicine(
  tx: Tx,
  organizationId: string,
  name: string,
): Promise<string> {
  const medicineId = randomUUID();
  await tx.insert(medicines).values({
    id: medicineId,
    organizationId,
    name,
    dosageForm: "tablet",
    unitPricePesewas: 1250,
  });
  return medicineId;
}

async function insertBatch(
  tx: Tx,
  organizationId: string,
  branchId: string,
  medicineId: string,
): Promise<string> {
  const batchId = randomUUID();
  await tx.insert(batches).values({
    id: batchId,
    organizationId,
    branchId,
    medicineId,
    batchNumber: `read-path-batch-${randomUUID()}`,
    expiryDate: "2030-12-31",
    unitCostPesewas: 500,
    quantityOnHand: 10,
  });
  return batchId;
}

async function insertSale(
  tx: Tx,
  input: {
    organizationId: string;
    branchId: string;
    cashierId: string;
    totalPesewas: number;
    createdAt: Date;
  },
): Promise<string> {
  const saleId = randomUUID();
  await tx.insert(sales).values({
    id: saleId,
    organizationId: input.organizationId,
    branchId: input.branchId,
    cashierId: input.cashierId,
    idempotencyKey: randomUUID(),
    totalPesewas: input.totalPesewas,
    paymentMethod: "cash",
    createdAt: input.createdAt,
  });
  return saleId;
}

async function insertSaleLine(
  tx: Tx,
  input: {
    saleId: string;
    medicineId: string;
    batchId: string;
    quantity: number;
    unitPricePesewas: number;
  },
): Promise<void> {
  await tx.insert(saleLines).values({
    saleId: input.saleId,
    medicineId: input.medicineId,
    batchId: input.batchId,
    quantity: input.quantity,
    unitPricePesewas: input.unitPricePesewas,
    lineTotalPesewas: input.quantity * input.unitPricePesewas,
  });
}

function daysBeforeAtNoonUtc(today: string, days: number): Date {
  const parsed = new Date(`${today}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return new Date(`${parsed.toISOString().slice(0, 10)}T12:00:00.000Z`);
}

interface ReadFixture {
  orgA: string;
  orgB: string;
  branchA: string;
  branchB: string;
  cashierId: string;
  ownerId: string;
  cashierScope: DataScope;
  ownerScope: DataScope;
  cashierAccessA: AuthorizedBranch;
  cashierAccessB: AuthorizedBranch;
  cashierSaleAccessA: AuthorizedBranch;
  ownerAccessA: AuthorizedBranch;
  ownerAccessB: AuthorizedBranch;
  medicineName: string;
  medicineAId: string;
  medicineBId: string;
  batchAId: string;
  batchBId: string;
}

async function buildFixture(tx: Tx): Promise<ReadFixture> {
  const orgA = await insertOrganization(tx);
  const orgB = await insertOrganization(tx);
  const branchA = await insertBranch(tx, orgA, "branch-a");
  const branchB = await insertBranch(tx, orgA, "branch-b");

  const cashierRoleId = await insertRole(tx, orgA, "cashier", [
    PERMISSIONS.saleCreate,
    PERMISSIONS.reportViewBranch,
  ]);
  const ownerRoleId = await insertRole(tx, orgA, "owner", [
    PERMISSIONS.saleCreate,
    PERMISSIONS.reportViewBranch,
    PERMISSIONS.reportViewAll,
  ]);

  const cashierId = await insertUser(tx, orgA, "cashier");
  const ownerId = await insertUser(tx, orgA, "owner");
  await insertAssignment(tx, orgA, cashierId, branchA, cashierRoleId);
  await insertAssignment(tx, orgA, ownerId, branchA, ownerRoleId);
  await insertAssignment(tx, orgA, ownerId, branchB, ownerRoleId);

  const cashierScope = await loadScope(cashierId, orgA);
  const ownerScope = await loadScope(ownerId, orgA);

  const cashierAccessA = await requireBranch(
    cashierScope,
    branchA,
    PERMISSIONS.reportViewBranch,
  );
  const cashierAccessB = await requireBranch(
    ownerScope,
    branchB,
    PERMISSIONS.reportViewBranch,
  );
  const cashierSaleAccessA = await requireBranch(
    cashierScope,
    branchA,
    PERMISSIONS.saleCreate,
  );
  const ownerAccessA = await requireBranch(
    ownerScope,
    branchA,
    PERMISSIONS.reportViewBranch,
  );
  const ownerAccessB = await requireBranch(
    ownerScope,
    branchB,
    PERMISSIONS.reportViewBranch,
  );

  const medicineName = `read-path-medicine-${randomUUID()}`;
  const medicineAId = await insertMedicine(tx, orgA, medicineName);
  const medicineBId = await insertMedicine(tx, orgB, medicineName);
  const batchAId = await insertBatch(tx, orgA, branchA, medicineAId);
  const batchBId = await insertBatch(tx, orgA, branchB, medicineAId);

  return {
    orgA,
    orgB,
    branchA,
    branchB,
    cashierId,
    ownerId,
    cashierScope,
    ownerScope,
    cashierAccessA,
    cashierAccessB,
    cashierSaleAccessA,
    ownerAccessA,
    ownerAccessB,
    medicineName,
    medicineAId,
    medicineBId,
    batchAId,
    batchBId,
  };
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

interface ParameterDetails {
  name: string;
  type: string | undefined;
}

function parameterDetails(
  parameter: ts.ParameterDeclaration | undefined,
  sourceFile: ts.SourceFile,
): ParameterDetails | undefined {
  if (!parameter) return undefined;
  return {
    name: parameter.name.getText(sourceFile),
    type: parameter.type?.getText(sourceFile),
  };
}

describe("read path", () => {
  it("denies a cashier stock read for Branch B and writes one access.denied row", async () => {
    await withRollback(async (tx) => {
      const fixture = await buildFixture(tx);
      const error = await captureError(() =>
        listBranchBatches(fixture.cashierScope, fixture.cashierAccessB),
      );

      expectForbidden(error);

      const denials = await tx
        .select({
          id: auditEvents.id,
          actorUserId: auditEvents.actorUserId,
          payload: auditEvents.payload,
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, fixture.orgA),
            eq(auditEvents.branchId, fixture.branchB),
            eq(auditEvents.action, "access.denied"),
          ),
        );

      expect(denials).toHaveLength(1);
      expect(denials[0].actorUserId).toBe(fixture.cashierId);
      expect(denials[0].payload).toEqual({
        permission: PERMISSIONS.reportViewBranch,
      });
    });
  });

  it("omits unitCostPesewas for cashier stock rows and includes it for owner rows", async () => {
    await withRollback(async (tx) => {
      const fixture = await buildFixture(tx);
      const cashierRows = await listBranchBatches(
        fixture.cashierScope,
        fixture.cashierAccessA,
      );
      const ownerRows = await listBranchBatches(
        fixture.ownerScope,
        fixture.ownerAccessA,
      );

      expect(cashierRows.length).toBeGreaterThan(0);
      expect(ownerRows).toHaveLength(cashierRows.length);

      for (const row of cashierRows) {
        expect(Object.keys(row)).not.toContain("unitCostPesewas");
        expect(row).not.toHaveProperty("unitCostPesewas");
      }

      for (const row of ownerRows) {
        expect(row).toHaveProperty("unitCostPesewas");
        expect(Number.isSafeInteger(row.unitCostPesewas)).toBe(true);
      }
    });
  });

  it("lists saleable medicines only from the caller's organization", async () => {
    await withRollback(async (tx) => {
      const fixture = await buildFixture(tx);
      const rows = await listSaleableMedicines(
        fixture.cashierScope,
        fixture.cashierSaleAccessA,
      );
      const sameNameRows = rows.filter(
        (row) => row.name === fixture.medicineName,
      );

      expect(sameNameRows).toHaveLength(1);
      expect(sameNameRows[0].id).toBe(fixture.medicineAId);
      expect(rows.some((row) => row.id === fixture.medicineBId)).toBe(false);
    });
  });

  it("excludes a sale from eight days before today and includes one from six days before", async () => {
    await withRollback(async (tx) => {
      const fixture = await buildFixture(tx);
      const today = accraToday();
      const excludedTotal = 800_000;
      const includedTotal = 600_000;

      const excludedSaleId = await insertSale(tx, {
        organizationId: fixture.orgA,
        branchId: fixture.branchA,
        cashierId: fixture.cashierId,
        totalPesewas: excludedTotal,
        createdAt: daysBeforeAtNoonUtc(today, 8),
      });
      const includedSaleId = await insertSale(tx, {
        organizationId: fixture.orgA,
        branchId: fixture.branchA,
        cashierId: fixture.cashierId,
        totalPesewas: includedTotal,
        createdAt: daysBeforeAtNoonUtc(today, 6),
      });
      await insertSaleLine(tx, {
        saleId: excludedSaleId,
        medicineId: fixture.medicineAId,
        batchId: fixture.batchAId,
        quantity: 2,
        unitPricePesewas: 1000,
      });
      await insertSaleLine(tx, {
        saleId: includedSaleId,
        medicineId: fixture.medicineAId,
        batchId: fixture.batchAId,
        quantity: 1,
        unitPricePesewas: 1000,
      });

      const dashboard = await branchDashboard(
        fixture.ownerScope,
        fixture.ownerAccessA,
        today,
      );

      expect(dashboard.salesCount).toBe(1);
      expect(dashboard.salesTotalPesewas).toBe(includedTotal);
      expect(dashboard.topMedicines).toEqual([
        { medicineName: fixture.medicineName, unitsSold: 1 },
      ]);
    });
  });

  it("owner dashboard totals equal the sum of the per-branch totals", async () => {
    await withRollback(async (tx) => {
      const fixture = await buildFixture(tx);
      const today = accraToday();
      const branchATotal = 123_000;
      const branchBTotal = 45_000;
      const createdAt = daysBeforeAtNoonUtc(today, 1);

      await insertSale(tx, {
        organizationId: fixture.orgA,
        branchId: fixture.branchA,
        cashierId: fixture.cashierId,
        totalPesewas: branchATotal,
        createdAt,
      });
      await insertSale(tx, {
        organizationId: fixture.orgA,
        branchId: fixture.branchB,
        cashierId: fixture.ownerId,
        totalPesewas: branchBTotal,
        createdAt,
      });

      const branchA = await branchDashboard(
        fixture.ownerScope,
        fixture.ownerAccessA,
        today,
      );
      const branchB = await branchDashboard(
        fixture.ownerScope,
        fixture.ownerAccessB,
        today,
      );

      expect(branchA.salesTotalPesewas + branchB.salesTotalPesewas).toBe(
        branchATotal + branchBTotal,
      );
      expect(branchA.salesCount + branchB.salesCount).toBe(2);
    });
  });

  it("returns safe integer money fields, including zero for an empty sum", async () => {
    await withRollback(async (tx) => {
      const fixture = await buildFixture(tx);
      const today = accraToday();
      const saleId = await insertSale(tx, {
        organizationId: fixture.orgA,
        branchId: fixture.branchA,
        cashierId: fixture.cashierId,
        totalPesewas: 321_000,
        createdAt: daysBeforeAtNoonUtc(today, 0),
      });
      await insertSaleLine(tx, {
        saleId,
        medicineId: fixture.medicineAId,
        batchId: fixture.batchAId,
        quantity: 3,
        unitPricePesewas: 1000,
      });

      const catalog = await listSaleableMedicines(
        fixture.cashierScope,
        fixture.cashierSaleAccessA,
      );
      const ownerStock = await listBranchBatches(
        fixture.ownerScope,
        fixture.ownerAccessA,
      );
      const populatedDashboard = await branchDashboard(
        fixture.ownerScope,
        fixture.ownerAccessA,
        today,
      );
      const emptyDashboard = await branchDashboard(
        fixture.ownerScope,
        fixture.ownerAccessB,
        today,
      );

      const moneyValues = [
        ...catalog.map((row) => row.unitPricePesewas),
        ...ownerStock.flatMap((row) =>
          row.unitCostPesewas === undefined ? [] : [row.unitCostPesewas],
        ),
        populatedDashboard.salesTotalPesewas,
      ];

      expect(moneyValues.length).toBeGreaterThan(0);
      for (const value of moneyValues) {
        expect(Number.isSafeInteger(value)).toBe(true);
      }

      expect(emptyDashboard.salesTotalPesewas).toBe(0);
      expect(Number.isSafeInteger(emptyDashboard.salesTotalPesewas)).toBe(true);
      expect(emptyDashboard.salesCount).toBe(0);
      expect(Number.isSafeInteger(emptyDashboard.salesCount)).toBe(true);

      for (const row of populatedDashboard.topMedicines) {
        expect(Number.isSafeInteger(row.unitsSold)).toBe(true);
      }
      for (const batch of populatedDashboard.batches) {
        expect(Number.isSafeInteger(batch.quantityOnHand)).toBe(true);
      }
    });
  });

  it("every exported function in catalog, stock, and dashboard takes scope then access", () => {
    const files = ["catalog.ts", "stock.ts", "dashboard.ts"].map((name) =>
      join(process.cwd(), "src", "server", "data", name),
    );

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const parsed = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const functions: {
        name: string;
        first: ParameterDetails | undefined;
        second: ParameterDetails | undefined;
      }[] = [];

      const visit = (node: ts.Node): void => {
        if (
          ts.isFunctionDeclaration(node) &&
          node.name &&
          isExported(node)
        ) {
          functions.push({
            name: node.name.text,
            first: parameterDetails(node.parameters[0], parsed),
            second: parameterDetails(node.parameters[1], parsed),
          });
        }
        ts.forEachChild(node, visit);
      };

      visit(parsed);

      expect(functions.length, `${file} exports at least one function`).toBeGreaterThan(0);

      for (const fn of functions) {
        expect(fn.first?.name, `${file}: ${fn.name} first parameter name`).toBe(
          "scope",
        );
        expect(fn.first?.type, `${file}: ${fn.name} first parameter type`).toBe(
          "DataScope",
        );
        expect(
          fn.second?.name,
          `${file}: ${fn.name} second parameter name`,
        ).toBe("access");
        expect(
          fn.second?.type,
          `${file}: ${fn.name} second parameter type`,
        ).toBe("AuthorizedBranch");
      }
    }
  });
});
