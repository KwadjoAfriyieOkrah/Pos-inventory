"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useActionState } from "react";
import {
  activateMedicineAction,
  receiveStockAction,
  type ReceivingActionState,
} from "@/app/(app)/stock/receive/actions";

type ReceivingMedicine = {
  id: string;
  name: string;
  dosageForm: string;
  status: string;
};

type PendingMedicine = {
  id: string;
  name: string;
  dosageForm: string;
};

const initialState: ReceivingActionState = {
  error: null,
  success: null,
  receiptLines: null,
};

type ReceiveFormProps = {
  branchId: string;
  medicines: readonly ReceivingMedicine[];
  today: string;
  idempotencyKey: string;
};

export function ReceiveForm({
  branchId,
  medicines,
  today,
  idempotencyKey,
}: ReceiveFormProps) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(
    receiveStockAction,
    initialState,
  );
  const [medicineMode, setMedicineMode] = useState<"existing" | "new">(
    medicines.length > 0 ? "existing" : "new",
  );
  const [search, setSearch] = useState("");

  const filteredMedicines = useMemo(() => {
    const query = search.trim().toLowerCase();
    return medicines.filter((medicine) =>
      medicine.name.toLowerCase().includes(query),
    );
  }, [medicines, search]);

  if (state.success) {
    return (
      <section
        aria-live="polite"
        className="max-w-2xl rounded-2xl border border-teal-900/15 bg-white/70 p-6"
      >
        <p className="text-sm font-semibold text-teal-900" role="status">
          {state.success}
        </p>
        {state.receiptLines?.length ? (
          <ul className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
            {state.receiptLines.map((line, index) => (
              <li
                className="flex flex-wrap items-start justify-between gap-4 py-4"
                key={`${line.medicineName}-${line.batchNumber}-${index}`}
              >
                <div>
                  <p className="text-sm font-semibold">{line.medicineName}</p>
                  <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-stone-600">
                    <div>
                      <dt className="inline">Batch </dt>
                      <dd className="inline font-mono font-medium text-stone-900">
                        {line.batchNumber}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Expiry </dt>
                      <dd className="inline font-medium text-stone-900">
                        <time dateTime={line.expiryDate}>{line.expiryDate}</time>
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Quantity </dt>
                      <dd className="inline font-mono font-medium text-stone-900">
                        {line.quantity}
                      </dd>
                    </div>
                  </dl>
                </div>
                <span
                  className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-semibold ${
                    line.status === "pending"
                      ? "bg-amber-100 text-amber-900"
                      : "bg-teal-800/10 text-teal-900"
                  }`}
                >
                  {line.status === "pending" ? "Pending" : "Active"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <button
          className="mt-5 inline-flex min-h-11 items-center rounded-full bg-teal-800 px-5 text-sm font-semibold text-white hover:bg-teal-900"
          onClick={() => router.refresh()}
          type="button"
        >
          Start another receipt
        </button>
      </section>
    );
  }

  return (
    <form
      action={formAction}
      className="max-w-3xl rounded-2xl border border-stone-200 bg-white/70 p-5 md:p-7"
    >
      <input name="branchId" type="hidden" value={branchId} />
      <input name="idempotencyKey" type="hidden" value={idempotencyKey} />

      <fieldset className="mb-6">
        <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
          Medicine
        </legend>
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            aria-pressed={medicineMode === "existing"}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
              medicineMode === "existing"
                ? "border-teal-800 bg-teal-800 text-white"
                : "border-stone-300 text-stone-600"
            }`}
            onClick={() => setMedicineMode("existing")}
            type="button"
          >
            Existing medicine
          </button>
          <button
            aria-pressed={medicineMode === "new"}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
              medicineMode === "new"
                ? "border-teal-800 bg-teal-800 text-white"
                : "border-stone-300 text-stone-600"
            }`}
            onClick={() => setMedicineMode("new")}
            type="button"
          >
            New medicine
          </button>
          <input name="medicineMode" type="hidden" value={medicineMode} />
        </div>

        {medicineMode === "existing" ? (
          <div className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="medicine-search">
              Search medicines
            </label>
            <input
              autoComplete="off"
              className="min-h-12 w-full rounded-xl border border-stone-300 bg-transparent px-4 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
              id="medicine-search"
              onChange={(event) => setSearch(event.currentTarget.value)}
              placeholder="Type a medicine name"
              type="search"
              value={search}
            />
            <label className="block text-sm font-medium" htmlFor="medicine-id">
              Medicine
            </label>
            <select
              className="min-h-12 w-full rounded-xl border border-stone-300 bg-[#f6f6f1] px-3 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
              id="medicine-id"
              name="medicineId"
              required
            >
              <option value="">Select a medicine</option>
              {filteredMedicines.map((medicine) => (
                <option key={medicine.id} value={medicine.id}>
                  {medicine.name} · {medicine.dosageForm}
                  {medicine.status === "pending" ? " · Pending approval" : ""}
                </option>
              ))}
            </select>
            {filteredMedicines.length === 0 ? (
              <p className="text-xs text-stone-500">
                No medicines match. Choose New medicine to add one as pending.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium" htmlFor="medicine-name">
                Name
              </label>
              <input
                autoComplete="off"
                className="mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-transparent px-3 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
                id="medicine-name"
                maxLength={200}
                name="medicineName"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="dosage-form">
                Dosage form
              </label>
              <input
                autoComplete="off"
                className="mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-transparent px-3 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
                id="dosage-form"
                maxLength={200}
                name="dosageForm"
                required
              />
            </div>
            <p className="text-xs leading-relaxed text-stone-500 sm:col-span-2">
              New medicines are saved as pending and cannot be sold until approved.
            </p>
          </div>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium" htmlFor="batch-number">
            Batch number
          </label>
          <input
            autoComplete="off"
            className="mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-transparent px-3 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
            id="batch-number"
            maxLength={200}
            name="batchNumber"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="expiry-date">
            Expiry date
          </label>
          <input
            className="mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-transparent px-3 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
            id="expiry-date"
            min={today}
            name="expiryDate"
            required
            type="date"
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="quantity">
            Quantity
          </label>
          <input
            className="mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-transparent px-3 font-mono text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
            id="quantity"
            min={1}
            name="quantity"
            required
            step={1}
            type="number"
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="unit-cost">
            Unit cost
          </label>
          <div className="mt-2 flex min-h-12 items-center rounded-xl border border-stone-300 px-3 focus-within:border-teal-800 focus-within:ring-2 focus-within:ring-teal-800/10">
            <span className="mr-2 text-sm text-stone-500">GH₵</span>
            <input
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm outline-none"
              id="unit-cost"
              inputMode="decimal"
              name="unitCostGhs"
              placeholder="0.00"
              required
              type="text"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="supplier-name">
            Supplier name
          </label>
          <input
            autoComplete="organization"
            className="mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-transparent px-3 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
            id="supplier-name"
            maxLength={200}
            name="supplierName"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="supplier-invoice">
            Supplier invoice <span className="font-normal text-stone-500">optional</span>
          </label>
          <input
            autoComplete="off"
            className="mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-transparent px-3 text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
            id="supplier-invoice"
            maxLength={200}
            name="supplierInvoice"
          />
        </div>
      </div>

      {state.error ? (
        <p className="mt-5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {state.error}
        </p>
      ) : null}

      <button
        className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-teal-800 px-5 text-sm font-semibold text-white transition hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        disabled={isPending}
        type="submit"
      >
        {isPending ? "Receiving stock…" : "Receive stock"}
      </button>
    </form>
  );
}

export function MedicineActivationForm({
  branchId,
  medicine,
}: {
  branchId: string;
  medicine: PendingMedicine;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(
    activateMedicineAction,
    initialState,
  );

  if (!isOpen) {
    return (
      <button
        className="inline-flex min-h-11 items-center rounded-full bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        Approve
      </button>
    );
  }

  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <input name="branchId" type="hidden" value={branchId} />
      <input name="medicineId" type="hidden" value={medicine.id} />
      <label className="text-xs text-stone-600">
        Classification
        <select
          className="mt-1 min-h-11 w-full rounded-lg border border-stone-300 bg-[#f6f6f1] px-2 text-sm text-stone-900"
          name="classification"
          required
        >
          <option value="">Choose classification</option>
          <option value="OTC">OTC</option>
          <option value="prescription_only">Prescription only</option>
          <option value="controlled">Controlled</option>
        </select>
      </label>
      <label className="text-xs text-stone-600">
        Unit price
        <span className="mt-1 flex min-h-11 items-center rounded-lg border border-stone-300 px-2">
          <span className="mr-1 text-stone-500">GH₵</span>
          <input
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-stone-900 outline-none"
            inputMode="decimal"
            name="unitPriceGhs"
            placeholder="0.00"
            required
            type="text"
          />
        </span>
      </label>
      <div className="flex items-end gap-2">
        <button
          className="min-h-11 rounded-full border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:border-stone-500"
          onClick={() => setIsOpen(false)}
          type="button"
        >
          Cancel
        </button>
        <button
          className="min-h-11 rounded-full bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Approving…" : "Save approval"}
        </button>
      </div>
      {state.error ? (
        <p className="text-xs text-red-800 sm:col-span-3" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-xs text-teal-900 sm:col-span-3" role="status">
          {state.success}
        </p>
      ) : null}
    </form>
  );
}
