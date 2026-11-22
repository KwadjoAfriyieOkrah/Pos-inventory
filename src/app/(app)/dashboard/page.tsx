import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/server/auth";
import { DashboardScreen } from "@/features/dashboard/DashboardScreen";
import { accraToday } from "@/lib/time";
import { branchDashboard } from "@/server/data/dashboard";
import { PERMISSIONS } from "@/server/data/permissions";
import { can, requireBranch } from "@/server/data/scope";
import { loadScope } from "@/server/auth/scope";
import {
  getDashboardTotals,
  getExpiryList,
  getRestockList,
} from "@/features/dashboard/summary";

async function SignedInContent() {
  // Reads the visitor's session cookie. Marking it as request-time work
  // keeps Next.js from prerendering or caching one user's page for others.
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
  const today = accraToday();
  const branches = await Promise.all(
    readableBranchIds.map(async (branchId) => {
      if (!can(scope, branchId, PERMISSIONS.reportViewBranch)) {
        return null;
      }

      const access = await requireBranch(
        scope,
        branchId,
        PERMISSIONS.reportViewBranch,
      );
      return branchDashboard(scope, access, today);
    }),
  );
  const branchData = branches.filter((branch) => branch !== null);
  const restockList = getRestockList(branchData);
  const expiryList = getExpiryList(branchData, today);
  const totals = getDashboardTotals(branchData, restockList, expiryList);

  return (
    <DashboardScreen
      branches={branchData}
      expiryList={expiryList}
      restockList={restockList}
      totals={totals}
    />
  );
}

export default function DashboardPage() {
  return (
    <main className="w-full">
      <Suspense fallback={<p>Loading your session…</p>}>
        <SignedInContent />
      </Suspense>
    </main>
  );
}