import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  auditEvents,
  batches,
  branches,
  medicines,
  organizations,
  payments,
  rolePermissions,
  roles,
  saleLines,
  sales,
  stockMovements,
  userBranchAssignments,
  users,
} from "../../db/schema";
import { accraToday } from "../../src/lib/time";
import { PERMISSIONS } from "../../src/server/data/permissions";

loadDotenv({ path: ".env.local", quiet: true });
loadDotenv({
  path: join(process.cwd(), "tests", ".env.test"),
  quiet: true,
});
if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is required for sales integration tests");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

type DbClient = typeof import("../../src/server/db/client")["db"];
type DataScope = import("../../src/server/data/scope").DataScope;
type AuthorizedBranch = import("../../src/server/data/scope").AuthorizedBranch;
type LoadScope = typeof import("../../src/server/auth/scope")["loadScope"];
type RequireBranch = typeof import("../../src/server/data/scope")["requireBranch"];
type CompleteSale =
  typeof import("../../src/server/data/sales")["completeSale"];
type SaleValidationErrorClass =
  typeof import("../../src/server/data/sales")["SaleValidationError"];
type CompleteSaleInput =
  import("../../src/server/data/sales").CompleteSaleInput;

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
let completeSale: CompleteSale;
let SaleValidationError: SaleValidationErrorClass;

function daysFromToday(days: number): string {
  const parsed = new Date(`${accraToday()}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

const FUTURE_EXPIRY = daysFromToday(30);
const LATER_EXPIRY = daysFromToday(60);
const EXPIRED_EXPIRY = daysFromToday(-1);

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
  ({ loadScope } = await import("../../src/server/auth/scope"));
  ({ requireBranch } = await import("../../src/server/data/scope"));
  const salesModule = await import("../../src/server/data/sales");
  completeSale = salesModule.completeSale;
  SaleValidationError = salesModule.SaleValidationError;
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

function expectSaleError(error: unknown, message: string): void {
  expect(error).toBeInstanceOf(SaleValidationError);
  const saleError = error as Error;
  expect(saleError.name).toBe("SaleValidationError");
  expect(saleError.message).toBe(message);
}

function expectSafeInteger(value: unknown, label: string): void {
  expect(Number.isSafeInteger(value), label).toBe(true);
}

interface Fixture {
  organizationId: string;
  branchId: string;
  cashierId: string;
  scope: DataScope;
  access: AuthorizedBranch;
}

async function createFixture(): Promise<Fixture> {
  const organizationId = randomUUID();
  await db.insert(organizations).values({
    id: organizationId,
    name: `sales-org-${randomUUID()}`,
  });

  const branchId = randomUUID();
  await db.insert(branches).values({
    id: branchId,
    organizationId,
    name: `sales-branch-${randomUUID()}`,
    digitalAddress: `sales-addr-${randomUUID()}`,
    licenceNumber: randomUUID(),
    licenceExpiresOn: "2030-12-31",
  });

  const roleId = randomUUID();
  await db.insert(roles).values({
    id: roleId,
    organizationId,
    code: `sales-role-${randomUUID()}`,
    name: "Sales role",
  });
  await db.insert(rolePermissions).values({
    roleId,
    permission: PERMISSIONS.saleCreate,
  });

  const cashierId = randomUUID();
  await db.insert(users).values({
    id: cashierId,
    organizationId,
    email: `sales-cashier-${randomUUID()}@example.com`,
    fullName: "Sales Cashier",
  });
  await db.insert(userBranchAssignments).values({
    organizationId,
    userId: cashierId,
    branchId,
    roleId,
  });

  const scope = await loadScope(cashierId, organizationId);
  const access = await requireBranch(scope, branchId, PERMISSIONS.saleCreate);

  return { organizationId, branchId, cashierId, scope, access };
}

async function createMedicine(
  fixture: Fixture,
  label: string,
  unitPricePesewas: number,
  status: "active" | "pending" = "active",
): Promise<{ id: string; name: string }> {
  const id = randomUUID();
  const name = `sales-${label}-${randomUUID()}`;
  await db.insert(medicines).values({
    id,
    organizationId: fixture.organizationId,
    name,
    dosageForm: "tablet",
    status,
    classification: status === "active" ? "OTC" : null,
    unitPricePesewas: status === "active" ? unitPricePesewas : null,
  });
  return { id, name };
}

interface BatchOptions {
  expiryDate: string;
  quantityOnHand: number;
  batchNumber?: string;
  unitCostPesewas?: number;
}

async function seedBatch(
  fixture: Fixture,
  medicineId: string,
  options: BatchOptions,
): Promise<string> {
  const batchId = randomUUID();
  await db.insert(batches).values({
    id: batchId,
    organizationId: fixture.organizationId,
    branchId: fixture.branchId,
    medicineId,
    batchNumber: options.batchNumber ?? `sales-batch-${randomUUID()}`,
    expiryDate: options.expiryDate,
    unitCostPesewas: options.unitCostPesewas ?? 500,
    quantityOnHand: options.quantityOnHand,
  });

  if (options.quantityOnHand > 0) {
    await db.insert(stockMovements).values({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      batchId,
      movementType: "receipt",
      quantityDelta: options.quantityOnHand,
      referenceId: randomUUID(),
      createdBy: fixture.cashierId,
    });
  }

  return batchId;
}

function cashInput(
  key: string,
  medicineId: string,
  quantity: string,
  tenderedGhs: string,
): CompleteSaleInput {
  return {
    idempotencyKey: key,
    lines: [{ medicineId, quantity }],
    paymentMethod: "cash",
    tenderedGhs,
  };
}

function momoInput(
  key: string,
  medicineId: string,
  quantity: string,
  reference: string,
): CompleteSaleInput {
  return {
    idempotencyKey: key,
    lines: [{ medicineId, quantity }],
    paymentMethod: "momo",
    reference,
  };
}

async function saleCount(fixture: Fixture): Promise<number> {
  const rows = await db
    .select({ id: sales.id })
    .from(sales)
    .where(
      and(
        eq(sales.organizationId, fixture.organizationId),
        eq(sales.branchId, fixture.branchId),
      ),
    );
  return rows.length;
}

async function saleLineCount(fixture: Fixture): Promise<number> {
  const rows = await db
    .select({ id: saleLines.id })
    .from(saleLines)
    .innerJoin(sales, eq(saleLines.saleId, sales.id))
    .where(
      and(
        eq(sales.organizationId, fixture.organizationId),
        eq(sales.branchId, fixture.branchId),
      ),
    );
  return rows.length;
}

async function paymentCount(fixture: Fixture): Promise<number> {
  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(sales, eq(payments.saleId, sales.id))
    .where(
      and(
        eq(sales.organizationId, fixture.organizationId),
        eq(sales.branchId, fixture.branchId),
      ),
    );
  return rows.length;
}

async function movementCount(fixture: Fixture): Promise<number> {
  const rows = await db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.organizationId, fixture.organizationId),
        eq(stockMovements.branchId, fixture.branchId),
      ),
    );
  return rows.length;
}

async function saleMovementCount(fixture: Fixture): Promise<number> {
  const rows = await db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.organizationId, fixture.organizationId),
        eq(stockMovements.branchId, fixture.branchId),
        eq(stockMovements.movementType, "sale"),
      ),
    );
  return rows.length;
}

async function getBatch(batchId: string) {
  const [row] = await db
    .select()
    .from(batches)
    .where(eq(batches.id, batchId))
    .limit(1);
  expect(row).toBeDefined();
  return row!;
}

async function getSaleLines(saleId: string) {
  return db.select().from(saleLines).where(eq(saleLines.saleId, saleId));
}

async function getPayment(saleId: string) {
  const [row] = await db
    .select()
    .from(payments)
    .where(eq(payments.saleId, saleId))
    .limit(1);
  expect(row).toBeDefined();
  return row!;
}

async function getSaleAudit(fixture: Fixture, saleId: string) {
  const [row] = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, fixture.organizationId),
        eq(auditEvents.branchId, fixture.branchId),
        eq(auditEvents.action, "sale.completed"),
        eq(auditEvents.entityId, saleId),
      ),
    )
    .limit(1);
  expect(row).toBeDefined();
  return row!;
}

async function expectBatchMovementInvariant(fixture: Fixture): Promise<void> {
  const batchRows = await db
    .select({ id: batches.id, quantityOnHand: batches.quantityOnHand })
    .from(batches)
    .where(
      and(
        eq(batches.organizationId, fixture.organizationId),
        eq(batches.branchId, fixture.branchId),
      ),
    );
  expect(batchRows.length).toBeGreaterThan(0);

  const movements = await db
    .select({
      batchId: stockMovements.batchId,
      movementType: stockMovements.movementType,
      quantityDelta: stockMovements.quantityDelta,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.organizationId, fixture.organizationId),
        eq(stockMovements.branchId, fixture.branchId),
      ),
    );

  for (const batch of batchRows) {
    const batchMovements = movements.filter(
      (movement) => movement.batchId === batch.id,
    );
    const receipts = batchMovements
      .filter((movement) => movement.movementType === "receipt")
      .reduce((sum, movement) => sum + movement.quantityDelta, 0);
    const salesQuantity = -batchMovements
      .filter((movement) => movement.movementType === "sale")
      .reduce((sum, movement) => sum + movement.quantityDelta, 0);
    expect(batch.quantityOnHand, `batch ${batch.id} quantity`).toBe(
      receipts - salesQuantity,
    );
    expect(batch.quantityOnHand, `batch ${batch.id} nonnegative`).toBeGreaterThanOrEqual(
      0,
    );
  }
}

describe("sales", () => {
  it("refuses a sale with a pending medicine and writes no sale data", async () => {
    const fixture = await createFixture();
    const pending = await createMedicine(fixture, "pending", 1250, "pending");
    const batchId = await seedBatch(fixture, pending.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 3,
    });

    const error = await captureError(() =>
      completeSale(
        fixture.scope,
        fixture.access,
        cashInput(randomUUID(), pending.id, "1", "20.00"),
      ),
    );

    expectSaleError(error, "Medicine is not available for sale.");
    expect(await saleCount(fixture)).toBe(0);
    expect(await saleLineCount(fixture)).toBe(0);
    expect(await paymentCount(fixture)).toBe(0);
    expect(await movementCount(fixture)).toBe(1);
    expect((await getBatch(batchId)).quantityOnHand).toBe(3);
  });

  it("refuses quantities 0, 100, 1.5, and -1", async () => {
    const fixture = await createFixture();
    const medicine = await createMedicine(fixture, "quantity", 1250);
    await seedBatch(fixture, medicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 200,
    });

    for (const quantity of ["0", "100", "1.5", "-1"]) {
      const error = await captureError(() =>
        completeSale(
          fixture.scope,
          fixture.access,
          cashInput(randomUUID(), medicine.id, quantity, "30.00"),
        ),
      );
      expectSaleError(error, "Quantity must be a whole number from 1 to 99.");
    }

    expect(await saleCount(fixture)).toBe(0);
    expect(await saleLineCount(fixture)).toBe(0);
    expect(await paymentCount(fixture)).toBe(0);
    expect(await saleMovementCount(fixture)).toBe(0);
  });

  it("refuses under-tender, returns zero change on exact tender, and exact change on overpayment", async () => {
    const fixture = await createFixture();
    const medicine = await createMedicine(fixture, "cash", 1250);
    const batchId = await seedBatch(fixture, medicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 10,
    });

    const underError = await captureError(() =>
      completeSale(
        fixture.scope,
        fixture.access,
        cashInput(randomUUID(), medicine.id, "1", "12.49"),
      ),
    );
    expectSaleError(underError, "Tendered amount must cover the sale total.");
    expect(await saleCount(fixture)).toBe(0);

    const exact = await completeSale(
      fixture.scope,
      fixture.access,
      cashInput(randomUUID(), medicine.id, "1", "12.50"),
    );
    expect(exact.totalPesewas).toBe(1250);
    expect(exact.changePesewas).toBe(0);
    expect((await getPayment(exact.saleId)).amountPesewas).toBe(1250);
    expect((await getBatch(batchId)).quantityOnHand).toBe(9);
    await expectBatchMovementInvariant(fixture);

    const over = await completeSale(
      fixture.scope,
      fixture.access,
      cashInput(randomUUID(), medicine.id, "1", "20.00"),
    );
    expect(over.totalPesewas).toBe(1250);
    expect(over.changePesewas).toBe(750);
    expect((await getPayment(over.saleId)).amountPesewas).toBe(2000);
    expect((await getBatch(batchId)).quantityOnHand).toBe(8);
    await expectBatchMovementInvariant(fixture);
  });

  it("refuses a short MoMo reference and accepts a valid one", async () => {
    const fixture = await createFixture();
    const medicine = await createMedicine(fixture, "momo", 1000);
    await seedBatch(fixture, medicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 5,
    });

    const shortError = await captureError(() =>
      completeSale(
        fixture.scope,
        fixture.access,
        momoInput(randomUUID(), medicine.id, "1", "abc"),
      ),
    );
    expectSaleError(shortError, "MoMo reference must be 4 to 40 characters.");
    expect(await saleCount(fixture)).toBe(0);

    const reference = "MOMO-REF-1";
    const result = await completeSale(
      fixture.scope,
      fixture.access,
      momoInput(randomUUID(), medicine.id, "1", reference),
    );
    expect(result.paymentMethod).toBe("momo");
    expect(result.reference).toBe(reference);
    expect(result.changePesewas).toBe(0);
    expect((await getPayment(result.saleId)).reference).toBe(reference);
    await expectBatchMovementInvariant(fixture);
  });

  it("allocates earliest expiry first and spans two batches", async () => {
    const fixture = await createFixture();
    const medicine = await createMedicine(fixture, "fefo", 1250);
    const earlierBatchId = await seedBatch(fixture, medicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 2,
      batchNumber: `sales-earlier-${randomUUID()}`,
    });
    const laterBatchId = await seedBatch(fixture, medicine.id, {
      expiryDate: LATER_EXPIRY,
      quantityOnHand: 5,
      batchNumber: `sales-later-${randomUUID()}`,
    });

    const result = await completeSale(
      fixture.scope,
      fixture.access,
      cashInput(randomUUID(), medicine.id, "4", "100.00"),
    );
    expect(result.totalPesewas).toBe(5000);

    const lines = await getSaleLines(result.saleId);
    expect(lines).toHaveLength(2);
    const byBatch = new Map(lines.map((line) => [line.batchId, line.quantity]));
    expect(byBatch.get(earlierBatchId)).toBe(2);
    expect(byBatch.get(laterBatchId)).toBe(2);

    expect((await getBatch(earlierBatchId)).quantityOnHand).toBe(0);
    expect((await getBatch(laterBatchId)).quantityOnHand).toBe(3);

    const movements = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, result.saleId));
    expect(movements).toHaveLength(2);
    expect(
      movements.find((movement) => movement.batchId === earlierBatchId)
        ?.quantityDelta,
    ).toBe(-2);
    expect(
      movements.find((movement) => movement.batchId === laterBatchId)
        ?.quantityDelta,
    ).toBe(-2);
    await expectBatchMovementInvariant(fixture);
  });

  it("never uses expired or zero-quantity batches", async () => {
    const fixture = await createFixture();
    const medicine = await createMedicine(fixture, "expiry", 1250);
    const expiredBatchId = await seedBatch(fixture, medicine.id, {
      expiryDate: EXPIRED_EXPIRY,
      quantityOnHand: 10,
    });
    const zeroBatchId = await seedBatch(fixture, medicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 0,
    });
    const validBatchId = await seedBatch(fixture, medicine.id, {
      expiryDate: LATER_EXPIRY,
      quantityOnHand: 2,
    });

    const result = await completeSale(
      fixture.scope,
      fixture.access,
      cashInput(randomUUID(), medicine.id, "2", "50.00"),
    );

    const lines = await getSaleLines(result.saleId);
    expect(lines).toHaveLength(1);
    expect(lines[0].batchId).toBe(validBatchId);
    expect((await getBatch(expiredBatchId)).quantityOnHand).toBe(10);
    expect((await getBatch(zeroBatchId)).quantityOnHand).toBe(0);
    expect((await getBatch(validBatchId)).quantityOnHand).toBe(0);

    const movements = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, result.saleId));
    expect(movements).toHaveLength(1);
    expect(movements[0].batchId).toBe(validBatchId);
    await expectBatchMovementInvariant(fixture);
  });

  it("refuses a sale larger than available stock and changes nothing", async () => {
    const fixture = await createFixture();
    const medicine = await createMedicine(fixture, "short", 1250);
    const batchId = await seedBatch(fixture, medicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 2,
    });
    const movementBaseline = await movementCount(fixture);

    const error = await captureError(() =>
      completeSale(
        fixture.scope,
        fixture.access,
        cashInput(randomUUID(), medicine.id, "3", "50.00"),
      ),
    );

    expectSaleError(error, `Not enough stock for ${medicine.name}.`);
    expect(await saleCount(fixture)).toBe(0);
    expect(await saleLineCount(fixture)).toBe(0);
    expect(await paymentCount(fixture)).toBe(0);
    expect(await movementCount(fixture)).toBe(movementBaseline);
    expect((await getBatch(batchId)).quantityOnHand).toBe(2);
  });

  it("treats a repeated idempotency key as one sale and one movement set", async () => {
    const fixture = await createFixture();
    const medicine = await createMedicine(fixture, "idempotent", 1250);
    const batchId = await seedBatch(fixture, medicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 5,
    });
    const input = cashInput(randomUUID(), medicine.id, "2", "50.00");

    const first = await completeSale(fixture.scope, fixture.access, input);
    const second = await completeSale(fixture.scope, fixture.access, input);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.saleId).toBe(first.saleId);
    expect(second.totalPesewas).toBe(first.totalPesewas);
    expect(second.changePesewas).toBe(first.changePesewas);
    expect(await saleCount(fixture)).toBe(1);
    expect(await paymentCount(fixture)).toBe(1);
    expect(await saleLineCount(fixture)).toBe(1);
    expect(await saleMovementCount(fixture)).toBe(1);
    expect((await getBatch(batchId)).quantityOnHand).toBe(3);
    await expectBatchMovementInvariant(fixture);
  });

  it("keeps batch quantity equal to receipts minus sales after every sale", async () => {
    const fixture = await createFixture();
    const firstMedicine = await createMedicine(fixture, "invariant-a", 1250);
    const secondMedicine = await createMedicine(fixture, "invariant-b", 500);
    await seedBatch(fixture, firstMedicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 3,
    });
    await seedBatch(fixture, firstMedicine.id, {
      expiryDate: LATER_EXPIRY,
      quantityOnHand: 2,
    });
    await seedBatch(fixture, secondMedicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 4,
    });

    await completeSale(
      fixture.scope,
      fixture.access,
      cashInput(randomUUID(), firstMedicine.id, "4", "100.00"),
    );
    await expectBatchMovementInvariant(fixture);

    await completeSale(
      fixture.scope,
      fixture.access,
      cashInput(randomUUID(), secondMedicine.id, "1", "20.00"),
    );
    await expectBatchMovementInvariant(fixture);
  });

  it("allows exactly one concurrent sale for the last units", async () => {
    const fixture = await createFixture();
    const medicine = await createMedicine(fixture, "concurrent", 1250);
    const batchId = await seedBatch(fixture, medicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 1,
    });

    const results = await Promise.allSettled([
      completeSale(
        fixture.scope,
        fixture.access,
        cashInput(randomUUID(), medicine.id, "1", "12.50"),
      ),
      completeSale(
        fixture.scope,
        fixture.access,
        cashInput(randomUUID(), medicine.id, "1", "12.50"),
      ),
    ]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<CompleteSale>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expectSaleError(
      rejected[0].reason,
      `Not enough stock for ${medicine.name}.`,
    );
    expect(await saleCount(fixture)).toBe(1);
    expect(await saleMovementCount(fixture)).toBe(1);
    expect((await getBatch(batchId)).quantityOnHand).toBe(0);
    await expectBatchMovementInvariant(fixture);
  });

  it("ignores a browser-supplied fake unit price", async () => {
    const fixture = await createFixture();
    const medicine = await createMedicine(fixture, "price", 1250);
    await seedBatch(fixture, medicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 5,
    });
    const input = cashInput(randomUUID(), medicine.id, "2", "50.00");
    const fakePayload = {
      ...input,
      unitPricePesewas: 1,
      pricePesewas: 1,
      totalPesewas: 1,
    } as CompleteSaleInput;

    const result = await completeSale(fixture.scope, fixture.access, fakePayload);

    expect(result.totalPesewas).toBe(2500);
    expect((await getPayment(result.saleId)).amountPesewas).toBe(5000);
    const lines = await getSaleLines(result.saleId);
    expect(lines).toHaveLength(1);
    expect(lines[0].unitPricePesewas).toBe(1250);
    expect(lines[0].lineTotalPesewas).toBe(2500);
  });

  it("stores only safe integer money values", async () => {
    const fixture = await createFixture();
    const medicine = await createMedicine(fixture, "money", 1250);
    const batchId = await seedBatch(fixture, medicine.id, {
      expiryDate: FUTURE_EXPIRY,
      quantityOnHand: 5,
      unitCostPesewas: 500,
    });

    const result = await completeSale(
      fixture.scope,
      fixture.access,
      cashInput(randomUUID(), medicine.id, "2", "30.00"),
    );

    expectSafeInteger(result.totalPesewas, "result totalPesewas");
    expectSafeInteger(result.changePesewas, "result changePesewas");
    expectSafeInteger(
      (await getBatch(batchId)).unitCostPesewas,
      "batch unitCostPesewas",
    );

    const [medicineRow] = await db
      .select()
      .from(medicines)
      .where(eq(medicines.id, medicine.id))
      .limit(1);
    expectSafeInteger(medicineRow.unitPricePesewas, "medicine unitPricePesewas");

    const [saleRow] = await db
      .select()
      .from(sales)
      .where(eq(sales.id, result.saleId))
      .limit(1);
    expectSafeInteger(saleRow.totalPesewas, "sale totalPesewas");

    const lines = await getSaleLines(result.saleId);
    expect(lines).toHaveLength(1);
    expectSafeInteger(lines[0].unitPricePesewas, "sale line unitPricePesewas");
    expectSafeInteger(lines[0].lineTotalPesewas, "sale line lineTotalPesewas");
    expectSafeInteger(
      (await getPayment(result.saleId)).amountPesewas,
      "payment amountPesewas",
    );

    const audit = await getSaleAudit(fixture, result.saleId);
    const payload = audit.payload as { totalPesewas?: number };
    expectSafeInteger(payload.totalPesewas, "audit payload totalPesewas");
  });
});
