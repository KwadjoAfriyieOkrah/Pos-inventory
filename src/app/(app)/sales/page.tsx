import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/server/auth";
import { loadScope } from "@/server/auth/scope";
import { listSaleableMedicines } from "@/server/data/catalog";
import { PERMISSIONS } from "@/server/data/permissions";
import { can, requireBranch } from "@/server/data/scope";
import { SalesScreen } from "@/features/sales/SalesScreen";

async function SignedInSales() {
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
    can(scope, id, PERMISSIONS.saleCreate),
  );

  if (!branchId) {
    return (
      <p className="text-sm text-stone-600">
        You do not have a branch where sales can be created.
      </p>
    );
  }

  const access = await requireBranch(scope, branchId, PERMISSIONS.saleCreate);
  const medicines = await listSaleableMedicines(scope, access);
  const idempotencyKey = randomUUID();

  return (
    <SalesScreen
      idempotencyKey={idempotencyKey}
      key={idempotencyKey}
      medicines={medicines}
    />
  );
}

export default function SalesPage() {
  return (
    <main className="w-full">
      <Suspense fallback={<p>Loading sales…</p>}>
        <SignedInSales />
      </Suspense>
    </main>
  );
}
