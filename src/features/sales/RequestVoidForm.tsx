"use client";

import { useActionState } from "react";
import {
  requestVoidAction,
  type VoidRequestState,
} from "@/app/(app)/sales/actions";

type RequestVoidFormProps = {
  branchId: string;
  saleId: string;
};

const initialState: VoidRequestState = { message: null, tone: null };

export default function RequestVoidForm({
  branchId,
  saleId,
}: RequestVoidFormProps) {
  const [state, formAction, pending] = useActionState(
    requestVoidAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-5 border-t border-stone-200 pt-4">
      <input name="saleId" type="hidden" value={saleId} />
      <input name="branchId" type="hidden" value={branchId} />
      <label
        className="text-xs font-semibold text-stone-700"
        htmlFor="void-reason"
      >
        Reason for void
      </label>
      <textarea
        className="mt-2 min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-teal-600"
        id="void-reason"
        maxLength={200}
        minLength={5}
        name="reason"
        required
        rows={2}
      />
      <button
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full bg-teal-700 px-5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? "Sending…" : "Request void"}
      </button>
      {state.message ? (
        <p
          className={
            state.tone === "success"
              ? "mt-3 text-sm font-medium text-emerald-700"
              : "mt-3 text-sm font-medium text-rose-700"
          }
          role="status"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
