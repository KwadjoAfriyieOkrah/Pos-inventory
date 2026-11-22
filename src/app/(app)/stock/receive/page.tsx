import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { accraToday } from "@/lib/time";
import { auth } from "@/server/auth";
import { loadScope } from "@/server/auth/scope";
import { listReceivingMedicines } from "@/server/data/receiving";
import { PERMISSIONS } from "@/server/data/permissions";
import { can, requireBranch } from "@/server/data/scope";
import { ReceiveForm } from "@/features/stock/ReceiveForm";

async function SignedInReceivePage() {
  await connection();

  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const scope = await loadScope(
    session.user.id,
    session.user.organizationId,
  );
  const branchId = [...scope.branches.keys()].find((id) =>
    can(scope, id, PERMISSIONS.stockReceive),
  );

  if (!branchId) {
    return (
      <p className="text-sm text-stone-600">
        You do not have permission to receive stock at a branch.
      </p>
    );
  }

  const access = await requireBranch(scope, branchId, PERMISSIONS.stockReceive);
  const medicines = await listReceivingMedicines(scope, access);
  const idempotencyKey = randomUUID();

  return (
    <>
      <div className="mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">
          Inventory / Receiving
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Receive stock
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Record a supplier delivery for this branch. New medicines require approval before sale.
        </p>
      </div>
      <ReceiveForm
        branchId={access.branchId}
        idempotencyKey={idempotencyKey}
        key={idempotencyKey}
        medicines={medicines}
        today={accraToday()}
      />
    </>
  );
}

export default function StockReceivePage() {
  return (
    <main className="w-full">
      <Suspense fallback={<p>Loading receiving…</p>}>
        <SignedInReceivePage />
      </Suspense>
    </main>
  );
}
