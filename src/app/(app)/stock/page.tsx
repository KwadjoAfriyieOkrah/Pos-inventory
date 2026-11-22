import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/server/auth";
import { loadScope } from "@/server/auth/scope";
import { accraToday } from "@/lib/time";
import { listBranchBatches, listReadableBranches } from "@/server/data/stock";
import { PERMISSIONS } from "@/server/data/permissions";
import { can, requireBranch } from "@/server/data/scope";
import { StockScreen } from "@/features/stock/StockScreen";

type StockPageProps = {
  searchParams: Promise<{ branch?: string | string[] }>;
};

async function SignedInStock({
  requestedBranch,
}: {
  requestedBranch?: string;
}) {
  await connection();

  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const scope = await loadScope(
    session.user.id,
    session.user.organizationId,
  );
  const readableBranchIds = [...scope.branches.keys()].filter((branchId) =>
    can(scope, branchId, PERMISSIONS.reportViewBranch),
  );

  if (readableBranchIds.length === 0) {
    return (
      <p className="text-sm text-stone-600">
        You do not have access to stock reports for a branch.
      </p>
    );
  }

  const branchId = requestedBranch && readableBranchIds.includes(requestedBranch)
    ? requestedBranch
    : readableBranchIds[0];
  const access = await requireBranch(
    scope,
    branchId,
    PERMISSIONS.reportViewBranch,
  );
  const [branches, batches] = await Promise.all([
    listReadableBranches(scope, access),
    listBranchBatches(scope, access),
  ]);
  const selectedBranch = branches.find((branch) => branch.id === branchId);
  if (!selectedBranch) {
    throw new Error("Authorized stock branch is unavailable.");
  }

  return (
    <StockScreen
      batches={batches}
      today={accraToday()}
      branchName={selectedBranch.name}
      branches={branches}
      selectedBranchId={branchId}
      canViewStockValue={can(scope, branchId, PERMISSIONS.reportViewAll)}
    />
  );
}

export default async function StockPage({ searchParams }: StockPageProps) {
  const params = await searchParams;
  const requestedBranch =
    typeof params.branch === "string" ? params.branch : undefined;

  return (
    <main className="w-full">
      <Suspense fallback={<p>Loading stock…</p>}>
        <SignedInStock requestedBranch={requestedBranch} />
      </Suspense>
    </main>
  );
}
