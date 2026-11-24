import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { PendingVoids } from "@/features/sales/PendingVoids";
import { auth } from "@/server/auth";
import { loadScope } from "@/server/auth/scope";
import { PERMISSIONS } from "@/server/data/permissions";
import { listPendingVoids } from "@/server/data/sale-void";
import { can, requireBranch } from "@/server/data/scope";

async function SignedInVoids() {
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
    can(scope, id, PERMISSIONS.saleVoid),
  );

  if (!branchId) {
    return (
      <p className="text-sm text-stone-600">
        You do not have permission to approve sale voids.
      </p>
    );
  }

  const access = await requireBranch(scope, branchId, PERMISSIONS.saleVoid);
  const voids = await listPendingVoids(scope, access);

  return <PendingVoids voids={voids} />;
}

export default function VoidsPage() {
  return (
    <main className="w-full">
      <Suspense fallback={<p>Loading your session…</p>}>
        <SignedInVoids />
      </Suspense>
    </main>
  );
}
