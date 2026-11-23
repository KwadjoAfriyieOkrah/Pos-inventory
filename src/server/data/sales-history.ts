import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  batches,
  branches,
  medicines,
  payments,
  saleLines,
  sales,
  users,
} from "../../../db/schema";
import { accraToday } from "@/lib/time";
import { db } from "@/server/db/client";
import { PERMISSIONS } from "./permissions";
import { ForbiddenError } from "./errors";
import {
  requireBranch,
  type AuthorizedBranch,
  type DataScope,
} from "./scope";

export class SalesHistoryFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesHistoryFilterError";
  }
}

export type SalesHistoryFilters = {
  fromDate?: string;
  toDate?: string;
  paymentMethod?: string;
  cashierId?: string;
  cursor?: string;
};

export type NormalizedSalesHistoryFilters = {
  fromDate: string;
  toDate: string;
  paymentMethod: "" | "cash" | "momo";
  cashierId: string;
  cursor?: string;
};

export type SaleHistoryRow = {
  saleId: string;
  saleNumber: string;
  createdAt: string;
  cashierName: string;
  paymentMethod: "cash" | "momo";
  totalPesewas: number;
  lineCount: number;
  branchId: string;
  branchName: string;
  cursorTimestamp?: string;
  momoReference?: string;
  cashTenderedPesewas?: number;
  changePesewas?: number;
};

export type SalesHistoryPageData = {
  sales: SaleHistoryRow[];
  nextCursor: string | null;
  hasMore: boolean;
  filters: NormalizedSalesHistoryFilters;
};

export type SaleCashier = {
  id: string;
  name: string;
};

export type SaleDetailLine = {
  medicineName: string;
  quantity: number;
  unitPricePesewas: number;
  lineTotalPesewas: number;
  batchNumber: string;
  expiryDate: string;
};

export type SaleDetailData = {
  sale: SaleHistoryRow;
  lines: SaleDetailLine[];
};

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function daysBefore(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function normalizeFilters(
  filters: SalesHistoryFilters,
): NormalizedSalesHistoryFilters {
  const schema = z.object({
    fromDate: z.string().refine(isDateOnly).optional(),
    toDate: z.string().refine(isDateOnly).optional(),
    paymentMethod: z.enum(["", "cash", "momo"]).optional(),
    cashierId: z.union([z.literal(""), z.string().uuid()]).optional(),
    cursor: z.string().optional(),
  });
  const parsed = schema.safeParse(filters);
  if (!parsed.success) {
    throw new SalesHistoryFilterError("Select valid sales history filters.");
  }

  const today = accraToday();
  const fromDate = parsed.data.fromDate ?? daysBefore(today, 29);
  const toDate = parsed.data.toDate ?? today;
  if (fromDate > toDate || toDate > today) {
    throw new SalesHistoryFilterError(
      "Choose an Accra date range ending today or earlier.",
    );
  }

  let cursor: string | undefined;
  if (parsed.data.cursor) {
    const splitAt = parsed.data.cursor.lastIndexOf("|");
    const createdAt = parsed.data.cursor.slice(0, splitAt);
    const saleId = parsed.data.cursor.slice(splitAt + 1);
    const date = new Date(createdAt);
    if (
      splitAt < 1 ||
      !Number.isFinite(date.getTime()) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(createdAt) ||
      date.toISOString().slice(0, 23) !== createdAt.slice(0, 23) ||
      !z.string().uuid().safeParse(saleId).success
    ) {
      throw new SalesHistoryFilterError("The sales history cursor is invalid.");
    }
    cursor = `${createdAt}|${saleId}`;
  }

  return {
    fromDate,
    toDate,
    paymentMethod: parsed.data.paymentMethod ?? "",
    cashierId: parsed.data.cashierId ?? "",
    ...(cursor ? { cursor } : {}),
  };
}

function cursorForSale(sale: {
  cursorTimestamp: string;
  saleId: string;
}): string {
  return `${sale.cursorTimestamp}|${sale.saleId}`;
}

function assertSafePesewas(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Sale amount exceeds the supported money range.");
  }
}

function paymentDetails(
  method: string,
  totalPesewas: number,
  amountPesewas: number | null,
  reference: string | null,
): Pick<
  SaleHistoryRow,
  "paymentMethod" | "momoReference" | "cashTenderedPesewas" | "changePesewas"
> {
  if (method !== "cash" && method !== "momo") {
    throw new Error("Stored sale has an unsupported payment method.");
  }

  if (amountPesewas === null || !Number.isSafeInteger(amountPesewas)) {
    throw new Error("Stored sale payment is inconsistent.");
  }

  if (method === "momo") {
    if (!reference) {
      throw new Error("Stored MoMo payment reference is missing.");
    }
    return { paymentMethod: "momo", momoReference: reference };
  }

  const changePesewas = amountPesewas - totalPesewas;
  if (!Number.isSafeInteger(changePesewas) || changePesewas < 0) {
    throw new Error("Stored sale change is inconsistent.");
  }

  return {
    paymentMethod: "cash",
    cashTenderedPesewas: amountPesewas,
    changePesewas,
  };
}

export async function listSales(
  scope: DataScope,
  access: AuthorizedBranch,
  filters: SalesHistoryFilters = {},
): Promise<SalesHistoryPageData> {
  access = await requireBranch(
    scope,
    access.branchId,
    PERMISSIONS.reportViewBranch,
  );
  const normalized = normalizeFilters(filters);
  const conditions = [
    eq(sales.organizationId, access.organizationId),
    eq(sales.branchId, access.branchId),
    sql`(${sales.createdAt} AT TIME ZONE 'Africa/Accra')::date >= ${normalized.fromDate}::date`,
    sql`(${sales.createdAt} AT TIME ZONE 'Africa/Accra')::date <= ${normalized.toDate}::date`,
  ];

  if (normalized.paymentMethod) {
    conditions.push(eq(sales.paymentMethod, normalized.paymentMethod));
  }
  if (normalized.cashierId) {
    conditions.push(eq(sales.cashierId, normalized.cashierId));
  }
  if (normalized.cursor) {
    const [createdAt, saleId] = normalized.cursor.split("|");
    const cursorTimestamp = sql`${createdAt}::timestamptz`;
    conditions.push(
      or(
        sql`${sales.createdAt} < ${cursorTimestamp}`,
        and(sql`${sales.createdAt} = ${cursorTimestamp}`, lt(sales.id, saleId)),
      ) ?? sql`false`,
    );
  }

  const rows = await db
    .select({
      saleId: sales.id,
      createdAt: sales.createdAt,
      cursorTimestamp: sql<string>`to_char(${sales.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      cashierName: users.fullName,
      paymentMethod: sales.paymentMethod,
      totalPesewas: sales.totalPesewas,
      lineCount: sql<string>`count(${saleLines.id})::text`,
      branchId: sales.branchId,
      branchName: branches.name,
      paymentAmountPesewas: payments.amountPesewas,
      paymentMethodRecorded: payments.method,
      reference: payments.reference,
    })
    .from(sales)
    .innerJoin(
      users,
      and(eq(users.id, sales.cashierId), eq(users.organizationId, sales.organizationId)),
    )
    .innerJoin(
      branches,
      and(
        eq(branches.id, sales.branchId),
        eq(branches.organizationId, sales.organizationId),
      ),
    )
    .leftJoin(payments, eq(payments.saleId, sales.id))
    .leftJoin(saleLines, eq(saleLines.saleId, sales.id))
    .where(and(...conditions))
    .groupBy(sales.id, users.id, branches.id, payments.id)
    .orderBy(desc(sales.createdAt), desc(sales.id))
    .limit(51);

  const hasMore = rows.length > 50;
  const pageRows = rows.slice(0, 50).map((row) => {
    const totalPesewas = row.totalPesewas;
    assertSafePesewas(totalPesewas);
    const lineCount = Number(row.lineCount);
    if (!Number.isSafeInteger(lineCount) || lineCount < 0) {
      throw new RangeError("Sale line count exceeds the supported range.");
    }
    if (row.paymentMethod !== row.paymentMethodRecorded) {
      throw new Error("Stored sale payment method is inconsistent.");
    }

    return {
      saleId: row.saleId,
      saleNumber: row.saleId,
      createdAt: row.createdAt.toISOString(),
      cashierName: row.cashierName,
      totalPesewas,
      lineCount,
      branchId: row.branchId,
      branchName: row.branchName,
      cursorTimestamp: row.cursorTimestamp,
      ...paymentDetails(
        row.paymentMethod,
        totalPesewas,
        row.paymentAmountPesewas,
        row.reference,
      ),
    };
  });

  return {
    sales: pageRows,
    hasMore,
    nextCursor:
      hasMore && pageRows.length > 0
      ? cursorForSale(pageRows[pageRows.length - 1])
        : null,
    filters: normalized,
  };
}

export async function listSaleCashiers(
  scope: DataScope,
  access: AuthorizedBranch,
): Promise<SaleCashier[]> {
  access = await requireBranch(
    scope,
    access.branchId,
    PERMISSIONS.reportViewBranch,
  );

  return db
    .selectDistinct({ id: users.id, name: users.fullName })
    .from(sales)
    .innerJoin(
      users,
      and(eq(users.id, sales.cashierId), eq(users.organizationId, sales.organizationId)),
    )
    .where(
      and(
        eq(sales.organizationId, access.organizationId),
        eq(sales.branchId, access.branchId),
      ),
    )
    .orderBy(asc(users.fullName));
}

export async function getSaleDetail(
  scope: DataScope,
  access: AuthorizedBranch,
  saleId: string,
): Promise<SaleDetailData> {
  access = await requireBranch(
    scope,
    access.branchId,
    PERMISSIONS.reportViewBranch,
  );
  if (!z.string().uuid().safeParse(saleId).success) {
    throw new ForbiddenError();
  }

  const [saleHeader] = await db
    .select({
      saleId: sales.id,
      branchId: sales.branchId,
      branchName: branches.name,
      createdAt: sales.createdAt,
      cursorTimestamp: sql<string>`to_char(${sales.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      cashierName: users.fullName,
      paymentMethod: sales.paymentMethod,
      totalPesewas: sales.totalPesewas,
      paymentAmountPesewas: payments.amountPesewas,
      paymentMethodRecorded: payments.method,
      reference: payments.reference,
    })
    .from(sales)
    .innerJoin(
      users,
      and(eq(users.id, sales.cashierId), eq(users.organizationId, sales.organizationId)),
    )
    .innerJoin(
      branches,
      and(
        eq(branches.id, sales.branchId),
        eq(branches.organizationId, sales.organizationId),
      ),
    )
    .leftJoin(payments, eq(payments.saleId, sales.id))
    .where(
      and(
        eq(sales.id, saleId),
        eq(sales.organizationId, access.organizationId),
      ),
    )
    .limit(1);

  if (!saleHeader) throw new ForbiddenError();
  if (saleHeader.branchId !== access.branchId) {
    await requireBranch(
      scope,
      saleHeader.branchId,
      PERMISSIONS.reportViewBranch,
    );
    throw new ForbiddenError();
  }

  const rows = await db
    .select({
      medicineName: medicines.name,
      quantity: saleLines.quantity,
      unitPricePesewas: saleLines.unitPricePesewas,
      lineTotalPesewas: saleLines.lineTotalPesewas,
      batchNumber: batches.batchNumber,
      expiryDate: batches.expiryDate,
    })
    .from(saleLines)
    .innerJoin(
      medicines,
      and(
        eq(medicines.id, saleLines.medicineId),
        eq(medicines.organizationId, access.organizationId),
      ),
    )
    .innerJoin(
      batches,
      and(
        eq(batches.id, saleLines.batchId),
        eq(batches.organizationId, access.organizationId),
        eq(batches.branchId, access.branchId),
      ),
    )
    .where(eq(saleLines.saleId, saleHeader.saleId))
    .orderBy(asc(medicines.name), asc(batches.expiryDate), asc(batches.batchNumber));

  const lines = rows.map((line) => {
    assertSafePesewas(line.unitPricePesewas);
    assertSafePesewas(line.lineTotalPesewas);
    return line;
  });
  const totalPesewas = saleHeader.totalPesewas;
  assertSafePesewas(totalPesewas);
  if (saleHeader.paymentMethod !== saleHeader.paymentMethodRecorded) {
    throw new Error("Stored sale payment method is inconsistent.");
  }

  return {
    sale: {
      saleId: saleHeader.saleId,
      saleNumber: saleHeader.saleId,
      createdAt: saleHeader.createdAt.toISOString(),
      cursorTimestamp: saleHeader.cursorTimestamp,
      cashierName: saleHeader.cashierName,
      totalPesewas,
      lineCount: lines.length,
      branchId: saleHeader.branchId,
      branchName: saleHeader.branchName,
      ...paymentDetails(
        saleHeader.paymentMethod,
        totalPesewas,
        saleHeader.paymentAmountPesewas,
        saleHeader.reference,
      ),
    },
    lines,
  };
}
