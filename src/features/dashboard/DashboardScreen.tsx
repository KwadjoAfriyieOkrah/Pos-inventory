import { DEMO_CATALOG } from "@/features/demo/catalog";
import { DEMO_BRANCHES } from "@/features/demo/dashboard";
import { DEMO_STOCK_BATCHES, DEMO_TODAY } from "@/features/demo/stock";
import { formatPesewas } from "@/features/sales/format";
import {
  getDashboardTotals,
  getExpiryList,
  getRestockList,
} from "./summary";

const restockList = getRestockList(DEMO_STOCK_BATCHES, DEMO_CATALOG);
const expiryList = getExpiryList(
  DEMO_TODAY,
  DEMO_STOCK_BATCHES,
  DEMO_CATALOG,
);
const dashboardTotals = getDashboardTotals(
  DEMO_BRANCHES,
  restockList,
  expiryList,
);
const medicineById = new Map(DEMO_CATALOG.map((medicine) => [medicine.id, medicine]));

type CatalogMedicineId = (typeof DEMO_CATALOG)[number]["id"];

function getMedicineName(medicineId: CatalogMedicineId): string {
  const medicine = medicineById.get(medicineId);
  if (!medicine) {
    throw new Error(`Medicine not found in demo catalog: ${medicineId}`);
  }
  return medicine.name;
}

function expiryLabel(status: (typeof expiryList)[number]["status"]): string {
  switch (status) {
    case "expired":
      return "Do not sell";
    case "within30":
      return "Within 30 days";
    case "within60":
      return "Within 60 days";
    case "ok":
      return "In date";
  }
}

export function DashboardScreen() {
  return (
    <div className="pb-16 md:pb-0">
      <div
        role="note"
        className="mb-8 flex items-center gap-3 rounded-xl border border-teal-900/15 bg-teal-800/5 px-4 py-3 text-sm text-teal-950"
      >
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full bg-teal-700"
        />
        <span>Demo data. Figures are not live.</span>
      </div>

      <div className="mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
          Overview / Owner
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Owner dashboard
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Today&apos;s sales and the inventory that needs attention.
        </p>
      </div>

      <section
        aria-label="Today's summary"
        className="mb-8 grid gap-3 sm:grid-cols-3"
      >
        <article className="rounded-2xl border border-stone-200 bg-white/70 p-5">
          <p className="text-xs font-medium text-stone-500">Sales today</p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">
            {formatPesewas(dashboardTotals.salesTodayTotalPesewas)}
          </p>
          <p className="mt-2 text-xs text-stone-500">
            {dashboardTotals.salesTodayCount} sales across both branches
          </p>
        </article>
        <article className="rounded-2xl border border-stone-200 bg-white/70 p-5">
          <p className="text-xs font-medium text-stone-500">Restock batches</p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">
            {dashboardTotals.restockCount}
          </p>
          <p className="mt-2 text-xs text-stone-500">
            Batches with fewer than 20 units
          </p>
        </article>
        <article className="rounded-2xl border border-stone-200 bg-white/70 p-5">
          <p className="text-xs font-medium text-stone-500">Expiry attention</p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">
            {dashboardTotals.expiryCount}
          </p>
          <p className="mt-2 text-xs text-stone-500">
            Expired or expiring within 60 days
          </p>
        </article>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <section
          aria-labelledby="branch-performance-title"
          className="min-w-0 rounded-2xl border border-stone-200 bg-white/70 p-5 md:p-6"
        >
          <div className="mb-5">
            <h2
              id="branch-performance-title"
              className="text-lg font-semibold tracking-tight"
            >
              Branch performance
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              Today&apos;s takings and this week&apos;s top medicines
            </p>
          </div>

          <div className="divide-y divide-stone-200">
            {DEMO_BRANCHES.map((branch) => (
              <article className="py-5 first:pt-0 last:pb-0" key={branch.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">{branch.name}</h3>
                    <p className="mt-1 text-xs text-stone-500">
                      {branch.salesTodayCount} sales today
                    </p>
                  </div>
                  <p className="shrink-0 font-mono text-base font-semibold">
                    {formatPesewas(branch.salesTodayTotalPesewas)}
                  </p>
                </div>

                <div className="mt-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">
                    Top medicines this week
                  </p>
                  <ol className="divide-y divide-stone-100">
                    {branch.topMedicinesThisWeek.map((item, index) => (
                      <li
                        className="flex min-h-11 items-center gap-3 py-2 text-sm"
                        key={item.medicineId}
                      >
                        <span className="w-5 font-mono text-xs text-stone-400">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-stone-700">
                          {getMedicineName(item.medicineId)}
                        </span>
                        <span className="shrink-0 font-mono text-xs font-semibold">
                          {item.unitsSold} units
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="inventory-attention-title"
          className="min-w-0 rounded-2xl border border-stone-200 bg-white/70 p-5 md:p-6"
        >
          <div className="mb-5">
            <h2
              id="inventory-attention-title"
              className="text-lg font-semibold tracking-tight"
            >
              Inventory attention
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              Quantities and expiry dates from demo batches
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">Restock</h3>
              <span className="text-xs text-stone-500">
                {restockList.length} batches under 20 units
              </span>
            </div>
            {restockList.length > 0 ? (
              <ul className="divide-y divide-stone-200 border-y border-stone-200">
                {restockList.map(({ batch, medicine }) => (
                  <li
                    className="flex min-h-11 items-center justify-between gap-3 py-3"
                    key={batch.id}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {medicine.name}
                      </span>
                      <span className="mt-1 block font-mono text-[11px] text-stone-500">
                        {batch.batchNumber}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-sm font-semibold">
                      {batch.quantityOnHand} left
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-y border-stone-200 py-4 text-sm text-stone-500">
                No batches need restocking.
              </p>
            )}
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold">Expiry watch</h3>
              <span className="text-xs text-stone-500">
                {expiryList.length} batches
              </span>
            </div>
            {expiryList.length > 0 ? (
              <ul className="divide-y divide-stone-200 border-y border-stone-200">
                {expiryList.map(({ batch, medicine, status }) => (
                  <li
                    className="flex min-h-11 items-center justify-between gap-3 py-3"
                    key={batch.id}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {medicine.name}
                      </span>
                      <span className="mt-1 block text-[11px] text-stone-500">
                        {batch.batchNumber} · {batch.expiryDate}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold ${
                        status === "expired"
                          ? "bg-red-100 text-red-800"
                          : status === "within30"
                            ? "bg-amber-100 text-amber-900"
                            : "bg-stone-200 text-stone-700"
                      }`}
                    >
                      {expiryLabel(status)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-y border-stone-200 py-4 text-sm text-stone-500">
                No batches are nearing expiry.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
