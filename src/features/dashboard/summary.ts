import { batchStatus, type BatchStatus } from "@/features/stock/status";

export type DashboardBatchData = {
  id: string;
  batchNumber: string;
  medicineName: string;
  expiryDate: string;
  quantityOnHand: number;
};

export type DashboardBranchData = {
  branchId: string;
  branchName: string;
  salesCount: number;
  salesTotalPesewas: number;
  topMedicines: { medicineName: string; unitsSold: number }[];
  batches: DashboardBatchData[];
};

export type DashboardTotals = {
  salesCount: number;
  salesTotalPesewas: number;
  restockCount: number;
  expiryCount: number;
};

export type RestockAttention = {
  branchId: string;
  branchName: string;
  batch: DashboardBatchData;
};

export type ExpiryAttention = RestockAttention & {
  status: BatchStatus;
};

export function getRestockList(
  branches: readonly DashboardBranchData[],
): RestockAttention[] {
  return branches.flatMap((branch) =>
    branch.batches
      .filter((batch) => batch.quantityOnHand < 20)
      .map((batch) => ({
        branchId: branch.branchId,
        branchName: branch.branchName,
        batch,
      })),
  );
}

export function getExpiryList(
  branches: readonly DashboardBranchData[],
  today: string,
): ExpiryAttention[] {
  return branches.flatMap((branch) =>
    branch.batches.flatMap((batch) => {
      const status = batchStatus(batch, today);
      if (status === "ok") {
        return [];
      }

      return [
        {
          branchId: branch.branchId,
          branchName: branch.branchName,
          batch,
          status,
        },
      ];
    }),
  );
}

export function getDashboardTotals(
  branches: readonly DashboardBranchData[],
  restockList: readonly RestockAttention[],
  expiryList: readonly ExpiryAttention[],
): DashboardTotals {
  const sales = branches.reduce(
    (totals, branch) => {
      const salesCount = totals.salesCount + branch.salesCount;
      const salesTotalPesewas =
        totals.salesTotalPesewas + branch.salesTotalPesewas;

      if (
        !Number.isSafeInteger(branch.salesCount) ||
        branch.salesCount < 0 ||
        !Number.isSafeInteger(branch.salesTotalPesewas) ||
        branch.salesTotalPesewas < 0 ||
        !Number.isSafeInteger(salesCount) ||
        !Number.isSafeInteger(salesTotalPesewas)
      ) {
        throw new RangeError("Dashboard sales totals must be non-negative integers.");
      }

      return { salesCount, salesTotalPesewas };
    },
    { salesCount: 0, salesTotalPesewas: 0 },
  );

  return {
    ...sales,
    restockCount: restockList.length,
    expiryCount: expiryList.length,
  };
}
