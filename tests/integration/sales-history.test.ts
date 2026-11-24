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
import { branchCodeFromName, nextSaleNumber } from "../../src/lib/sale-number";
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
  throw new Error("TEST_DATABASE_URL is required for sales history integration tests");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

type DbClient = typeof import("../../src/server/db/client")["db"];
type DataScope = import("../../src/server/data/scope").DataScope;
type AuthorizedBranch = import("../../src/server/data/scope").AuthorizedBranch;
type LoadScope = typeof import("../../src/server/auth/scope")["loadScope"];
type RequireBranch = typeof import("../../src/server/data/scope")["requireBranch"];
type ListSales = typeof import("../../src/server/data/sales-history")["listSales"];
type ListSaleCashiers =
  typeof import("../../src/server/data/sales-history")["listSaleCashiers"];
type GetSaleDetail =
  typeof import("../../src/server/data/sales-history")["getSaleDetail"];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", async () => {
  const real = await import("../../src/lib/env");
  return { env: real.env };
});
vi.mock("@/lib/time", async () => await import("../../src/lib/time"));
vi.mock("@/server/db/client", async () => await import("../../src/server/db/client"));

let db: DbClient;
let pool: typeof import("../../src/server/db/client")["pool"];
let loadScope: LoadScope;
let requireBranch: RequireBranch;
let listSales: ListSales;
let listSaleCashiers: ListSaleCashiers;
let getSaleDetail: GetSaleDetail;

const TODAY = accraToday();

let branchCodeSequence = 0;

function dateDaysBefore(days: number): string {
  const value = new Date(`${TODAY}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function timestampDaysBefore(days: number, minutesAgo = 0): Date {
  const value = new Date(`${dateDaysBefore(days)}T12:00:00.000Z`);
  value.setUTCMinutes(value.getUTCMinutes() - minutesAgo);
  return value;
}

beforeAll(async () => {
  const client = await import("../../src/server/db/client");
  db = client.db;
  pool = client.pool;
  ({ loadScope } = await import("../../src/server/auth/scope"));
  ({ requireBranch } = await import("../../src/server/data/scope"));
  ({ listSales, listSaleCashiers, getSaleDetail } = await import(
    "../../src/server/data/sales-history"
  ));
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

function expectSafeInteger(value: unknown, label: string): void {
  expect(Number.isSafeInteger(value), `${label} must be a safe integer`).toBe(true);
}

interface Fixture {
  organizationId: string;
  branchAId: string;
  branchBId: string;
  cashierId: string;
  ownerId: string;
  cashierScope: DataScope;
  ownerScope: DataScope;
  cashierAccessA: AuthorizedBranch;
  cashierAccessB: AuthorizedBranch;
  cashierSaleAccessA: AuthorizedBranch;
  ownerAccessA: AuthorizedBranch;
  ownerAccessB: AuthorizedBranch;
  medicineId: string;
  batchAId: string;
  batchA2Id: string;
  batchBId: string;
  batchANumber: string;
  batchA2Number: string;
  batchBNumber: string;
  batchAExpiry: string;
  batchA2Expiry: string;
  batchBExpiry: string;
}

async function createFixture(): Promise<Fixture> {
  const organizationId = randomUUID();
  await db.insert(organizations).values({
    id: organizationId,
    name: `sales-history-org-${randomUUID()}`,
  });

  const branchAId = randomUUID();
  const branchBId = randomUUID();
  const branchAName = `sales-history-a-${randomUUID()}-${String.fromCharCode(65 + (branchCodeSequence++ % 26))}`;
  const branchBName = `sales-history-b-${randomUUID()}-${String.fromCharCode(65 + (branchCodeSequence++ % 26))}`;
  await db.insert(branches).values([
    {
      id: branchAId,
      organizationId,
      name: branchAName,
      branchCode: branchCodeFromName(branchAName),
      digitalAddress: `sales-history-addr-a-${randomUUID()}`,
      licenceNumber: randomUUID(),
      licenceExpiresOn: "2030-12-31",
    },
    {
      id: branchBId,
      organizationId,
      name: branchBName,
      branchCode: branchCodeFromName(branchBName),
      digitalAddress: `sales-history-addr-b-${randomUUID()}`,
      licenceNumber: randomUUID(),
      licenceExpiresOn: "2030-12-31",
    },
  ]);

  const cashierRoleId = randomUUID();
  const ownerRoleId = randomUUID();
  await db.insert(roles).values([
    {
      id: cashierRoleId,
      organizationId,
      code: `sales-history-cashier-${randomUUID()}`,
      name: "Sales history cashier",
    },
    {
      id: ownerRoleId,
      organizationId,
      code: `sales-history-owner-${randomUUID()}`,
      name: "Sales history owner",
    },
  ]);
  await db.insert(rolePermissions).values([
    { roleId: cashierRoleId, permission: PERMISSIONS.saleCreate },
    { roleId: cashierRoleId, permission: PERMISSIONS.reportViewBranch },
    { roleId: ownerRoleId, permission: PERMISSIONS.reportViewBranch },
    { roleId: ownerRoleId, permission: PERMISSIONS.reportViewAll },
  ]);

  const cashierId = randomUUID();
  const ownerId = randomUUID();
  await db.insert(users).values([
    {
      id: cashierId,
      organizationId,
      email: `sales-history-cashier-${randomUUID()}@example.com`,
      fullName: `History Cashier ${randomUUID()}`,
    },
    {
      id: ownerId,
      organizationId,
      email: `sales-history-owner-${randomUUID()}@example.com`,
      fullName: `History Owner ${randomUUID()}`,
    },
  ]);
  await db.insert(userBranchAssignments).values([
    {
      organizationId,
      userId: cashierId,
      branchId: branchAId,
      roleId: cashierRoleId,
    },
    {
      organizationId,
      userId: ownerId,
      branchId: branchAId,
      roleId: ownerRoleId,
    },
    {
      organizationId,
      userId: ownerId,
      branchId: branchBId,
      roleId: ownerRoleId,
    },
  ]);

  const cashierScope = await loadScope(cashierId, organizationId);
  const ownerScope = await loadScope(ownerId, organizationId);
  const cashierAccessA = await requireBranch(
    cashierScope,
    branchAId,
    PERMISSIONS.reportViewBranch,
  );
  const cashierAccessB = await requireBranch(
    ownerScope,
    branchBId,
    PERMISSIONS.reportViewBranch,
  );
  const cashierSaleAccessA = await requireBranch(
    cashierScope,
    branchAId,
    PERMISSIONS.saleCreate,
  );
  const ownerAccessA = await requireBranch(
    ownerScope,
    branchAId,
    PERMISSIONS.reportViewBranch,
  );
  const ownerAccessB = await requireBranch(
    ownerScope,
    branchBId,
    PERMISSIONS.reportViewBranch,
  );

  const medicineId = randomUUID();
  await db.insert(medicines).values({
    id: medicineId,
    organizationId,
    name: `sales-history-medicine-${randomUUID()}`,
    dosageForm: "tablet",
    status: "active",
    classification: "OTC",
    unitPricePesewas: 1250,
  });

  const batchAId = randomUUID();
  const batchA2Id = randomUUID();
  const batchBId = randomUUID();
  const batchANumber = `SH-A-${randomUUID()}`;
  const batchA2Number = `SH-A2-${randomUUID()}`;
  const batchBNumber = `SH-B-${randomUUID()}`;
  const batchAExpiry = dateDaysBefore(-30);
  const batchA2Expiry = dateDaysBefore(-45);
  const batchBExpiry = dateDaysBefore(-60);
  await db.insert(batches).values([
    {
      id: batchAId,
      organizationId,
      branchId: branchAId,
      medicineId,
      batchNumber: batchANumber,
      expiryDate: batchAExpiry,
      unitCostPesewas: 500,
      quantityOnHand: 1000,
    },
    {
      id: batchA2Id,
      organizationId,
      branchId: branchAId,
      medicineId,
      batchNumber: batchA2Number,
      expiryDate: batchA2Expiry,
      unitCostPesewas: 500,
      quantityOnHand: 1000,
    },
    {
      id: batchBId,
      organizationId,
      branchId: branchBId,
      medicineId,
      batchNumber: batchBNumber,
      expiryDate: batchBExpiry,
      unitCostPesewas: 500,
      quantityOnHand: 1000,
    },
  ]);

  return {
    organizationId,
    branchAId,
    branchBId,
    cashierId,
    ownerId,
    cashierScope,
    ownerScope,
    cashierAccessA,
    cashierAccessB,
    cashierSaleAccessA,
    ownerAccessA,
    ownerAccessB,
    medicineId,
    batchAId,
    batchA2Id,
    batchBId,
    batchANumber,
    batchA2Number,
    batchBNumber,
    batchAExpiry,
    batchA2Expiry,
    batchBExpiry,
  };
}

interface SeedLine {
  batchId: string;
  quantity: number;
  unitPricePesewas: number;
}

interface SeedSaleOptions {
  branchId: string;
  cashierId: string;
  createdAt: Date;
  lines: readonly SeedLine[];
  paymentMethod: "cash" | "momo";
  reference?: string;
  tenderedPesewas?: number;
}

async function seedSale(
  fixture: Fixture,
  options: SeedSaleOptions,
): Promise<{ saleId: string; totalPesewas: number }> {
  let totalPesewas = 0;
  for (const line of options.lines) {
    const lineTotal = line.quantity * line.unitPricePesewas;
    if (!Number.isSafeInteger(lineTotal)) {
      throw new RangeError("Fixture line total exceeds the supported money range.");
    }
    totalPesewas += lineTotal;
  }
  if (!Number.isSafeInteger(totalPesewas)) {
    throw new RangeError("Fixture sale total exceeds the supported money range.");
  }

  const saleId = randomUUID();
  const saleNumber = await nextSaleNumber(
    db,
    fixture.organizationId,
    options.branchId,
    accraToday(options.createdAt),
  );
  await db.insert(sales).values({
    id: saleId,
    organizationId: fixture.organizationId,
    branchId: options.branchId,
    cashierId: options.cashierId,
    idempotencyKey: `sales-history-${randomUUID()}`,
    saleNumber,
    totalPesewas,
    paymentMethod: options.paymentMethod,
    createdAt: options.createdAt,
  });

  for (const line of options.lines) {
    await db.insert(saleLines).values({
      saleId,
      medicineId: fixture.medicineId,
      batchId: line.batchId,
      quantity: line.quantity,
      unitPricePesewas: line.unitPricePesewas,
      lineTotalPesewas: line.quantity * line.unitPricePesewas,
    });
    await db.insert(stockMovements).values({
      organizationId: fixture.organizationId,
      branchId: options.branchId,
      batchId: line.batchId,
      movementType: "sale",
      quantityDelta: -line.quantity,
      referenceId: saleId,
      createdBy: options.cashierId,
    });
  }

  await db.insert(payments).values({
    saleId,
    amountPesewas: options.tenderedPesewas ?? totalPesewas,
    method: options.paymentMethod,
    reference:
      options.paymentMethod === "momo" ? (options.reference ?? null) : null,
  });

  return { saleId, totalPesewas };
}

function defaultLine(fixture: Fixture): SeedLine {
  return { batchId: fixture.batchAId, quantity: 2, unitPricePesewas: 1250 };
}

type RowCounts = Record<
  "sales" | "saleLines" | "payments" | "stockMovements" | "auditEvents",
  number
>;

async function rowCounts(fixture: Fixture): Promise<RowCounts> {
  const [saleRows, lineRows, paymentRows, movementRows, auditRows] =
    await Promise.all([
      db
        .select({ id: sales.id })
        .from(sales)
        .where(eq(sales.organizationId, fixture.organizationId)),
      db
        .select({ id: saleLines.id })
        .from(saleLines)
        .innerJoin(sales, eq(saleLines.saleId, sales.id))
        .where(eq(sales.organizationId, fixture.organizationId)),
      db
        .select({ id: payments.id })
        .from(payments)
        .innerJoin(sales, eq(payments.saleId, sales.id))
        .where(eq(sales.organizationId, fixture.organizationId)),
      db
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(eq(stockMovements.organizationId, fixture.organizationId)),
      db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, fixture.organizationId)),
    ]);

  return {
    sales: saleRows.length,
    saleLines: lineRows.length,
    payments: paymentRows.length,
    stockMovements: movementRows.length,
    auditEvents: auditRows.length,
  };
}

async function expectNoWrites<T>(
  fixture: Fixture,
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  const before = await rowCounts(fixture);
  const result = await run();
  const after = await rowCounts(fixture);
  expect(after, `${label}: sales, lines, payments, movements, and audit counts`).toEqual(
    before,
  );
  return result;
}

function moneyValuesIn(value: unknown, label: string): number[] {
  const found: number[] = [];
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (current === null || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (/Pesewas$|Pesewas\b/.test(key) && typeof child === "number") {
        expectSafeInteger(child, `${label}.${path}${key}`);
        expect(child, `${label}.${path}${key} must be nonnegative`).toBeGreaterThanOrEqual(
          0,
        );
        found.push(child);
      }
      visit(child, `${path}${key}.`);
    }
  };
  visit(value, "");
  return found;
}

function assertNoCostFields(value: unknown, label: string): void {
  const visit = (current: unknown, path: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (current === null || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      expect(
        key.toLowerCase().includes("cost"),
        `${label}: field ${path}${key} must not expose a cost`,
      ).toBe(false);
      visit(child, `${path}${key}.`);
    }
  };
  visit(value, "");
  expect(JSON.stringify(value), `${label}: serialized value must not expose cost`).not.toMatch(
    /cost/i,
  );
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

describe("sales history", () => {
  it("1. a Branch A cashier cannot list or open Branch B sales", async () => {
    const fixture = await createFixture();
    const { saleId: branchBSaleId } = await seedSale(fixture, {
      branchId: fixture.branchBId,
      cashierId: fixture.ownerId,
      createdAt: timestampDaysBefore(0, 30),
      lines: [{ batchId: fixture.batchBId, quantity: 1, unitPricePesewas: 1250 }],
      paymentMethod: "cash",
    });

    const before = await rowCounts(fixture);
    const listError = await captureError(() =>
      listSales(fixture.cashierScope, fixture.cashierAccessB, {
        fromDate: dateDaysBefore(6),
        toDate: TODAY,
      }),
    );
    const detailError = await captureError(() =>
      getSaleDetail(fixture.cashierScope, fixture.cashierAccessB, branchBSaleId),
    );

    expectForbidden(listError);
    expectForbidden(detailError);

    const scopedPage = await listSales(fixture.cashierScope, fixture.cashierAccessA, {
      fromDate: dateDaysBefore(6),
      toDate: TODAY,
    });
    expect(
      scopedPage.sales.some((sale) => sale.saleId === branchBSaleId),
      "Branch A list must not contain a Branch B sale",
    ).toBe(false);

    const after = await rowCounts(fixture);
    expect(
      { ...after, auditEvents: after.auditEvents - 2 },
      "denials append only the two expected access.denied audit rows",
    ).toEqual(before);
  });

  it("2. listSales is newest first, caps pages at 50, and paginates by cursor without duplicates or gaps", async () => {
    const fixture = await createFixture();
    const seeded: { saleId: string; createdAt: string }[] = [];
    for (let index = 0; index < 55; index += 1) {
      const createdAt = timestampDaysBefore(0, index);
      const { saleId } = await seedSale(fixture, {
        branchId: fixture.branchAId,
        cashierId: fixture.cashierId,
        createdAt,
        lines: [defaultLine(fixture)],
        paymentMethod: "cash",
      });
      seeded.push({ saleId, createdAt: createdAt.toISOString() });
    }

    const first = await listSales(fixture.cashierScope, fixture.cashierAccessA, {});
    expect(first.sales).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const firstTimes = first.sales.map((sale) => Date.parse(sale.createdAt));
    for (let index = 1; index < firstTimes.length; index += 1) {
      expect(
        firstTimes[index - 1] >= firstTimes[index],
        `first page not newest first at index ${index}`,
      ).toBe(true);
    }

    const second = await listSales(fixture.cashierScope, fixture.cashierAccessA, {
      cursor: first.nextCursor!,
    });
    expect(second.sales).toHaveLength(5);
    expect(second.hasMore).toBe(false);

    const firstIds = first.sales.map((sale) => sale.saleId);
    const secondIds = second.sales.map((sale) => sale.saleId);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(55);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(
      new Set([...firstIds, ...secondIds]),
      "cursor pages must cover every seeded sale exactly once",
    ).toEqual(new Set(seeded.map((sale) => sale.saleId)));

    const boundaryIndex = firstTimes.length - 1;
    const oldestFirstTime = firstTimes[boundaryIndex];
    for (const sale of second.sales) {
      expect(Date.parse(sale.createdAt), "second page must be older than first page").toBeLessThanOrEqual(
        oldestFirstTime,
      );
    }
  });

  it("3. each sale total equals the sum of its line totals", async () => {
    const fixture = await createFixture();
    const seeded: { saleId: string; totalPesewas: number }[] = [];
    seeded.push(
      await seedSale(fixture, {
        branchId: fixture.branchAId,
        cashierId: fixture.cashierId,
        createdAt: timestampDaysBefore(0, 1),
        lines: [
          { batchId: fixture.batchAId, quantity: 2, unitPricePesewas: 1250 },
          { batchId: fixture.batchAId, quantity: 3, unitPricePesewas: 750 },
        ],
        paymentMethod: "cash",
        tenderedPesewas: 5000,
      }),
    );
    seeded.push(
      await seedSale(fixture, {
        branchId: fixture.branchAId,
        cashierId: fixture.cashierId,
        createdAt: timestampDaysBefore(0, 2),
        lines: [{ batchId: fixture.batchAId, quantity: 4, unitPricePesewas: 1000 }],
        paymentMethod: "momo",
        reference: `SH-SUM-${randomUUID()}`,
      }),
    );

    const page = await listSales(fixture.cashierScope, fixture.cashierAccessA, {});
    expect(page.sales).toHaveLength(seeded.length);

    for (const row of page.sales) {
      const storedLines = await db
        .select({ lineTotalPesewas: saleLines.lineTotalPesewas })
        .from(saleLines)
        .where(eq(saleLines.saleId, row.saleId));
      const storedSum = storedLines.reduce(
        (sum, line) => sum + line.lineTotalPesewas,
        0,
      );
      expect(row.totalPesewas, `stored line sum for ${row.saleId}`).toBe(storedSum);

      const detail = await getSaleDetail(
        fixture.cashierScope,
        fixture.cashierAccessA,
        row.saleId,
      );
      const detailSum = detail.lines.reduce(
        (sum, line) => sum + line.lineTotalPesewas,
        0,
      );
      expect(detail.sale.totalPesewas, `detail line sum for ${row.saleId}`).toBe(
        detailSum,
      );
      expect(row.totalPesewas, `list and detail totals for ${row.saleId}`).toBe(
        detail.sale.totalPesewas,
      );
    }
  });

  it("4. detail lines carry the batch number and expiry matching the sale movement", async () => {
    const fixture = await createFixture();
    const { saleId } = await seedSale(fixture, {
      branchId: fixture.branchAId,
      cashierId: fixture.cashierId,
      createdAt: timestampDaysBefore(0, 3),
      lines: [
        { batchId: fixture.batchAId, quantity: 2, unitPricePesewas: 1250 },
        { batchId: fixture.batchA2Id, quantity: 1, unitPricePesewas: 2500 },
      ],
      paymentMethod: "cash",
    });

    const detail = await getSaleDetail(
      fixture.cashierScope,
      fixture.cashierAccessA,
      saleId,
    );
    expect(detail.lines).toHaveLength(2);

    const batchesById = new Map([
      [fixture.batchAId, { number: fixture.batchANumber, expiry: fixture.batchAExpiry }],
      [fixture.batchA2Id, { number: fixture.batchA2Number, expiry: fixture.batchA2Expiry }],
    ]);
    const byBatchNumber = new Map(
      detail.lines.map((line) => [line.batchNumber, line]),
    );
    expect(new Set(byBatchNumber.keys())).toEqual(
      new Set([fixture.batchANumber, fixture.batchA2Number]),
    );

    for (const [batchId, expected] of batchesById) {
      const line = byBatchNumber.get(expected.number);
      expect(line, `detail line for batch ${expected.number}`).toBeDefined();
      expect(line!.expiryDate).toBe(expected.expiry);

      const storedLine = await db
        .select()
        .from(saleLines)
        .where(and(eq(saleLines.saleId, saleId), eq(saleLines.batchId, batchId)));
      expect(storedLine).toHaveLength(1);
      expect(line!.quantity).toBe(storedLine[0].quantity);
      expect(line!.unitPricePesewas).toBe(storedLine[0].unitPricePesewas);

      const movements = await db
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.referenceId, saleId),
            eq(stockMovements.batchId, batchId),
            eq(stockMovements.movementType, "sale"),
          ),
        );
      expect(movements, `sale movement for batch ${expected.number}`).toHaveLength(1);
      expect(movements[0].quantityDelta).toBe(-line!.quantity);
    }

    const allMovements = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.referenceId, saleId));
    expect(allMovements).toHaveLength(detail.lines.length);
  });

  it("5. a seven-day filter excludes an eight-day-old sale and includes a six-day-old sale", async () => {
    const fixture = await createFixture();
    const excluded = await seedSale(fixture, {
      branchId: fixture.branchAId,
      cashierId: fixture.cashierId,
      createdAt: timestampDaysBefore(8),
      lines: [{ batchId: fixture.batchAId, quantity: 8, unitPricePesewas: 1000 }],
      paymentMethod: "cash",
    });
    const included = await seedSale(fixture, {
      branchId: fixture.branchAId,
      cashierId: fixture.cashierId,
      createdAt: timestampDaysBefore(6),
      lines: [{ batchId: fixture.batchAId, quantity: 6, unitPricePesewas: 1000 }],
      paymentMethod: "cash",
    });

    const page = await listSales(fixture.cashierScope, fixture.cashierAccessA, {
      fromDate: dateDaysBefore(6),
      toDate: TODAY,
    });
    const ids = page.sales.map((sale) => sale.saleId);

    expect(ids, "six-day-old sale must be included").toContain(included.saleId);
    expect(ids, "eight-day-old sale must be excluded").not.toContain(excluded.saleId);
    expect(page.sales).toHaveLength(1);
  });

  it("6. a MoMo sale returns its reference and a cash sale returns none", async () => {
    const fixture = await createFixture();
    const reference = `SH-MOMO-${randomUUID()}`;
    const momo = await seedSale(fixture, {
      branchId: fixture.branchAId,
      cashierId: fixture.cashierId,
      createdAt: timestampDaysBefore(0, 10),
      lines: [defaultLine(fixture)],
      paymentMethod: "momo",
      reference,
    });
    const cash = await seedSale(fixture, {
      branchId: fixture.branchAId,
      cashierId: fixture.cashierId,
      createdAt: timestampDaysBefore(0, 11),
      lines: [defaultLine(fixture)],
      paymentMethod: "cash",
      tenderedPesewas: 5000,
    });

    const page = await listSales(fixture.cashierScope, fixture.cashierAccessA, {});
    const momoRow = page.sales.find((sale) => sale.saleId === momo.saleId);
    const cashRow = page.sales.find((sale) => sale.saleId === cash.saleId);
    expect(momoRow).toBeDefined();
    expect(cashRow).toBeDefined();
    expect(momoRow!.paymentMethod).toBe("momo");
    expect(momoRow!.momoReference).toBe(reference);
    expect(cashRow!.paymentMethod).toBe("cash");
    expect(cashRow!.momoReference).toBeUndefined();
    expect(cashRow).not.toHaveProperty("momoReference");
    expect(cashRow!.cashTenderedPesewas).toBe(5000);
    expect(cashRow!.changePesewas).toBe(2500);

    const momoDetail = await getSaleDetail(
      fixture.cashierScope,
      fixture.cashierAccessA,
      momo.saleId,
    );
    const cashDetail = await getSaleDetail(
      fixture.cashierScope,
      fixture.cashierAccessA,
      cash.saleId,
    );
    expect(momoDetail.sale.momoReference).toBe(reference);
    expect(cashDetail.sale.momoReference).toBeUndefined();
    expect(cashDetail.sale).not.toHaveProperty("momoReference");
  });

  it("7. no list row or detail contains a unit cost field", async () => {
    const fixture = await createFixture();
    const { saleId } = await seedSale(fixture, {
      branchId: fixture.branchAId,
      cashierId: fixture.cashierId,
      createdAt: timestampDaysBefore(0, 12),
      lines: [defaultLine(fixture)],
      paymentMethod: "cash",
    });

    const page = await listSales(fixture.cashierScope, fixture.cashierAccessA, {});
    expect(page.sales.length).toBeGreaterThan(0);
    for (const row of page.sales) {
      assertNoCostFields(row, `list row ${row.saleId}`);
      expect(Object.keys(row)).not.toContain("unitCostPesewas");
      expect(row).not.toHaveProperty("unitCostPesewas");
    }

    const detail = await getSaleDetail(
      fixture.cashierScope,
      fixture.cashierAccessA,
      saleId,
    );
    assertNoCostFields(detail, `detail ${saleId}`);
    expect(detail.lines.every((line) => !("unitCostPesewas" in line))).toBe(true);
    expect("unitCostPesewas" in detail.sale).toBe(false);
  });

  it("8. every money value returned by history is a safe integer", async () => {
    const fixture = await createFixture();
    await seedSale(fixture, {
      branchId: fixture.branchAId,
      cashierId: fixture.cashierId,
      createdAt: timestampDaysBefore(0, 13),
      lines: [defaultLine(fixture)],
      paymentMethod: "cash",
      tenderedPesewas: 5000,
    });
    await seedSale(fixture, {
      branchId: fixture.branchAId,
      cashierId: fixture.cashierId,
      createdAt: timestampDaysBefore(0, 14),
      lines: [defaultLine(fixture)],
      paymentMethod: "momo",
      reference: `SH-SAFE-${randomUUID()}`,
    });

    const page = await listSales(fixture.cashierScope, fixture.cashierAccessA, {});
    const listValues = page.sales.flatMap((row) => moneyValuesIn(row, `list ${row.saleId}`));
    expect(listValues.length).toBeGreaterThan(0);

    let detailValueCount = 0;
    for (const row of page.sales) {
      const detail = await getSaleDetail(
        fixture.cashierScope,
        fixture.cashierAccessA,
        row.saleId,
      );
      expectSafeInteger(detail.sale.lineCount, `detail ${row.saleId} lineCount`);
      detailValueCount += moneyValuesIn(detail, `detail ${row.saleId}`).length;
    }
    expect(detailValueCount).toBeGreaterThan(0);
  });

  it("9. every exported sales-history function takes scope then access as its first two parameters", () => {
    const filePath = join(
      process.cwd(),
      "src",
      "server",
      "data",
      "sales-history.ts",
    );
    const source = readFileSync(filePath, "utf8");
    const parsed = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const functions: {
      name: string;
      first: { name: string; type: string | undefined } | undefined;
      second: { name: string; type: string | undefined } | undefined;
    }[] = [];

    const describeParameter = (parameter: ts.ParameterDeclaration | undefined) =>
      parameter
        ? {
            name: parameter.name.getText(parsed),
            type: parameter.type?.getText(parsed),
          }
        : undefined;

    const visit = (node: ts.Node): void => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        isExported(node)
      ) {
        functions.push({
          name: node.name.text,
          first: describeParameter(node.parameters[0]),
          second: describeParameter(node.parameters[1]),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);

    expect(functions.length, "sales-history.ts must export functions").toBeGreaterThan(0);
    expect(new Set(functions.map((fn) => fn.name))).toEqual(
      new Set(["listSales", "listSaleCashiers", "getSaleDetail"]),
    );
    for (const fn of functions) {
      expect(fn.first?.name, `${fn.name}: first parameter name`).toBe("scope");
      expect(fn.first?.type, `${fn.name}: first parameter type`).toBe("DataScope");
      expect(fn.second?.name, `${fn.name}: second parameter name`).toBe("access");
      expect(fn.second?.type, `${fn.name}: second parameter type`).toBe(
        "AuthorizedBranch",
      );
    }
  });

  it("10. history reads change no sales, lines, payments, movements, or audit rows", async () => {
    const fixture = await createFixture();
    const { saleId } = await seedSale(fixture, {
      branchId: fixture.branchAId,
      cashierId: fixture.cashierId,
      createdAt: timestampDaysBefore(0, 15),
      lines: [defaultLine(fixture)],
      paymentMethod: "cash",
    });
    const first = await expectNoWrites(fixture, "listSales", () =>
      listSales(fixture.cashierScope, fixture.cashierAccessA, {}),
    );
    expect(first.sales.length).toBeGreaterThan(0);

    const cashiers = await expectNoWrites(fixture, "listSaleCashiers", () =>
      listSaleCashiers(fixture.cashierScope, fixture.cashierAccessA),
    );
    expect(cashiers.some((cashier) => cashier.id === fixture.cashierId)).toBe(true);

    const detail = await expectNoWrites(fixture, "getSaleDetail", () =>
      getSaleDetail(fixture.cashierScope, fixture.cashierAccessA, saleId),
    );
    expect(detail.sale.saleId).toBe(saleId);

    const filtered = await expectNoWrites(fixture, "listSales with filters", () =>
      listSales(fixture.cashierScope, fixture.cashierAccessA, {
        fromDate: dateDaysBefore(6),
        toDate: TODAY,
        paymentMethod: "cash",
        cashierId: fixture.cashierId,
      }),
    );
    expect(filtered.sales.length).toBe(1);

    await expectNoWrites(fixture, "listSales with cursor", () =>
      listSales(fixture.cashierScope, fixture.cashierAccessA, {
        cursor: `${first.sales[0].cursorTimestamp}|${first.sales[0].saleId}`,
      }),
    );
  });
});
