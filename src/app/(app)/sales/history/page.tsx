import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/server/auth";
import { loadScope } from "@/server/auth/scope";
import { accraToday } from "@/lib/time";
import {
  getSaleDetail,
  listSaleCashiers,
  listSales,
  SalesHistoryFilterError,
  type NormalizedSalesHistoryFilters,
  type SaleHistoryRow,
  type SalesHistoryPageData,
  type SalesHistoryFilters,
} from "@/server/data/sales-history";
import { ForbiddenError } from "@/server/data/errors";
import { PERMISSIONS } from "@/server/data/permissions";
import { can, requireBranch } from "@/server/data/scope";
import { SaleDetail } from "@/features/sales/SaleDetail";
import { SalesHistory } from "@/features/sales/SalesHistory";

type SalesHistoryPageProps = {
  searchParams: Promise<{
    fromDate?: string | string[];
    toDate?: string | string[];
    paymentMethod?: string | string[];
    cashierId?: string | string[];
    cursor?: string | string[];
    saleId?: string | string[];
  }>;
};

function queryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function defaultFilters(): NormalizedSalesHistoryFilters {
  const today = accraToday();
  const start = new Date(`${today}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 29);

  return {
    fromDate: start.toISOString().slice(0, 10),
    toDate: today,
    paymentMethod: "",
    cashierId: "",
  };
}

function compareSalesNewestFirst(
  left: SaleHistoryRow,
  right: SaleHistoryRow,
): number {
  return (
    (right.cursorTimestamp ?? right.createdAt).localeCompare(
      left.cursorTimestamp ?? left.createdAt,
    ) ||
    right.saleId.localeCompare(left.saleId)
  );
}

function historyHref(filters: NormalizedSalesHistoryFilters): string {
  const query = new URLSearchParams({
    fromDate: filters.fromDate,
    toDate: filters.toDate,
  });
  if (filters.paymentMethod) query.set("paymentMethod", filters.paymentMethod);
  if (filters.cashierId) query.set("cashierId", filters.cashierId);
  if (filters.cursor) query.set("cursor", filters.cursor);
  return `/sales/history?${query.toString()}`;
}

async function SignedInSalesHistory({
  params,
}: {
  params: Awaited<SalesHistoryPageProps["searchParams"]>;
}) {
  await connection();

  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const scope = await loadScope(
    session.user.id,
    session.user.organizationId,
  );
  const branchIds = [...scope.branches.keys()].filter((branchId) =>
    can(scope, branchId, PERMISSIONS.reportViewBranch),
  );

  if (branchIds.length === 0) {
    return (
      <p className="text-sm text-stone-600">
        You do not have access to sales reports for a branch.
      </p>
    );
  }

  const branchAccesses = await Promise.all(
    branchIds.map((branchId) =>
      requireBranch(scope, branchId, PERMISSIONS.reportViewBranch),
    ),
  );
  const fromDate = queryValue(params.fromDate);
  const toDate = queryValue(params.toDate);
  const paymentMethod = queryValue(params.paymentMethod);
  const cashierId = queryValue(params.cashierId);
  const cursor = queryValue(params.cursor);
  const requestedFilters: SalesHistoryFilters = {
    ...(fromDate ? { fromDate } : {}),
    ...(toDate ? { toDate } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(cashierId ? { cashierId } : {}),
    ...(cursor ? { cursor } : {}),
  };

  const cashierLists = await Promise.all(
    branchAccesses.map((access) => listSaleCashiers(scope, access)),
  );
  const cashierMap = new Map(
    cashierLists.flat().map((cashier) => [cashier.id, cashier]),
  );
  const cashiers = [...cashierMap.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  let filterError: string | null = null;
  let filters = defaultFilters();
  let branchPages: SalesHistoryPageData[];
  try {
    branchPages = await Promise.all(
      branchAccesses.map((access) =>
        listSales(scope, access, requestedFilters),
      ),
    );
    filters = branchPages[0].filters;
  } catch (error) {
    if (!(error instanceof SalesHistoryFilterError)) throw error;
    filterError = error.message;
    branchPages = await Promise.all(
      branchAccesses.map((access) => listSales(scope, access)),
    );
  }

  const allRows = branchPages
    .flatMap((page) => page.sales)
    .sort(compareSalesNewestFirst);
  const rows = allRows.slice(0, 50);
  const hasMore =
    allRows.length > 50 || branchPages.some((page) => page.hasMore);
  const lastSale = rows[rows.length - 1];
  const nextCursor =
    hasMore && lastSale
      ? `${lastSale.cursorTimestamp ?? lastSale.createdAt}|${lastSale.saleId}`
      : null;

  const selectedSaleId = queryValue(params.saleId);
  const selectedRow = rows.find((sale) => sale.saleId === selectedSaleId);
  let detail = null;
  let detailError: string | null = null;

  if (selectedSaleId) {
    if (!selectedRow) {
      detailError = "Sale not found in this history page.";
    } else {
      const branchIndex = branchIds.indexOf(selectedRow.branchId);
      const access = branchAccesses[branchIndex];
      try {
        detail = await getSaleDetail(scope, access, selectedSaleId);
      } catch (error) {
        if (!(error instanceof ForbiddenError)) throw error;
        detailError = "You do not have access to this sale.";
      }
    }
  }

  return (
    <SalesHistory
      cashiers={cashiers}
      detailError={detailError}
      filterError={filterError}
      filters={filters}
      nextCursor={nextCursor}
      sales={rows}
      selectedSaleId={selectedSaleId}
    >
      {selectedSaleId ? (
        detail ? (
          <SaleDetail
            backHref={historyHref(filters)}
            detail={detail}
          />
        ) : (
          <div />
        )
      ) : null}
    </SalesHistory>
  );
}

export default async function SalesHistoryPage({
  searchParams,
}: SalesHistoryPageProps) {
  const params = await searchParams;

  return (
    <main className="w-full">
      <Suspense fallback={<p>Loading sales history…</p>}>
        <SignedInSalesHistory params={params} />
      </Suspense>
    </main>
  );
}
