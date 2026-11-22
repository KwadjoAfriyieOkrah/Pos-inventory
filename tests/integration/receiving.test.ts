import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  auditEvents,
  batches,
  branches,
  goodsReceiptLines,
  goodsReceipts,
  medicines,
  organizations,
  rolePermissions,
  roles,
  stockMovements,
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
  throw new Error("TEST_DATABASE_URL is required for receiving integration tests");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

type DbClient = typeof import("../../src/server/db/client")["db"];
type DataScope = import("../../src/server/data/scope").DataScope;
type AuthorizedBranch = import("../../src/server/data/scope").AuthorizedBranch;
type LoadScope = typeof import("../../src/server/auth/scope")["loadScope"];
type RequireBranch = typeof import("../../src/server/data/scope")["requireBranch"];
type ListSaleableMedicines =
  typeof import("../../src/server/data/catalog")["listSaleableMedicines"];
type ListBranchBatches =
  typeof import("../../src/server/data/stock")["listBranchBatches"];
type ReceiveGoods = typeof import("../../src/server/data/receiving")["receiveGoods"];
type ActivateMedicine =
  typeof import("../../src/server/data/receiving")["activateMedicine"];
type ReceivingValidationErrorClass = typeof import("../../src/server/data/receiving")["ReceivingValidationError"];
type ReceiveGoodsInput = import("../../src/server/data/receiving").ReceiveGoodsInput;
type ReceiveMedicineLine = import("../../src/server/data/receiving").ReceiveMedicineLine;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", async () => {
  const real = await import("../../src/lib/env");
  return { env: real.env };
});
vi.mock("@/lib/time", async () => await import("../../src/lib/time"));
vi.mock("@/lib/money", async () => await import("../../src/lib/money"));
vi.mock("@/server/db/client", async () => await import("../../src/server/db/client"));

let db: DbClient;
let pool: typeof import("../../src/server/db/client")["pool"];
let loadScope: LoadScope;
let requireBranch: RequireBranch;
let listSaleableMedicines: ListSaleableMedicines;
let listBranchBatches: ListBranchBatches;
let receiveGoods: ReceiveGoods;
let activateMedicine: ActivateMedicine;
let ReceivingValidationError: ReceivingValidationErrorClass;

function daysAfterToday(days: number): string {
  const parsed = new Date(`${accraToday()}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

const FUTURE_EXPIRY = daysAfterToday(30);
const ALTERNATE_EXPIRY = daysAfterToday(31);

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
  ({ loadScope } = await import("../../src/server/auth/scope"));
  ({ requireBranch } = await import("../../src/server/data/scope"));
  ({ listSaleableMedicines } = await import("../../src/server/data/catalog"));
  ({ listBranchBatches } = await import("../../src/server/data/stock"));
  const receiving = await import("../../src/server/data/receiving");
  receiveGoods = receiving.receiveGoods;
  activateMedicine = receiving.activateMedicine;
  ReceivingValidationError = receiving.ReceivingValidationError;
});

afterAll(async () => {
  if (pool) await pool.end();
});

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

function expectReceivingError(error: unknown, message: string): void {
  expect(error).toBeInstanceOf(ReceivingValidationError);
  const receivingError = error as Error;
  expect(receivingError.name).toBe("ReceivingValidationError");
  expect(receivingError.message).toBe(message);
}

async function createOrganization(): Promise<string> {
  const organizationId = randomUUID();
  await db.insert(organizations).values({
    id: organizationId,
    name: `receiving-org-${randomUUID()}`,
  });
  return organizationId;
}

async function createBranch(organizationId: string, label: string): Promise<string> {
  const branchId = randomUUID();
  await db.insert(branches).values({
    id: branchId,
    organizationId,
    name: `receiving-${label}-${randomUUID()}`,
    digitalAddress: `receiving-addr-${randomUUID()}`,
    licenceNumber: randomUUID(),
    licenceExpiresOn: "2030-12-31",
  });
  return branchId;
}

async function createRole(
  organizationId: string,
  label: string,
  permissions: readonly string[],
): Promise<string> {
  const roleId = randomUUID();
  await db.insert(roles).values({
    id: roleId,
    organizationId,
    code: `receiving-${label}-${randomUUID()}`,
    name: `Receiving ${label} role`,
  });
  await db
    .insert(rolePermissions)
    .values(permissions.map((permission) => ({ roleId, permission })));
  return roleId;
}

async function createUser(organizationId: string, label: string): Promise<string> {
  const userId = randomUUID();
  await db.insert(users).values({
    id: userId,
    organizationId,
    email: `receiving-${label}-${randomUUID()}@example.com`,
    fullName: `Receiving ${label}`,
  });
  return userId;
}

async function createAssignment(
  organizationId: string,
  userId: string,
  branchId: string,
  roleId: string,
): Promise<void> {
  await db.insert(userBranchAssignments).values({
    organizationId,
    userId,
    branchId,
    roleId,
  });
}

async function createMedicine(
  organizationId: string,
  name: string,
  status: "pending" | "active",
  classification: "OTC" | null,
  unitPricePesewas: number | null,
): Promise<string> {
  const medicineId = randomUUID();
  await db.insert(medicines).values({
    id: medicineId,
    organizationId,
    name,
    dosageForm: "tablet",
    status,
    classification,
    unitPricePesewas,
  });
  return medicineId;
}

interface Fixture {
  organizationId: string;
  branchA: string;
  branchB: string;
  cashierId: string;
  ownerId: string;
  cashierScope: DataScope;
  ownerScope: DataScope;
  cashierSaleAccessA: AuthorizedBranch;
  cashierReportAccessA: AuthorizedBranch;
  ownerReceiveAccessA: AuthorizedBranch;
  ownerEditAccessA: AuthorizedBranch;
  ownerSaleAccessA: AuthorizedBranch;
  ownerReportAccessA: AuthorizedBranch;
  activeMedicineId: string;
  pendingMedicineId: string;
}

async function createFixture(): Promise<Fixture> {
  const organizationId = await createOrganization();
  const branchA = await createBranch(organizationId, "branch-a");
  const branchB = await createBranch(organizationId, "branch-b");

  const cashierRoleId = await createRole(organizationId, "cashier", [
    PERMISSIONS.saleCreate,
    PERMISSIONS.reportViewBranch,
  ]);
  const ownerRoleId = await createRole(organizationId, "owner", [
    PERMISSIONS.saleCreate,
    PERMISSIONS.reportViewBranch,
    PERMISSIONS.reportViewAll,
    PERMISSIONS.stockReceive,
    PERMISSIONS.medicineEdit,
    PERMISSIONS.auditView,
  ]);

  const cashierId = await createUser(organizationId, "cashier");
  const ownerId = await createUser(organizationId, "owner");
  await createAssignment(organizationId, cashierId, branchA, cashierRoleId);
  await createAssignment(organizationId, ownerId, branchA, ownerRoleId);
  await createAssignment(organizationId, ownerId, branchB, ownerRoleId);

  const cashierScope = await loadScope(cashierId, organizationId);
  const ownerScope = await loadScope(ownerId, organizationId);

  const activeMedicineId = await createMedicine(
    organizationId,
    `receiving-active-${randomUUID()}`,
    "active",
    "OTC",
    1250,
  );
  const pendingMedicineId = await createMedicine(
    organizationId,
    `receiving-pending-${randomUUID()}`,
    "pending",
    null,
    null,
  );

  return {
    organizationId,
    branchA,
    branchB,
    cashierId,
    ownerId,
    cashierScope,
    ownerScope,
    cashierSaleAccessA: await requireBranch(
      cashierScope,
      branchA,
      PERMISSIONS.saleCreate,
    ),
    cashierReportAccessA: await requireBranch(
      cashierScope,
      branchA,
      PERMISSIONS.reportViewBranch,
    ),
    ownerReceiveAccessA: await requireBranch(
      ownerScope,
      branchA,
      PERMISSIONS.stockReceive,
    ),
    ownerEditAccessA: await requireBranch(
      ownerScope,
      branchA,
      PERMISSIONS.medicineEdit,
    ),
    ownerSaleAccessA: await requireBranch(
      ownerScope,
      branchA,
      PERMISSIONS.saleCreate,
    ),
    ownerReportAccessA: await requireBranch(
      ownerScope,
      branchA,
      PERMISSIONS.reportViewBranch,
    ),
    activeMedicineId,
    pendingMedicineId,
  };
}

function makeLine(
  medicineId: string,
  overrides: Partial<ReceiveMedicineLine> = {},
): ReceiveMedicineLine {
  return {
    medicineId,
    batchNumber: `receiving-batch-${randomUUID()}`,
    expiryDate: FUTURE_EXPIRY,
    quantity: "10",
    unitCostGhs: "5.50",
    ...overrides,
  };
}

function makeInput(
  line: ReceiveMedicineLine,
  overrides: Partial<ReceiveGoodsInput> = {},
): ReceiveGoodsInput {
  return {
    idempotencyKey: randomUUID(),
    supplierName: "Receiving test supplier",
    supplierInvoice: `receiving-invoice-${randomUUID()}`,
    lines: [line],
    ...overrides,
  };
}

describe("receiving", () => {
  it("refuses a receipt whose expiry date is today", async () => {
    const fixture = await createFixture();
    const error = await captureError(() =>
      receiveGoods(
        fixture.ownerScope,
        fixture.ownerReceiveAccessA,
        makeInput(
          makeLine(fixture.activeMedicineId, {
            expiryDate: accraToday(),
          }),
        ),
      ),
    );

    expectReceivingError(error, "Expiry date must be after today.");
  });

  it("treats a repeated idempotency key as a duplicate with one receipt and one movement set", async () => {
    const fixture = await createFixture();
    const input = makeInput(makeLine(fixture.activeMedicineId));

    const first = await receiveGoods(
      fixture.ownerScope,
      fixture.ownerReceiveAccessA,
      input,
    );
    const second = await receiveGoods(
      fixture.ownerScope,
      fixture.ownerReceiveAccessA,
      input,
    );

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.receiptId).toBe(first.receiptId);

    const receipts = await db
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.organizationId, fixture.organizationId),
          eq(goodsReceipts.branchId, fixture.branchA),
          eq(goodsReceipts.idempotencyKey, input.idempotencyKey),
        ),
      );
    const movements = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, fixture.organizationId),
          eq(stockMovements.branchId, fixture.branchA),
          eq(stockMovements.referenceId, first.receiptId),
        ),
      );
    const receiptLines = await db
      .select({ id: goodsReceiptLines.id })
      .from(goodsReceiptLines)
      .where(eq(goodsReceiptLines.receiptId, first.receiptId));

    expect(receipts).toHaveLength(1);
    expect(movements).toHaveLength(1);
    expect(receiptLines).toHaveLength(1);
  });

  it("adds two receipts for the same batch number and expiry into one batch", async () => {
    const fixture = await createFixture();
    const batchNumber = `receiving-batch-${randomUUID()}`;

    await receiveGoods(
      fixture.ownerScope,
      fixture.ownerReceiveAccessA,
      makeInput(
        makeLine(fixture.activeMedicineId, {
          batchNumber,
          quantity: "10",
        }),
      ),
    );
    await receiveGoods(
      fixture.ownerScope,
      fixture.ownerReceiveAccessA,
      makeInput(
        makeLine(fixture.activeMedicineId, {
          batchNumber,
          quantity: "15",
        }),
      ),
    );

    const batchRows = await db
      .select({
        id: batches.id,
        quantityOnHand: batches.quantityOnHand,
      })
      .from(batches)
      .where(
        and(
          eq(batches.organizationId, fixture.organizationId),
          eq(batches.branchId, fixture.branchA),
          eq(batches.medicineId, fixture.activeMedicineId),
          eq(batches.batchNumber, batchNumber),
        ),
      );
    expect(batchRows).toHaveLength(1);

    const movementRows = await db
      .select({ quantityDelta: stockMovements.quantityDelta })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, fixture.organizationId),
          eq(stockMovements.branchId, fixture.branchA),
          eq(stockMovements.batchId, batchRows[0].id),
          eq(stockMovements.movementType, "receipt"),
        ),
      );
    const movementTotal = movementRows.reduce(
      (total, row) => total + row.quantityDelta,
      0,
    );

    expect(batchRows[0].quantityOnHand).toBe(25);
    expect(movementTotal).toBe(25);
  });

  it("refuses the same batch number with a different expiry and writes no movement", async () => {
    const fixture = await createFixture();
    const batchNumber = `receiving-batch-${randomUUID()}`;

    await receiveGoods(
      fixture.ownerScope,
      fixture.ownerReceiveAccessA,
      makeInput(
        makeLine(fixture.activeMedicineId, {
          batchNumber,
          expiryDate: FUTURE_EXPIRY,
          quantity: "10",
        }),
      ),
    );

    const batchRows = await db
      .select({ id: batches.id })
      .from(batches)
      .where(
        and(
          eq(batches.organizationId, fixture.organizationId),
          eq(batches.branchId, fixture.branchA),
          eq(batches.medicineId, fixture.activeMedicineId),
          eq(batches.batchNumber, batchNumber),
        ),
      );
    expect(batchRows).toHaveLength(1);

    const movementsBefore = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, fixture.organizationId),
          eq(stockMovements.batchId, batchRows[0].id),
        ),
      );

    const error = await captureError(() =>
      receiveGoods(
        fixture.ownerScope,
        fixture.ownerReceiveAccessA,
        makeInput(
          makeLine(fixture.activeMedicineId, {
            batchNumber,
            expiryDate: ALTERNATE_EXPIRY,
            quantity: "7",
          }),
        ),
      ),
    );

    expectReceivingError(
      error,
      "Batch already exists with a different expiry or cost.",
    );

    const movementsAfter = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.organizationId, fixture.organizationId),
          eq(stockMovements.batchId, batchRows[0].id),
        ),
      );

    expect(movementsAfter).toHaveLength(movementsBefore.length);
  });

  it("denies a user without stockReceive and writes one access.denied row", async () => {
    const fixture = await createFixture();
    const input = makeInput(makeLine(fixture.activeMedicineId));

    const error = await captureError(() =>
      receiveGoods(fixture.cashierScope, fixture.ownerReceiveAccessA, input),
    );

    expectForbidden(error);

    const denials = await db
      .select({
        id: auditEvents.id,
        actorUserId: auditEvents.actorUserId,
        payload: auditEvents.payload,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, fixture.organizationId),
          eq(auditEvents.branchId, fixture.branchA),
          eq(auditEvents.action, "access.denied"),
          eq(auditEvents.actorUserId, fixture.cashierId),
        ),
      );

    expect(denials).toHaveLength(1);
    expect(denials[0].payload).toEqual({ permission: PERMISSIONS.stockReceive });
  });

  it("excludes a pending medicine from listSaleableMedicines", async () => {
    const fixture = await createFixture();

    const saleable = await listSaleableMedicines(
      fixture.cashierScope,
      fixture.cashierSaleAccessA,
    );

    expect(saleable.some((row) => row.id === fixture.pendingMedicineId)).toBe(false);
    expect(saleable.some((row) => row.id === fixture.activeMedicineId)).toBe(true);
  });

  it("denies cashier activation but lets an owner activate and audit the medicine", async () => {
    const fixture = await createFixture();
    const activation = { classification: "OTC", unitPriceGhs: "10.00" };

    const error = await captureError(() =>
      activateMedicine(
        fixture.cashierScope,
        fixture.ownerEditAccessA,
        fixture.pendingMedicineId,
        activation,
      ),
    );

    expectForbidden(error);

    await activateMedicine(
      fixture.ownerScope,
      fixture.ownerEditAccessA,
      fixture.pendingMedicineId,
      activation,
    );

    const medicineRows = await db
      .select({
        status: medicines.status,
        unitPricePesewas: medicines.unitPricePesewas,
      })
      .from(medicines)
      .where(eq(medicines.id, fixture.pendingMedicineId));
    expect(medicineRows).toHaveLength(1);
    expect(medicineRows[0].status).toBe("active");
    expect(medicineRows[0].unitPricePesewas).toBe(1000);

    const saleable = await listSaleableMedicines(
      fixture.cashierScope,
      fixture.cashierSaleAccessA,
    );
    expect(saleable.some((row) => row.id === fixture.pendingMedicineId)).toBe(true);

    const activations = await db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, fixture.organizationId),
          eq(auditEvents.branchId, fixture.branchA),
          eq(auditEvents.action, "medicine.activated"),
          eq(auditEvents.entityId, fixture.pendingMedicineId),
        ),
      );
    expect(activations).toHaveLength(1);
  });

  it("never includes unit cost in a cashier's stock result", async () => {
    const fixture = await createFixture();
    await receiveGoods(
      fixture.ownerScope,
      fixture.ownerReceiveAccessA,
      makeInput(makeLine(fixture.activeMedicineId)),
    );

    const rows = await listBranchBatches(
      fixture.cashierScope,
      fixture.cashierReportAccessA,
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain("unitCostPesewas");
      expect(row).not.toHaveProperty("unitCostPesewas");
    }
  });

  it("stores and returns only safe integer money values", async () => {
    const fixture = await createFixture();
    await receiveGoods(
      fixture.ownerScope,
      fixture.ownerReceiveAccessA,
      makeInput(makeLine(fixture.activeMedicineId)),
    );
    await activateMedicine(
      fixture.ownerScope,
      fixture.ownerEditAccessA,
      fixture.pendingMedicineId,
      { classification: "OTC", unitPriceGhs: "10.00" },
    );

    const storedMedicineMoney = await db
      .select({ unitPricePesewas: medicines.unitPricePesewas })
      .from(medicines)
      .where(eq(medicines.organizationId, fixture.organizationId));
    const storedBatchMoney = await db
      .select({ unitCostPesewas: batches.unitCostPesewas })
      .from(batches)
      .where(eq(batches.organizationId, fixture.organizationId));
    const storedLineMoney = await db
      .select({ unitCostPesewas: goodsReceiptLines.unitCostPesewas })
      .from(goodsReceiptLines)
      .where(eq(goodsReceiptLines.organizationId, fixture.organizationId));
    const activationPayloads = await db
      .select({ payload: auditEvents.payload })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, fixture.organizationId),
          eq(auditEvents.action, "medicine.activated"),
        ),
      );
    const returnedMedicines = await listSaleableMedicines(
      fixture.cashierScope,
      fixture.cashierSaleAccessA,
    );
    const returnedBatches = await listBranchBatches(
      fixture.ownerScope,
      fixture.ownerReportAccessA,
    );

    const moneyValues: number[] = [
      ...storedMedicineMoney.flatMap((row) =>
        row.unitPricePesewas === null ? [] : [row.unitPricePesewas],
      ),
      ...storedBatchMoney.map((row) => row.unitCostPesewas),
      ...storedLineMoney.map((row) => row.unitCostPesewas),
      ...returnedMedicines.map((row) => row.unitPricePesewas),
      ...returnedBatches.flatMap((row) =>
        row.unitCostPesewas === undefined ? [] : [row.unitCostPesewas],
      ),
    ];

    for (const row of activationPayloads) {
      const payload = row.payload as Record<string, unknown>;
      for (const [key, value] of Object.entries(payload)) {
        if (key.endsWith("Pesewas") && typeof value === "number") {
          moneyValues.push(value);
        }
      }
    }

    expect(moneyValues.length).toBeGreaterThan(0);
    for (const value of moneyValues) {
      expect(Number.isSafeInteger(value)).toBe(true);
    }
  });

  it("keeps every batch quantity equal to the sum of its stock movements", async () => {
    const fixture = await createFixture();
    const sharedBatchNumber = `receiving-batch-${randomUUID()}`;

    await receiveGoods(
      fixture.ownerScope,
      fixture.ownerReceiveAccessA,
      makeInput(
        makeLine(fixture.activeMedicineId, {
          batchNumber: sharedBatchNumber,
          quantity: "10",
        }),
      ),
    );
    await receiveGoods(
      fixture.ownerScope,
      fixture.ownerReceiveAccessA,
      makeInput(
        makeLine(fixture.activeMedicineId, {
          batchNumber: sharedBatchNumber,
          quantity: "5",
        }),
      ),
    );
    await receiveGoods(
      fixture.ownerScope,
      fixture.ownerReceiveAccessA,
      makeInput(makeLine(fixture.activeMedicineId, { quantity: "7" })),
    );

    const batchRows = await db
      .select({
        id: batches.id,
        quantityOnHand: batches.quantityOnHand,
      })
      .from(batches)
      .where(eq(batches.organizationId, fixture.organizationId));
    const movementRows = await db
      .select({
        batchId: stockMovements.batchId,
        quantityDelta: stockMovements.quantityDelta,
      })
      .from(stockMovements)
      .where(eq(stockMovements.organizationId, fixture.organizationId));

    const totals = new Map<string, number>();
    for (const row of movementRows) {
      totals.set(row.batchId, (totals.get(row.batchId) ?? 0) + row.quantityDelta);
    }

    expect(batchRows.length).toBeGreaterThan(0);
    for (const batch of batchRows) {
      expect(batch.quantityOnHand).toBe(totals.get(batch.id) ?? 0);
    }
  });
});
