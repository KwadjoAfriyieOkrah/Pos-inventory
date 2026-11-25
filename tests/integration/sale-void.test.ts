import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  auditEvents,
  batches,
  branchSettings,
  branches,
  medicines,
  organizations,
  payments,
  rolePermissions,
  roles,
  saleLines,
  saleVoids,
  sales,
  stockMovements,
  userBranchAssignments,
  users,
} from "../../db/schema";
import { accraToday } from "../../src/lib/time";
import { branchCodeFromName } from "../../src/lib/sale-number";
import { PERMISSIONS } from "../../src/server/data/permissions";

loadDotenv({ path: ".env.local", quiet: true });
loadDotenv({
  path: join(process.cwd(), "tests", ".env.test"),
  quiet: true,
});
if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required for sale-void integration tests");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const databaseName = new URL(process.env.DATABASE_URL).pathname.replace(/^\/+/, "");
if (databaseName !== "pos_test") {
  throw new Error("Refusing to run: DATABASE_URL must point to pos_test.");
}

type DbClient = typeof import("../../src/server/db/client")["db"];
type DataScope = import("../../src/server/data/scope").DataScope;
type AuthorizedBranch = import("../../src/server/data/scope").AuthorizedBranch;
type LoadScope = typeof import("../../src/server/auth/scope")["loadScope"];
type RequireBranch = typeof import("../../src/server/data/scope")["requireBranch"];
type RequestVoid = typeof import("../../src/server/data/sale-void")["requestVoid"];
type ApproveVoid = typeof import("../../src/server/data/sale-void")["approveVoid"];
type VoidResult = import("../../src/server/data/sale-void").VoidResult;
type ForbiddenErrorClass = typeof import("../../src/server/data/errors")["ForbiddenError"];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", async () => {
  const real = await import("../../src/lib/env");
  return { env: real.env };
});
vi.mock("@/lib/time", async () => await import("../../src/lib/time"));
vi.mock("@/lib/money", async () => await import("../../src/lib/money"));
vi.mock("@/lib/sale-number", async () => await import("../../src/lib/sale-number"));
vi.mock("@/server/db/client", async () => await import("../../src/server/db/client"));

let db: DbClient;
let pool: typeof import("../../src/server/db/client")["pool"];
let loadScope: LoadScope;
let requireBranch: RequireBranch;
let requestVoid: RequestVoid;
let approveVoid: ApproveVoid;
let ForbiddenError: ForbiddenErrorClass;

let branchCodeSequence = 0;

const REASON = "customer changed mind";

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
  ({ loadScope } = await import("../../src/server/auth/scope"));
  ({ requireBranch } = await import("../../src/server/data/scope"));
  ({ requestVoid, approveVoid } = await import("../../src/server/data/sale-void"));
  ({ ForbiddenError } = await import("../../src/server/data/errors"));
});

afterAll(async () => {
  if (pool) await pool.end();
});

function shiftedDateString(days: number): string {
  const shifted = new Date(`${accraToday()}T12:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

function shiftedDate(days: number): Date {
  return new Date(`${shiftedDateString(days)}T12:00:00.000Z`);
}

async function captureError(run: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

function expectSuccess(result: VoidResult, status: "completed" | "pending_approval"): string {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.status).toBe(status);
  return result.voidId;
}

function expectFailure(result: VoidResult, message: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a failed result");
  expect(result.message).toBe(message);
}

interface Context {
  organizationId: string;
  branchId: string;
  userId: string;
  scope: DataScope;
  access: AuthorizedBranch;
}

async function createContext(
  options: {
    organizationId?: string;
    permissions?: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][];
    limitPesewas?: number | null;
  } = {},
): Promise<Context> {
  const organizationId = options.organizationId ?? randomUUID();
  if (!options.organizationId) {
    await db.insert(organizations).values({
      id: organizationId,
      name: `sale-void-org-${randomUUID()}`,
    });
  }

  const branchId = randomUUID();
  const suffix = String.fromCharCode(65 + (branchCodeSequence++ % 26));
  const branchName = `sale-void-branch-${randomUUID()}-${suffix}`;
  await db.insert(branches).values({
    id: branchId,
    organizationId,
    name: branchName,
    branchCode: branchCodeFromName(branchName),
    digitalAddress: `sale-void-addr-${randomUUID()}`,
    licenceNumber: randomUUID(),
    licenceExpiresOn: shiftedDateString(365),
  });

  const roleId = randomUUID();
  await db.insert(roles).values({
    id: roleId,
    organizationId,
    code: `sale-void-role-${randomUUID()}`,
    name: "Sale void role",
  });
  const permissions = options.permissions ?? [
    PERMISSIONS.saleCreate,
    PERMISSIONS.saleVoid,
  ];
  for (const permission of permissions) {
    await db.insert(rolePermissions).values({ roleId, permission });
  }

  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    organizationId,
    email: `sale-void-user-${randomUUID()}@example.com`,
    fullName: "Sale void user",
  });
  await db.insert(userBranchAssignments).values({
    organizationId,
    userId,
    branchId,
    roleId,
  });

  if (options.limitPesewas !== undefined) {
    await db.insert(branchSettings).values({
      branchId,
      organizationId,
      voidAutoApproveLimitPesewas: options.limitPesewas,
    });
  }

  const scope = await loadScope(userId, organizationId);
  const access = await requireBranch(scope, branchId, PERMISSIONS.saleCreate);
  return { organizationId, branchId, userId, scope, access };
}

async function createBatch(
  context: Context,
  quantityOnHand: number,
): Promise<{ batchId: string; medicineId: string }> {
  const medicineId = randomUUID();
  await db.insert(medicines).values({
    id: medicineId,
    organizationId: context.organizationId,
    name: `sale-void-medicine-${randomUUID()}`,
    dosageForm: "tablet",
    status: "active",
    classification: "OTC",
    unitPricePesewas: 1000,
  });

  const batchId = randomUUID();
  await db.insert(batches).values({
    id: batchId,
    organizationId: context.organizationId,
    branchId: context.branchId,
    medicineId,
    batchNumber: `sale-void-batch-${randomUUID()}`,
    expiryDate: shiftedDateString(60),
    unitCostPesewas: 500,
    quantityOnHand,
  });

  return { batchId, medicineId };
}

interface SaleFixture {
  saleId: string;
  batchId: string;
  medicineId: string;
  totalPesewas: number;
  quantity: number;
}

async function createSaleFixture(
  context: Context,
  batch: { batchId: string; medicineId: string },
  options: {
    totalPesewas: number;
    quantity: number;
    createdAt?: Date;
  },
): Promise<SaleFixture> {
  const saleId = randomUUID();
  const createdAt = options.createdAt ?? new Date();
  await db.insert(sales).values({
    id: saleId,
    organizationId: context.organizationId,
    branchId: context.branchId,
    cashierId: context.userId,
    idempotencyKey: `sale-void-idem-${randomUUID()}`,
    saleNumber: `SV-${randomUUID()}`,
    totalPesewas: options.totalPesewas,
    paymentMethod: "cash",
    createdAt,
  });

  await db.insert(saleLines).values({
    id: randomUUID(),
    saleId,
    medicineId: batch.medicineId,
    batchId: batch.batchId,
    quantity: options.quantity,
    unitPricePesewas: options.totalPesewas / options.quantity,
    lineTotalPesewas: options.totalPesewas,
  });

  await db.insert(payments).values({
    id: randomUUID(),
    saleId,
    amountPesewas: options.totalPesewas,
    method: "cash",
    reference: null,
  });

  await db.insert(stockMovements).values({
    id: randomUUID(),
    organizationId: context.organizationId,
    branchId: context.branchId,
    batchId: batch.batchId,
    movementType: "sale",
    quantityDelta: -options.quantity,
    referenceId: saleId,
    createdBy: context.userId,
  });

  return {
    saleId,
    batchId: batch.batchId,
    medicineId: batch.medicineId,
    totalPesewas: options.totalPesewas,
    quantity: options.quantity,
  };
}

async function insertVoid(
  context: Context,
  saleId: string,
  status: "pending_approval" | "completed",
  reason = REASON,
): Promise<string> {
  const voidId = randomUUID();
  await db.insert(saleVoids).values({
    id: voidId,
    organizationId: context.organizationId,
    branchId: context.branchId,
    saleId,
    status,
    reason,
    requestedBy: context.userId,
    requestedAt: new Date(),
    businessDate: accraToday(),
  });
  return voidId;
}

async function batchQuantity(batchId: string): Promise<number> {
  const [row] = await db
    .select({ quantityOnHand: batches.quantityOnHand })
    .from(batches)
    .where(eq(batches.id, batchId))
    .limit(1);
  if (!row) throw new Error("batch fixture not found");
  return row.quantityOnHand;
}

async function reversalRows(
  organizationId: string,
  batchId: string,
  saleId?: string,
): Promise<{ id: string; quantityDelta: number }[]> {
  const conditions = [
    eq(stockMovements.organizationId, organizationId),
    eq(stockMovements.batchId, batchId),
    eq(stockMovements.movementType, "reversal"),
  ];
  if (saleId) conditions.push(eq(stockMovements.referenceId, saleId));
  return db
    .select({
      id: stockMovements.id,
      quantityDelta: stockMovements.quantityDelta,
    })
    .from(stockMovements)
    .where(and(...conditions));
}

async function snapshotSale(
  organizationId: string,
  saleId: string,
): Promise<unknown> {
  const [sale] = await db
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.organizationId, organizationId)))
    .limit(1);
  const lines = await db
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId))
    .orderBy(saleLines.id);
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.saleId, saleId))
    .limit(1);
  const movements = await db
    .select()
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.organizationId, organizationId),
        eq(stockMovements.referenceId, saleId),
        eq(stockMovements.movementType, "sale"),
      ),
    )
    .orderBy(stockMovements.id);
  return { sale, lines, payment, movements };
}

describe("sale voids", () => {
  it("rejects a cashier with ForbiddenError and one access.denied row", async () => {
    const context = await createContext({ permissions: [PERMISSIONS.saleCreate] });
    const batch = await createBatch(context, 50);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });
    const voidId = await insertVoid(context, sale.saleId, "pending_approval");

    const error = await captureError(() =>
      approveVoid(context.scope, context.access, voidId),
    );

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as Error).message).toBe("Access denied");
    const denials = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, context.organizationId),
          eq(auditEvents.action, "access.denied"),
        ),
      );
    expect(denials).toHaveLength(1);
  });

  it("requestVoid denies a scope without sale.create and records access.denied", async () => {
    const context = await createContext({ permissions: [PERMISSIONS.saleCreate] });
    const batch = await createBatch(context, 50);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });
    const deniedScope: DataScope = {
      userId: context.userId,
      organizationId: context.organizationId,
      branches: new Map([[context.branchId, new Set(["report.view_branch"])]]),
    };
    const access = await requireBranch(
      context.scope,
      context.branchId,
      PERMISSIONS.saleCreate,
    );

    const error = await captureError(() =>
      requestVoid(deniedScope, access, sale.saleId, "denial test reason"),
    );

    expect(error).toBeInstanceOf(ForbiddenError);
    const denials = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, context.organizationId),
          eq(auditEvents.branchId, context.branchId),
          eq(auditEvents.actorUserId, context.userId),
          eq(auditEvents.action, "access.denied"),
        ),
      );
    expect(denials.length).toBeGreaterThan(0);
  });

  it("requestVoid allows a cashier scope with sale.create and leaves today's sale pending", async () => {
    const context = await createContext();
    const batch = await createBatch(context, 50);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });

    const result = await requestVoid(
      context.scope,
      context.access,
      sale.saleId,
      "allowance test reason",
    );

    expectSuccess(result, "pending_approval");
  });

  it("auto-voids a 5000 sale with a 10000 limit and restores stock", async () => {
    const context = await createContext({ limitPesewas: 10000 });
    const batch = await createBatch(context, 100);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });
    const startQuantity = await batchQuantity(batch.batchId);

    const result = await requestVoid(
      context.scope,
      context.access,
      sale.saleId,
      REASON,
    );

    expectSuccess(result, "completed");
    expect(await batchQuantity(batch.batchId)).toBe(startQuantity + 5);
    const reversals = await reversalRows(
      context.organizationId,
      batch.batchId,
      sale.saleId,
    );
    expect(reversals).toHaveLength(1);
    expect(reversals[0]?.quantityDelta).toBe(5);
  });

  it("leaves a 20000 sale pending with a 10000 limit and no stock return", async () => {
    const context = await createContext({ limitPesewas: 10000 });
    const batch = await createBatch(context, 100);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 20000,
      quantity: 4,
    });
    const startQuantity = await batchQuantity(batch.batchId);

    const result = await requestVoid(
      context.scope,
      context.access,
      sale.saleId,
      REASON,
    );

    expectSuccess(result, "pending_approval");
    expect(await batchQuantity(batch.batchId)).toBe(startQuantity);
    expect(
      await reversalRows(context.organizationId, batch.batchId, sale.saleId),
    ).toHaveLength(0);
  });

  it("leaves a small sale pending when the limit is unset", async () => {
    const context = await createContext();
    const batch = await createBatch(context, 100);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });
    const startQuantity = await batchQuantity(batch.batchId);

    const result = await requestVoid(
      context.scope,
      context.access,
      sale.saleId,
      REASON,
    );

    expectSuccess(result, "pending_approval");
    expect(await batchQuantity(batch.batchId)).toBe(startQuantity);
  });

  it("restores stock exactly once when approving a pending void", async () => {
    const context = await createContext();
    const batch = await createBatch(context, 100);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });
    const voidId = expectSuccess(
      await requestVoid(context.scope, context.access, sale.saleId, REASON),
      "pending_approval",
    );
    const startQuantity = await batchQuantity(batch.batchId);

    const result = await approveVoid(context.scope, context.access, voidId);

    expectSuccess(result, "completed");
    expect(await batchQuantity(batch.batchId)).toBe(startQuantity + 5);
    const reversals = await reversalRows(
      context.organizationId,
      batch.batchId,
      sale.saleId,
    );
    expect(reversals).toHaveLength(1);
    expect(reversals[0]?.quantityDelta).toBe(5);
  });

  it("refuses to approve a non-pending void", async () => {
    const context = await createContext();
    const batch = await createBatch(context, 100);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });
    const voidId = await insertVoid(context, sale.saleId, "completed");
    const startQuantity = await batchQuantity(batch.batchId);

    const result = await approveVoid(context.scope, context.access, voidId);

    expectFailure(result, "This void is not waiting for approval.");
    expect(await batchQuantity(batch.batchId)).toBe(startQuantity);
  });

  it("rejects a second void of the same sale", async () => {
    const context = await createContext();
    const batch = await createBatch(context, 100);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });
    expectSuccess(
      await requestVoid(context.scope, context.access, sale.saleId, REASON),
      "pending_approval",
    );

    const result = await requestVoid(
      context.scope,
      context.access,
      sale.saleId,
      REASON,
    );

    expectFailure(result, "This sale has already been voided.");
    const voidRows = await db
      .select({ id: saleVoids.id })
      .from(saleVoids)
      .where(eq(saleVoids.saleId, sale.saleId));
    expect(voidRows).toHaveLength(1);
  });

  it("rejects a sale from yesterday without changing anything", async () => {
    const context = await createContext({ limitPesewas: 10000 });
    const batch = await createBatch(context, 100);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
      createdAt: shiftedDate(-1),
    });
    const startQuantity = await batchQuantity(batch.batchId);
    const startVoids = await db
      .select({ id: saleVoids.id })
      .from(saleVoids)
      .where(eq(saleVoids.organizationId, context.organizationId));
    const startMovements = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.organizationId, context.organizationId));
    const startAudits = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, context.organizationId));

    const result = await requestVoid(
      context.scope,
      context.access,
      sale.saleId,
      REASON,
    );

    expectFailure(
      result,
      "Only sales from today can be voided. Ask the owner to correct an older sale.",
    );
    expect(await batchQuantity(batch.batchId)).toBe(startQuantity);
    const endVoids = await db
      .select({ id: saleVoids.id })
      .from(saleVoids)
      .where(eq(saleVoids.organizationId, context.organizationId));
    const endMovements = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.organizationId, context.organizationId));
    const endAudits = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, context.organizationId));
    expect(endVoids).toEqual(startVoids);
    expect(endMovements).toEqual(startMovements);
    expect(endAudits).toEqual(startAudits);
  });

  it("does not find a sale from another branch", async () => {
    const contextA = await createContext({ limitPesewas: 10000 });
    const contextB = await createContext({
      organizationId: contextA.organizationId,
      limitPesewas: 10000,
    });
    const batchB = await createBatch(contextB, 100);
    const saleB = await createSaleFixture(contextB, batchB, {
      totalPesewas: 5000,
      quantity: 5,
    });
    const startQuantity = await batchQuantity(batchB.batchId);

    const result = await requestVoid(
      contextA.scope,
      contextA.access,
      saleB.saleId,
      REASON,
    );

    expectFailure(result, "Sale not found.");
    expect(await batchQuantity(batchB.batchId)).toBe(startQuantity);
    const voidRows = await db
      .select({ id: saleVoids.id })
      .from(saleVoids)
      .where(eq(saleVoids.saleId, saleB.saleId));
    expect(voidRows).toHaveLength(0);
  });

  it("leaves the original sale, lines, payment, and sale movements unchanged", async () => {
    const context = await createContext();
    const batch = await createBatch(context, 100);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });
    const before = await snapshotSale(context.organizationId, sale.saleId);

    expectSuccess(
      await requestVoid(context.scope, context.access, sale.saleId, REASON),
      "pending_approval",
    );

    const after = await snapshotSale(context.organizationId, sale.saleId);
    expect(after).toEqual(before);
  });

  it("rejects UPDATE and DELETE on sale_voids", async () => {
    const context = await createContext();
    const batch = await createBatch(context, 100);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });
    const voidId = await insertVoid(context, sale.saleId, "pending_approval");

    const updateError = await captureError(() =>
      db
        .update(saleVoids)
        .set({ reason: "tampered reason value" })
        .where(eq(saleVoids.id, voidId)),
    );
    const deleteError = await captureError(() =>
      db.delete(saleVoids).where(eq(saleVoids.id, voidId)),
    );

    expect(updateError).toBeInstanceOf(Error);
    expect(deleteError).toBeInstanceOf(Error);
  });

  it("keeps money values and reason text out of audit payloads", async () => {
    const context = await createContext();
    const batch = await createBatch(context, 100);
    const sale = await createSaleFixture(context, batch, {
      totalPesewas: 5000,
      quantity: 5,
    });
    const auditReason = "customer disputed charge";

    expectSuccess(
      await requestVoid(context.scope, context.access, sale.saleId, auditReason),
      "pending_approval",
    );

    const payloads = await db
      .select({ payload: auditEvents.payload })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, context.organizationId),
          inArray(auditEvents.action, [
            "sale.voided",
            "sale.void_requested",
            "sale.void_approved",
          ]),
        ),
      );
    expect(payloads).toHaveLength(1);
    const serialized = JSON.stringify(payloads.map((row) => row.payload));
    expect(serialized.includes(auditReason)).toBe(false);
    expect(serialized.includes(String(sale.totalPesewas))).toBe(false);
    expect(/\d/.test(serialized)).toBe(false);
  });

  it("serializes concurrent voids that share one batch", async () => {
    const context = await createContext({ limitPesewas: 10000 });
    const batch = await createBatch(context, 100);
    const saleA = await createSaleFixture(context, batch, {
      totalPesewas: 3000,
      quantity: 3,
    });
    const saleB = await createSaleFixture(context, batch, {
      totalPesewas: 4000,
      quantity: 4,
    });
    const startQuantity = await batchQuantity(batch.batchId);

    const [resultA, resultB] = await Promise.all([
      requestVoid(context.scope, context.access, saleA.saleId, REASON),
      requestVoid(context.scope, context.access, saleB.saleId, REASON),
    ]);

    expectSuccess(resultA, "completed");
    expectSuccess(resultB, "completed");
    expect(await batchQuantity(batch.batchId)).toBe(startQuantity + 3 + 4);
    const reversals = await reversalRows(context.organizationId, batch.batchId);
    expect(reversals).toHaveLength(2);
    expect(reversals.reduce((sum, row) => sum + row.quantityDelta, 0)).toBe(7);
  });
});
