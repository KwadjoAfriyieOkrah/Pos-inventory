import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { batches, branches, medicines, saleLines, sales } from "../../../db/schema";
import { db } from "@/server/db/client";
import { PERMISSIONS } from "./permissions";
import { requireBranch, type AuthorizedBranch, type DataScope } from "./scope";

export type DashboardBatch = {
  id: string;
  batchNumber: string;
  medicineName: string;
  expiryDate: string;
  quantityOnHand: number;
};

export type BranchDashboard = {
  branchId: string;
  branchName: string;
  salesCount: number;
  salesTotalPesewas: number;
  topMedicines: { medicineName: string; unitsSold: number }[];
  batches: DashboardBatch[];
};

function assertAggregate(value: unknown, label: string): number {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`${label} exceeds the supported integer range.`);
  }
  return amount;
}

function startOfWindow(today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new RangeError("Dashboard date must be in YYYY-MM-DD format.");
  }
  const parsed = new Date(`${today}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== today
  ) {
    throw new RangeError("Dashboard date must be a valid ISO calendar date.");
  }
  parsed.setUTCDate(parsed.getUTCDate() - 6);
  return parsed.toISOString().slice(0, 10);
}

export async function branchDashboard(
  scope: DataScope,
  access: AuthorizedBranch,
  today: string,
): Promise<BranchDashboard> {
  access = await requireBranch(
    scope,
    access.branchId,
    PERMISSIONS.reportViewBranch,
  );
  const firstDay = startOfWindow(today);
  const inDateWindow = sql`(${sales.createdAt} at time zone 'Africa/Accra')::date between ${firstDay}::date and ${today}::date`;

  const [totals] = await db
    .select({
      salesCount: sql<string>`count(*)::text`,
      salesTotalPesewas: sql<string>`coalesce(sum(${sales.totalPesewas}), 0)::text`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.organizationId, access.organizationId),
        eq(sales.branchId, access.branchId),
        inDateWindow,
      ),
    );
  const topRows = await db
    .select({
      medicineName: medicines.name,
      unitsSold: sql<string>`sum(${saleLines.quantity})::text`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .innerJoin(
      medicines,
      and(
        eq(medicines.id, saleLines.medicineId),
        eq(medicines.organizationId, access.organizationId),
      ),
    )
    .where(
      and(
        eq(sales.organizationId, access.organizationId),
        eq(sales.branchId, access.branchId),
        inDateWindow,
      ),
    )
    .groupBy(medicines.id, medicines.name)
    .orderBy(desc(sql`sum(${saleLines.quantity})`), asc(medicines.name))
    .limit(5);
  const batchRows = await db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      medicineName: medicines.name,
      expiryDate: batches.expiryDate,
      quantityOnHand: batches.quantityOnHand,
    })
    .from(batches)
    .innerJoin(
      medicines,
      and(
        eq(medicines.id, batches.medicineId),
        eq(medicines.organizationId, batches.organizationId),
      ),
    )
    .where(
      and(
        eq(batches.organizationId, access.organizationId),
        eq(batches.branchId, access.branchId),
      ),
    )
    .orderBy(asc(medicines.name), asc(batches.expiryDate));
  const [branch] = await db
    .select({ name: branches.name })
    .from(branches)
    .where(
      and(
        eq(branches.id, access.branchId),
        eq(branches.organizationId, access.organizationId),
      ),
    )
    .limit(1);

  if (!branch) {
    throw new Error("Authorized branch no longer exists in its organization.");
  }

  return {
    branchId: access.branchId,
    branchName: branch.name,
    salesCount: assertAggregate(totals.salesCount, "Sales count"),
    salesTotalPesewas: assertAggregate(
      totals.salesTotalPesewas,
      "Sales total",
    ),
    topMedicines: topRows.map((row) => ({
      medicineName: row.medicineName,
      unitsSold: assertAggregate(row.unitsSold, "Medicine units sold"),
    })),
    batches: batchRows,
  };
}
