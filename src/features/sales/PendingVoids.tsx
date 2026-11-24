import { formatPesewas } from "@/features/sales/format";
import type { PendingVoid } from "@/server/data/sale-void";
import { approveVoidAction } from "@/app/(app)/sales/voids/actions";

const requestedAtFormatter = new Intl.DateTimeFormat("en-GH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Accra",
});

type PendingVoidsProps = {
  voids: readonly PendingVoid[];
};

export function PendingVoids({ voids }: PendingVoidsProps) {
  const approveVoidFormAction = approveVoidAction as unknown as (
    formData: FormData,
  ) => Promise<void>;

  if (voids.length === 0) {
    return (
      <p className="text-sm text-stone-600">No voids are waiting for approval.</p>
    );
  }

  return (
    <ul className="space-y-3">
      {voids.map((voidRequest) => (
        <li
          key={voidRequest.voidId}
          className="rounded-2xl border border-stone-200 bg-white/70 p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-stone-950">
                {voidRequest.saleNumber}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                {formatPesewas(voidRequest.totalPesewas)}
              </p>
            </div>
            <form action={approveVoidFormAction}>
              <input type="hidden" name="voidId" value={voidRequest.voidId} />
              <button
                type="submit"
                className="min-h-11 rounded-xl bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900"
              >
                Approve
              </button>
            </form>
          </div>
          <p className="mt-3 text-sm text-stone-700">
            Requested by {voidRequest.requesterName}
          </p>
          <p className="mt-1 text-sm text-stone-700">{voidRequest.reason}</p>
          <p className="mt-1 text-xs text-stone-500">
            {requestedAtFormatter.format(new Date(voidRequest.requestedAt))}
          </p>
        </li>
      ))}
    </ul>
  );
}
