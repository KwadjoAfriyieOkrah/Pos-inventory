import type { ReactNode } from "react";
import Link from "next/link";
import { formatPesewas } from "@/features/sales/format";
import type {
  NormalizedSalesHistoryFilters,
  SaleCashier,
  SaleHistoryRow,
} from "@/server/data/sales-history";

const createdAtFormatter = new Intl.DateTimeFormat("en-GH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Accra",
});

function historyHref(
  filters: NormalizedSalesHistoryFilters,
  options: { cursor?: string; saleId?: string } = {},
): string {
  const params = new URLSearchParams();
  params.set("fromDate", filters.fromDate);
  params.set("toDate", filters.toDate);
  if (filters.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
  if (filters.cashierId) params.set("cashierId", filters.cashierId);
  const cursor = options.cursor ?? filters.cursor;
  if (cursor) params.set("cursor", cursor);
  if (options.saleId) params.set("saleId", options.saleId);
  return `/sales/history?${params.toString()}`;
}

function PaymentSummary({ sale }: { sale: SaleHistoryRow }) {
  return (
    <span className="block text-[11px] text-stone-500">
      {sale.paymentMethod === "momo"
        ? `MoMo · ${sale.momoReference}`
        : `Cash · tendered ${formatPesewas(sale.cashTenderedPesewas ?? 0)} · change ${formatPesewas(sale.changePesewas ?? 0)}`}
    </span>
  );
}

type SalesHistoryProps = {
  sales: readonly SaleHistoryRow[];
  cashiers: readonly SaleCashier[];
  filters: NormalizedSalesHistoryFilters;
  nextCursor: string | null;
  selectedSaleId?: string;
  filterError?: string | null;
  detailError?: string | null;
  children?: ReactNode;
};

export function SalesHistory({
  sales,
  cashiers,
  filters,
  nextCursor,
  selectedSaleId,
  filterError,
  detailError,
  children,
}: SalesHistoryProps) {
  return (
    <div className="pb-16 md:pb-0">
      <div className="mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
          Records / Sales
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Sales history
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Completed sales across branches you can access.
        </p>
      </div>

      <form
        className="mb-7 grid gap-3 border-y border-stone-200 py-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.2fr_auto_auto]"
        method="get"
      >
        <label className="text-xs font-medium text-stone-600">
          From
          <input
            className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white/70 px-3 text-sm text-stone-900"
            name="fromDate"
            type="date"
            value={filters.fromDate}
          />
        </label>
        <label className="text-xs font-medium text-stone-600">
          To
          <input
            className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white/70 px-3 text-sm text-stone-900"
            name="toDate"
            type="date"
            value={filters.toDate}
          />
        </label>
        <label className="text-xs font-medium text-stone-600">
          Payment method
          <select
            className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white/70 px-3 text-sm text-stone-900"
            name="paymentMethod"
            value={filters.paymentMethod}
          >
            <option value="">All methods</option>
            <option value="cash">Cash</option>
            <option value="momo">MoMo</option>
          </select>
        </label>
        <label className="text-xs font-medium text-stone-600">
          Cashier
          <select
            className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-white/70 px-3 text-sm text-stone-900"
            name="cashierId"
            value={filters.cashierId}
          >
            <option value="">All cashiers</option>
            {cashiers.map((cashier) => (
              <option key={cashier.id} value={cashier.id}>
                {cashier.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="min-h-11 self-end rounded-full bg-teal-800 px-5 text-sm font-semibold text-white hover:bg-teal-900"
          type="submit"
        >
          Apply filters
        </button>
        <Link
          className="inline-flex min-h-11 items-center justify-center self-end rounded-full border border-stone-300 px-5 text-sm font-medium text-stone-700 hover:border-stone-500"
          href="/sales/history"
        >
          Reset
        </Link>
      </form>

      {filterError ? (
        <p className="mb-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {filterError}
        </p>
      ) : null}

      <div
        className={
          children
            ? "grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]"
            : ""
        }
      >
        <section aria-label="Sales list" className="min-w-0">
          {sales.length === 0 ? (
            <p className="border-y border-stone-200 py-10 text-center text-sm text-stone-500">
              No sales match these filters.
            </p>
          ) : (
            <>
              <ul className="divide-y divide-stone-200 border-y border-stone-200 lg:hidden">
                {sales.map((sale) => (
                  <li key={sale.saleId}>
                    <Link
                      aria-current={
                        sale.saleId === selectedSaleId ? "page" : undefined
                      }
                      className={`block min-h-11 py-4 ${
                        sale.saleId === selectedSaleId
                          ? "bg-teal-800/5"
                          : "hover:bg-white/60"
                      }`}
                      href={historyHref(filters, { saleId: sale.saleId })}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="break-all font-mono text-xs font-semibold">
                          {sale.saleNumber}
                        </span>
                        <span className="shrink-0 font-mono text-sm font-semibold">
                          {formatPesewas(sale.totalPesewas)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-stone-600">
                        <time dateTime={sale.createdAt}>
                          {createdAtFormatter.format(new Date(sale.createdAt))}
                        </time>
                        {" · "}
                        {sale.branchName}
                        {" · "}
                        {sale.cashierName}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <PaymentSummary sale={sale} />
                        <span className="shrink-0 text-[11px] text-stone-500">
                          {sale.lineCount} {sale.lineCount === 1 ? "line" : "lines"}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto rounded-2xl border border-stone-200 bg-white/60 lg:block">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-stone-200 bg-stone-100/70 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                      <th className="px-4 py-3" scope="col">Sale / date</th>
                      <th className="px-4 py-3" scope="col">Branch / cashier</th>
                      <th className="px-4 py-3" scope="col">Payment</th>
                      <th className="px-4 py-3 text-right" scope="col">Total</th>
                      <th className="px-4 py-3 text-right" scope="col">Lines</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {sales.map((sale) => (
                      <tr
                        className={
                          sale.saleId === selectedSaleId ? "bg-teal-800/5" : ""
                        }
                        key={sale.saleId}
                      >
                        <td className="px-4 py-3">
                          <Link
                            aria-current={
                              sale.saleId === selectedSaleId ? "page" : undefined
                            }
                            className="inline-flex min-h-11 items-center break-all font-mono text-xs font-semibold text-teal-900 underline decoration-teal-900/30 underline-offset-4"
                            href={historyHref(filters, { saleId: sale.saleId })}
                          >
                            {sale.saleNumber}
                          </Link>
                          <time
                            className="mt-1 block text-[11px] text-stone-500"
                            dateTime={sale.createdAt}
                          >
                            {createdAtFormatter.format(new Date(sale.createdAt))}
                          </time>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="block font-medium">{sale.branchName}</span>
                          <span className="mt-1 block text-stone-500">
                            {sale.cashierName}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block text-xs font-medium">
                            {sale.paymentMethod === "cash" ? "Cash" : "MoMo"}
                          </span>
                          <PaymentSummary sale={sale} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold">
                          {formatPesewas(sale.totalPesewas)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {sale.lineCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {nextCursor ? (
                <Link
                  className="mt-5 inline-flex min-h-11 items-center rounded-full border border-stone-300 px-5 text-sm font-semibold text-stone-700 hover:border-teal-800 hover:text-teal-900"
                  href={historyHref(
                    { ...filters, cursor: undefined },
                    { cursor: nextCursor },
                  )}
                >
                  Load more
                </Link>
              ) : null}
            </>
          )}
        </section>

        {children ? (
          <div className="min-w-0">
            {detailError ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                {detailError}
              </p>
            ) : (
              children
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
