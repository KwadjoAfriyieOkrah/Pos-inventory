"use client";

import { useMemo, useState } from "react";
import {
  addCartLine,
  getCartTotalPesewas,
  getChangePesewas,
  getLineTotalPesewas,
  parsePesewasInput,
  removeCartLine,
  updateCartLineQuantity,
  type CartLine,
} from "@/features/sales/cart";
import { formatPesewas } from "@/features/sales/format";

type SaleableMedicine = {
  id: string;
  name: string;
  dosageForm: string;
  unitPricePesewas: number;
};

type SalesScreenProps = {
  medicines: readonly SaleableMedicine[];
};

type PaymentMethod = "cash" | "momo";

type SaleConfirmation = {
  totalPesewas: number;
  paymentMethod: PaymentMethod;
  changePesewas?: number;
  reference?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  throw error;
}

export function SalesScreen({ medicines }: SalesScreenProps) {
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>(
    {},
  );
  const [cartError, setCartError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [tenderedInput, setTenderedInput] = useState("");
  const [momoReference, setMomoReference] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [confirmation, setConfirmation] = useState<SaleConfirmation | null>(
    null,
  );

  const totalPesewas = getCartTotalPesewas(cart);
  const tenderedPesewas = parsePesewasInput(tenderedInput);
  const cashChangePesewas =
    tenderedPesewas !== null && tenderedPesewas >= totalPesewas
      ? getChangePesewas(totalPesewas, tenderedPesewas)
      : null;

  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLowerCase();
    return medicines.filter((medicine) =>
      medicine.name.toLowerCase().includes(query),
    );
  }, [medicines, search]);

  function addMedicine(medicine: SaleableMedicine) {
    try {
      setCart(addCartLine(cart, medicine));
      setCartError("");
    } catch (error) {
      setCartError(getErrorMessage(error));
    }
  }

  function changeQuantity(id: string, quantity: number) {
    try {
      setCart(updateCartLineQuantity(cart, id, quantity));
      setQuantityDrafts((drafts) => {
        const nextDrafts = { ...drafts };
        delete nextDrafts[id];
        return nextDrafts;
      });
      setCartError("");
    } catch (error) {
      setCartError(getErrorMessage(error));
    }
  }

  function handleQuantityInput(id: string, value: string) {
    setQuantityDrafts((drafts) => ({ ...drafts, [id]: value }));

    const quantity = value.trim() === "" ? Number.NaN : Number(value);
    try {
      const nextCart = updateCartLineQuantity(cart, id, quantity);
      setCart(nextCart);
      setQuantityDrafts((drafts) => {
        const nextDrafts = { ...drafts };
        delete nextDrafts[id];
        return nextDrafts;
      });
      setCartError("");
    } catch (error) {
      setCartError(getErrorMessage(error));
    }
  }

  function deleteMedicine(id: string) {
    setCart(removeCartLine(cart, id));
    setQuantityDrafts((drafts) => {
      const nextDrafts = { ...drafts };
      delete nextDrafts[id];
      return nextDrafts;
    });
    setCartError("");
  }

  function completeSale() {
    if (cart.length === 0) {
      setPaymentError("Add at least one item before completing the sale.");
      return;
    }

    if (paymentMethod === "cash") {
      if (tenderedPesewas === null) {
        setPaymentError("Enter a valid amount using up to two decimal places.");
        return;
      }

      if (tenderedPesewas < totalPesewas) {
        setPaymentError("Tendered amount must cover the sale total.");
        return;
      }

      setConfirmation({
        totalPesewas,
        paymentMethod,
        changePesewas: getChangePesewas(totalPesewas, tenderedPesewas),
      });
    } else {
      const reference = momoReference.trim();
      if (!reference) {
        setPaymentError("Enter the MoMo payment reference.");
        return;
      }

      setConfirmation({ totalPesewas, paymentMethod, reference });
    }

    setPaymentError("");
  }

  function startNewSale() {
    setCart([]);
    setQuantityDrafts({});
    setCartError("");
    setTenderedInput("");
    setMomoReference("");
    setPaymentError("");
    setConfirmation(null);
    setPaymentMethod("cash");
    setSearch("");
  }

  const canCompleteSale =
    cart.length > 0 &&
    cartError.length === 0 &&
    (paymentMethod === "cash"
      ? tenderedPesewas !== null && tenderedPesewas >= totalPesewas
      : momoReference.trim().length > 0);

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
        <span>
          Figures come from the demo database. Completing a sale does not save
          it yet.
        </span>
      </div>

      <div className="mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
          Counter / Sales
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">New sale</h1>
        <p className="mt-2 text-sm text-stone-600">
          Find items in the catalog and build the customer&apos;s order.
        </p>
      </div>

      {confirmation ? (
        <section
          aria-labelledby="sale-confirmation-title"
          className="max-w-2xl rounded-2xl border border-stone-200 bg-white/70 p-6 md:p-8"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-teal-800">
            Demo sale complete
          </p>
          <h2
            id="sale-confirmation-title"
            className="mt-3 text-2xl font-semibold tracking-tight"
          >
            Sale confirmed
          </h2>
          <p className="mt-2 text-sm text-stone-600">
            This confirmation is for demonstration only. Nothing was saved.
          </p>

          <dl className="mt-7 divide-y divide-stone-200 border-y border-stone-200">
            <div className="flex items-center justify-between gap-4 py-4">
              <dt className="text-sm text-stone-600">Total</dt>
              <dd className="font-mono text-lg font-semibold">
                {formatPesewas(confirmation.totalPesewas)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 py-4">
              <dt className="text-sm text-stone-600">Payment method</dt>
              <dd className="text-sm font-semibold">
                {confirmation.paymentMethod === "cash" ? "Cash" : "MoMo"}
              </dd>
            </div>
            {confirmation.paymentMethod === "cash" ? (
              <div className="flex items-center justify-between gap-4 py-4">
                <dt className="text-sm text-stone-600">Change</dt>
                <dd className="font-mono text-sm font-semibold">
                  {formatPesewas(confirmation.changePesewas ?? 0)}
                </dd>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4 py-4">
                <dt className="text-sm text-stone-600">MoMo reference</dt>
                <dd className="max-w-[65%] break-all text-right text-sm font-semibold">
                  {confirmation.reference}
                </dd>
              </div>
            )}
          </dl>

          <button
            className="mt-7 inline-flex min-h-12 items-center justify-center rounded-full bg-teal-800 px-6 text-sm font-semibold text-white transition hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
            onClick={startNewSale}
            type="button"
          >
            Start a new sale
          </button>
        </section>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <section aria-labelledby="catalog-title" className="min-w-0">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2
                  id="catalog-title"
                  className="text-lg font-semibold tracking-tight"
                >
                  Medicine catalog
                </h2>
                <p className="mt-1 text-xs text-stone-500">
                  {medicines.length} medicines
                </p>
              </div>
            </div>

            <label className="mb-4 block">
              <span className="sr-only">Search medicines by name</span>
              <input
                autoComplete="off"
                className="min-h-12 w-full rounded-xl border border-stone-300 bg-white/70 px-4 text-sm outline-none transition placeholder:text-stone-400 focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search medicines"
                type="search"
                value={search}
              />
            </label>

            <ul className="divide-y divide-stone-200 border-y border-stone-200">
              {filteredCatalog.map((medicine, index) => (
                <li key={medicine.id}>
                  <button
                    className="flex min-h-16 w-full items-center gap-4 py-3 text-left transition hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-800"
                    onClick={() => addMedicine(medicine)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-stone-200/80 font-mono text-xs text-stone-600"
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {medicine.name}
                      </span>
                      <span className="mt-1 block truncate text-xs text-stone-500">
                        {medicine.dosageForm}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm font-semibold">
                        {formatPesewas(medicine.unitPricePesewas)}
                      </span>
                      <span
                        aria-hidden="true"
                        className="mt-1 block text-[10px] font-semibold uppercase tracking-wider text-teal-800"
                      >
                        Add +
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {filteredCatalog.length === 0 ? (
                <li className="py-8 text-center text-sm text-stone-500">
                  No medicines match that search.
                </li>
              ) : null}
            </ul>
          </section>

          <section
            aria-labelledby="cart-title"
            className="min-w-0 self-start rounded-2xl border border-stone-200 bg-white/70 p-5 md:p-6"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="cart-title" className="text-lg font-semibold tracking-tight">
                Current sale
              </h2>
              <span className="text-xs text-stone-500">
                {cart.length} {cart.length === 1 ? "item" : "items"}
              </span>
            </div>

            {cartError ? (
              <p
                className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800"
                role="alert"
              >
                {cartError}
              </p>
            ) : null}

            {cart.length === 0 ? (
              <p className="border-b border-stone-200 py-8 text-sm text-stone-500">
                Your sale is empty. Choose an item from the catalog to begin.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-stone-200">
                {cart.map((line) => (
                  <li className="py-4" key={line.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {line.name}
                        </p>
                        <p className="mt-1 text-xs text-stone-500">
                          {formatPesewas(line.unitPricePesewas)} each
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-sm font-semibold">
                        {formatPesewas(getLineTotalPesewas(line))}
                      </p>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1">
                        <button
                          aria-label={`Decrease ${line.name} quantity`}
                          className="min-h-11 min-w-11 rounded-lg border border-stone-300 text-lg text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
                          onClick={() =>
                            changeQuantity(line.id, line.quantity - 1)
                          }
                          type="button"
                        >
                          −
                        </button>
                        <input
                          aria-label={`Quantity for ${line.name}`}
                          className="h-11 w-14 rounded-lg border border-stone-300 bg-transparent text-center font-mono text-sm outline-none focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
                          inputMode="numeric"
                          max={99}
                          min={1}
                          onChange={(event) =>
                            handleQuantityInput(
                              line.id,
                              event.currentTarget.value,
                            )
                          }
                          step={1}
                          type="number"
                          value={quantityDrafts[line.id] ?? line.quantity}
                        />
                        <button
                          aria-label={`Increase ${line.name} quantity`}
                          className="min-h-11 min-w-11 rounded-lg border border-stone-300 text-lg text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800"
                          onClick={() =>
                            changeQuantity(line.id, line.quantity + 1)
                          }
                          type="button"
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="min-h-11 px-2 text-xs font-medium text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-red-800"
                        onClick={() => deleteMedicine(line.id)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between border-y border-stone-200 py-4">
              <span className="text-sm font-semibold">Total</span>
              <span className="font-mono text-xl font-semibold">
                {formatPesewas(totalPesewas)}
              </span>
            </div>

            <fieldset className="mt-5">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                Payment method
              </legend>
              <div className="grid grid-cols-2 rounded-xl bg-stone-100 p-1">
                {(["cash", "momo"] as const).map((method) => {
                  const selected = paymentMethod === method;
                  return (
                    <button
                      aria-pressed={selected}
                      className={`min-h-11 rounded-lg text-sm font-medium transition ${
                        selected
                          ? "bg-white text-teal-900 shadow-sm"
                          : "text-stone-600 hover:text-stone-950"
                      }`}
                      key={method}
                      onClick={() => {
                        setPaymentMethod(method);
                        setPaymentError("");
                      }}
                      type="button"
                    >
                      {method === "cash" ? "Cash" : "MoMo"}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {paymentMethod === "cash" ? (
              <div className="mt-4">
                <label className="block text-sm font-medium" htmlFor="tendered">
                  Amount tendered
                </label>
                <div className="mt-2 flex min-h-12 items-center rounded-xl border border-stone-300 bg-white/70 px-3 focus-within:border-teal-800 focus-within:ring-2 focus-within:ring-teal-800/10">
                  <span className="mr-2 text-sm text-stone-500">GH₵</span>
                  <input
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-transparent py-2 font-mono text-sm outline-none placeholder:text-stone-400"
                    id="tendered"
                    inputMode="decimal"
                    onChange={(event) => {
                      setTenderedInput(event.currentTarget.value);
                      setPaymentError("");
                    }}
                    placeholder="0.00"
                    type="text"
                    value={tenderedInput}
                  />
                </div>
                {tenderedInput && tenderedPesewas === null ? (
                  <p className="mt-2 text-xs text-red-800" role="alert">
                    Enter a valid amount using up to two decimal places.
                  </p>
                ) : null}
                {tenderedPesewas !== null &&
                tenderedPesewas < totalPesewas ? (
                  <p className="mt-2 text-xs text-red-800" role="alert">
                    Tendered amount must cover the sale total.
                  </p>
                ) : null}
                {cashChangePesewas !== null ? (
                  <p className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-stone-600">Change</span>
                    <span className="font-mono font-semibold">
                      {formatPesewas(cashChangePesewas)}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-4">
                <label
                  className="block text-sm font-medium"
                  htmlFor="momo-reference"
                >
                  MoMo reference
                </label>
                <input
                  autoComplete="off"
                  className="mt-2 min-h-12 w-full rounded-xl border border-stone-300 bg-white/70 px-3 text-sm outline-none placeholder:text-stone-400 focus:border-teal-800 focus:ring-2 focus:ring-teal-800/10"
                  id="momo-reference"
                  onChange={(event) => {
                    setMomoReference(event.currentTarget.value);
                    setPaymentError("");
                  }}
                  placeholder="Enter transaction reference"
                  required
                  type="text"
                  value={momoReference}
                />
              </div>
            )}

            {paymentError ? (
              <p className="mt-3 text-xs text-red-800" role="alert">
                {paymentError}
              </p>
            ) : null}

            <button
              className="mt-5 min-h-12 w-full rounded-full bg-teal-800 px-5 text-sm font-semibold text-white transition hover:bg-teal-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-800 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-500"
              disabled={!canCompleteSale}
              onClick={completeSale}
              type="button"
            >
              Complete sale
            </button>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-stone-500">
              Demo only · no payment or stock update will be recorded
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
