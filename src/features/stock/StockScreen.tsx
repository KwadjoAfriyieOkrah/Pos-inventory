"use client";

import { useState } from "react";
import Link from "next/link";
import { formatPesewas } from "@/features/sales/format";
import { MedicineActivationForm } from "@/features/stock/ReceiveForm";
import { batchStatus } from "./status";
import type { BatchStatus } from "./status";

type StockFilter = "all" | "expiringSoon" | "lowStock";

type BranchBatch = {
  id: string;
  batchNumber: string;
  medicineName: string;
  expiryDate: string;
  quantityOnHand: number;
  unitCostPesewas?: number;
};

type StockBranch = {
  id: string;
  name: string;
};

type PendingMedicine = {
  id: string;
  name: string;
  dosageForm: string;
};

type StockScreenProps = {
  batches: readonly BranchBatch[];
  today: string;
  branchName: string;
  branches: readonly StockBranch[];
  selectedBranchId: string;
  canViewStockValue: boolean;
  canReceiveStock: boolean;
  pendingMedicines: readonly PendingMedicine[];
  canEditMedicines: boolean;
};

const FILTERS: readonly { id: StockFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "expiringSoon", label: "Expiring soon" },
  { id: "lowStock", label: "Low stock" },
];

function statusLabel(status: BatchStatus): string {
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

function statusClassName(status: BatchStatus): string {
  switch (status) {
    case "expired":
      return "bg-red-100 text-red-800";
    case "within30":
      return "bg-amber-100 text-amber-900";
    case "within60":
      return "bg-stone-200 text-stone-700";
    case "ok":
      return "bg-teal-800/10 text-teal-900";
  }
}

function BatchStatusLabel({ status }: { status: BatchStatus }) {
  return (
    <span
      className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold ${statusClassName(status)}`}
    >
      {statusLabel(status)}
    </span>
  );
}

export function StockScreen({
  batches,
  today,
  branchName,
  branches,
  selectedBranchId,
  canViewStockValue,
  canReceiveStock,
  pendingMedicines,
  canEditMedicines,
}: StockScreenProps) {
  const [filter, setFilter] = useState<StockFilter>("all");
  const batchStatuses = new Map(
    batches.map((batch) => [
      batch.id,
      batchStatus(batch, today),
    ]),
  );

  const expiredCount = batches.filter(
    (batch) => batchStatuses.get(batch.id) === "expired",
  ).length;
  const expiringWithin60Count = batches.filter((batch) => {
    const status = batchStatuses.get(batch.id);
    return status === "within30" || status === "within60";
  }).length;

  const groupedBatches = new Map<string, BranchBatch[]>();
  for (const batch of batches) {
    const group = groupedBatches.get(batch.medicineName) ?? [];
    group.push(batch);
    groupedBatches.set(batch.medicineName, group);
  }
  const medicineGroups = [...groupedBatches].map(([medicineName, allBatches]) => {
    const medicineBatches = allBatches.filter((batch) => {
      const status = batchStatuses.get(batch.id);
      if (filter === "expiringSoon") {
        return status !== "ok";
      }
      if (filter === "lowStock") {
        return batch.quantityOnHand < 20;
      }
      return true;
    });

    return { medicineName, batches: medicineBatches };
  }).filter((group) => group.batches.length > 0);
  const hasCompleteUnitCosts =
    canViewStockValue &&
    batches.every((batch) => Number.isSafeInteger(batch.unitCostPesewas));
  const totalStockValue = hasCompleteUnitCosts
    ? batches.reduce((total, batch) => {
        const nextTotal =
          total + batch.quantityOnHand * (batch.unitCostPesewas ?? 0);
        if (!Number.isSafeInteger(nextTotal)) {
          throw new RangeError("Stock value exceeds the supported money range.");
        }
        return nextTotal;
      }, 0)
    : null;

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
        <span>Demo database. Stock is not updated by sales yet.</span>
      </div>

      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
            Inventory / Stock
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Stock overview
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            Batch quantities and expiry dates for {branchName}.
          </p>
        </div>
        {canReceiveStock ? (
          <Link
            className="inline-flex min-h-11 items-center rounded-full bg-teal-800 px-5 text-sm font-semibold text-white hover:bg-teal-900"
            href="/stock/receive"
          >
            Receive stock
          </Link>
        ) : null}
      </div>

      {branches.length > 1 ? (
        <nav aria-label="Stock branch" className="mb-7 flex flex-wrap gap-2">
          {branches.map((branch) => (
            <Link
              aria-current={branch.id === selectedBranchId ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition ${
                branch.id === selectedBranchId
                  ? "border-teal-800 bg-teal-800 text-white"
                  : "border-stone-300 text-stone-600 hover:border-stone-500 hover:text-stone-950"
              }`}
              href={`/stock?branch=${encodeURIComponent(branch.id)}`}
              key={branch.id}
            >
              {branch.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <section
        aria-label="Stock summary"
        className="mb-8 grid divide-y divide-stone-200 border-y border-stone-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        <div className="py-4 sm:px-5 sm:py-5 sm:pl-0">
          <p className="text-xs font-medium text-stone-500">Total stock value</p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">
            {totalStockValue === null
              ? "Restricted"
              : formatPesewas(totalStockValue)}
          </p>
        </div>
        <div className="py-4 sm:px-5 sm:py-5">
          <p className="text-xs font-medium text-stone-500">Expired batches</p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">
            {expiredCount}
          </p>
        </div>
        <div className="py-4 sm:px-5 sm:py-5 sm:pr-0">
          <p className="text-xs font-medium text-stone-500">
            Expiring within 60 days
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">
            {expiringWithin60Count}
          </p>
        </div>
      </section>

      <div className="mb-5 flex flex-wrap gap-2" aria-label="Stock filters">
        {FILTERS.map((item) => {
          const selected = filter === item.id;
          return (
            <button
              aria-pressed={selected}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 ${
                selected
                  ? "border-teal-800 bg-teal-800 text-white"
                  : "border-stone-300 bg-transparent text-stone-600 hover:border-stone-500 hover:text-stone-950"
              }`}
              key={item.id}
              onClick={() => setFilter(item.id)}
              type="button"
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {medicineGroups.length === 0 ? (
        <p className="border-y border-stone-200 py-10 text-center text-sm text-stone-500">
          No batches match this filter.
        </p>
      ) : (
        <>
          <div className="space-y-7 lg:hidden">
            {medicineGroups.map((group) => (
              <section key={group.medicineName}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-semibold">
                    {group.medicineName}
                  </h2>
                </div>
                <ul className="divide-y divide-stone-200 border-y border-stone-200">
                  {group.batches.map((batch) => {
                    const status = batchStatuses.get(batch.id)!;
                    return (
                      <li className="min-h-11 py-4" key={batch.id}>
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-mono text-sm font-semibold">
                            {batch.batchNumber}
                          </p>
                          <BatchStatusLabel status={status} />
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                          <div>
                            <dt className="text-stone-500">Expiry</dt>
                            <dd className="mt-1 font-medium">
                              <time dateTime={batch.expiryDate}>
                                {batch.expiryDate}
                              </time>
                            </dd>
                          </div>
                          <div className="text-right">
                            <dt className="text-stone-500">On hand</dt>
                            <dd className="mt-1 font-mono font-semibold">
                              {batch.quantityOnHand}
                            </dd>
                          </div>
                        </dl>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border border-stone-200 bg-white/60 lg:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-100/70 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                  <th className="px-5 py-3" scope="col">
                    Batch
                  </th>
                  <th className="px-5 py-3" scope="col">
                    Expiry date
                  </th>
                  <th className="px-5 py-3 text-right" scope="col">
                    On hand
                  </th>
                  <th className="px-5 py-3" scope="col">
                    Status
                  </th>
                </tr>
              </thead>
              {medicineGroups.map((group) => (
                <tbody key={group.medicineName}>
                  <tr className="border-b border-stone-200 bg-stone-100/40">
                    <th
                      className="px-5 py-3 text-sm font-semibold"
                      colSpan={4}
                      scope="rowgroup"
                    >
                      {group.medicineName}
                    </th>
                  </tr>
                  {group.batches.map((batch) => {
                    const status = batchStatuses.get(batch.id)!;
                    return (
                      <tr
                        className="border-b border-stone-100 last:border-b-0"
                        key={batch.id}
                      >
                        <th
                          className="min-h-11 px-5 py-3 font-mono text-sm font-medium"
                          scope="row"
                        >
                          {batch.batchNumber}
                        </th>
                        <td className="min-h-11 px-5 py-3 text-sm">
                          <time dateTime={batch.expiryDate}>
                            {batch.expiryDate}
                          </time>
                        </td>
                        <td className="min-h-11 px-5 py-3 text-right font-mono text-sm">
                          {batch.quantityOnHand}
                        </td>
                        <td className="min-h-11 px-5 py-3">
                          <BatchStatusLabel status={status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}

      {pendingMedicines.length > 0 ? (
        <section
          aria-labelledby="pending-medicines-title"
          className="mt-8 border-t border-stone-200 pt-6"
        >
          <div className="mb-4">
            <h2
              className="text-lg font-semibold tracking-tight"
              id="pending-medicines-title"
            >
              Awaiting approval
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              New items need classification and a sale price before they can be sold.
            </p>
          </div>
          <ul className="divide-y divide-stone-200 border-y border-stone-200">
            {pendingMedicines.map((medicine) => (
              <li className="py-4" key={medicine.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{medicine.name}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      {medicine.dosageForm}
                    </p>
                  </div>
                  {canEditMedicines ? (
                    <MedicineActivationForm
                      branchId={selectedBranchId}
                      medicine={medicine}
                    />
                  ) : (
                    <span className="inline-flex min-h-8 items-center rounded-full bg-amber-100 px-3 text-xs font-semibold text-amber-900">
                      Pending approval
                    </span>
                  )}
                </div>
                <ul className="mt-3 divide-y divide-stone-100 border-y border-stone-200">
                  {batches
                    .filter((batch) => batch.medicineName === medicine.name)
                    .map((batch) => {
                      const status = batchStatuses.get(batch.id)!;
                      return (
                        <li
                          className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-3 text-xs"
                          key={batch.id}
                        >
                          <span className="font-mono font-medium">
                            {batch.batchNumber}
                          </span>
                          <span>
                            Expiry{" "}
                            <time dateTime={batch.expiryDate}>
                              {batch.expiryDate}
                            </time>
                          </span>
                          <span className="font-mono">
                            Qty {batch.quantityOnHand}
                          </span>
                          <BatchStatusLabel status={status} />
                        </li>
                      );
                    })}
                  {batches.every((batch) => batch.medicineName !== medicine.name) ? (
                    <li className="py-3 text-xs text-stone-500">
                      No batches received at this branch.
                    </li>
                  ) : null}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
