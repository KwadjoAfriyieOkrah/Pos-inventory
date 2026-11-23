import Link from "next/link";
import { formatPesewas } from "@/features/sales/format";
import type { SaleDetailData } from "@/server/data/sales-history";

const createdAtFormatter = new Intl.DateTimeFormat("en-GH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Accra",
});

export function SaleDetail({
  detail,
  backHref,
}: {
  detail: SaleDetailData;
  backHref: string;
}) {
  const { sale, lines } = detail;

  return (
    <section
      aria-labelledby="sale-detail-title"
      className="min-w-0 rounded-2xl border border-stone-200 bg-white/70 p-5 md:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-800">
            Sale detail
          </p>
          <h2
            className="mt-2 break-all text-lg font-semibold tracking-tight"
            id="sale-detail-title"
          >
            {sale.saleNumber}
          </h2>
        </div>
        <Link
          className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-stone-300 px-4 text-sm font-medium text-stone-700 hover:border-stone-500"
          href={backHref}
        >
          Close
        </Link>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-y border-stone-200 py-4 text-xs">
        <div>
          <dt className="text-stone-500">Date and time</dt>
          <dd className="mt-1 font-medium">
            <time dateTime={sale.createdAt}>
              {createdAtFormatter.format(new Date(sale.createdAt))}
            </time>
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">Branch</dt>
          <dd className="mt-1 font-medium">{sale.branchName}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Cashier</dt>
          <dd className="mt-1 font-medium">{sale.cashierName}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Payment method</dt>
          <dd className="mt-1 font-medium">
            {sale.paymentMethod === "cash" ? "Cash" : "MoMo"}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">Sale total</dt>
          <dd className="mt-1 font-mono font-semibold">
            {formatPesewas(sale.totalPesewas)}
          </dd>
        </div>
        {sale.paymentMethod === "cash" ? (
          <>
            <div>
              <dt className="text-stone-500">Cash tendered</dt>
              <dd className="mt-1 font-mono font-medium">
                {formatPesewas(sale.cashTenderedPesewas ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">Change</dt>
              <dd className="mt-1 font-mono font-medium">
                {formatPesewas(sale.changePesewas ?? 0)}
              </dd>
            </div>
          </>
        ) : (
          <div className="col-span-2">
            <dt className="text-stone-500">MoMo reference</dt>
            <dd className="mt-1 break-all font-medium">
              {sale.momoReference}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-5">
        <h3 className="text-sm font-semibold">Items</h3>
        <div className="mt-3 space-y-3 lg:hidden">
          {lines.map((line, index) => (
            <article
              className="min-h-11 border-b border-stone-200 pb-3 last:border-b-0"
              key={`${line.batchNumber}-${index}`}
            >
              <h4 className="text-sm font-medium">{line.medicineName}</h4>
              <p className="mt-1 text-xs text-stone-600">
                {line.quantity} × {formatPesewas(line.unitPricePesewas)} ·{" "}
                {formatPesewas(line.lineTotalPesewas)}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Batch {line.batchNumber} · expires {line.expiryDate}
              </p>
            </article>
          ))}
        </div>
        <div className="mt-3 hidden overflow-hidden rounded-xl border border-stone-200 lg:block">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-100/70 font-semibold uppercase tracking-wider text-stone-500">
                <th className="px-3 py-3" scope="col">Medicine</th>
                <th className="px-3 py-3 text-right" scope="col">Qty</th>
                <th className="px-3 py-3 text-right" scope="col">Unit price</th>
                <th className="px-3 py-3 text-right" scope="col">Line total</th>
                <th className="px-3 py-3" scope="col">Batch / expiry</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr
                  className="border-b border-stone-100 last:border-b-0"
                  key={`${line.batchNumber}-${index}`}
                >
                  <th className="px-3 py-3 font-medium" scope="row">
                    {line.medicineName}
                  </th>
                  <td className="px-3 py-3 text-right font-mono">
                    {line.quantity}
                  </td>
                  <td className="px-3 py-3 text-right font-mono">
                    {formatPesewas(line.unitPricePesewas)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">
                    {formatPesewas(line.lineTotalPesewas)}
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-mono">{line.batchNumber}</span>
                    <span className="mt-1 block text-stone-500">
                      Expires {line.expiryDate}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-5 border-t border-stone-200 pt-4 text-xs text-stone-500">
        No reversals
      </p>
    </section>
  );
}
