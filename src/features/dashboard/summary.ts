import { DEMO_CATALOG, type DemoMedicine } from "@/features/demo/catalog";
import {
  DEMO_STOCK_BATCHES,
  type DemoStockBatch,
} from "@/features/demo/stock";
import type { DemoBranchFigures } from "@/features/demo/dashboard";
import { batchStatus, type BatchStatus } from "@/features/stock/status";

export type DashboardTotals = {
  salesTodayCount: number;
  salesTodayTotalPesewas: number;
  restockCount: number;
  expiryCount: number;
};

type InventoryBatch = {
  batch: DemoStockBatch;
  medicine: DemoMedicine;
};

export type ExpiryAttention = InventoryBatch & {
  status: BatchStatus;
};

function findMedicine(
  medicineId: string,
  catalog: readonly DemoMedicine[],
): DemoMedicine {
  const medicine = catalog.find((item) => item.id === medicineId);
  if (!medicine) {
    throw new Error(`Medicine not found in demo catalog: ${medicineId}`);
  }
  return medicine;
}

export function getRestockList(
  batches: readonly DemoStockBatch[] = DEMO_STOCK_BATCHES,
  catalog: readonly DemoMedicine[] = DEMO_CATALOG,
): InventoryBatch[] {
  return batches
    .filter((batch) => batch.quantityOnHand < 20)
    .map((batch) => ({
      batch,
      medicine: findMedicine(batch.medicineId, catalog),
    }));
}

export function getExpiryList(
  today: string,
  batches: readonly DemoStockBatch[] = DEMO_STOCK_BATCHES,
  catalog: readonly DemoMedicine[] = DEMO_CATALOG,
): ExpiryAttention[] {
  return batches.flatMap((batch) => {
    const status = batchStatus(batch, today);
    if (status === "ok") {
      return [];
    }

    return [{ batch, medicine: findMedicine(batch.medicineId, catalog), status }];
  });
}

export function getDashboardTotals(
  branches: readonly DemoBranchFigures[],
  restockList: readonly InventoryBatch[],
  expiryList: readonly ExpiryAttention[],
): DashboardTotals {
  return branches.reduce(
    (totals, branch) => {
      const salesTodayCount = totals.salesTodayCount + branch.salesTodayCount;
      const salesTodayTotalPesewas =
        totals.salesTodayTotalPesewas + branch.salesTodayTotalPesewas;

      if (
        !Number.isSafeInteger(branch.salesTodayCount) ||
        branch.salesTodayCount < 0 ||
        !Number.isSafeInteger(branch.salesTodayTotalPesewas) ||
        branch.salesTodayTotalPesewas < 0 ||
        !Number.isSafeInteger(salesTodayCount) ||
        !Number.isSafeInteger(salesTodayTotalPesewas)
      ) {
        throw new RangeError("Dashboard sales totals must be non-negative integers.");
      }

      return {
        salesTodayCount,
        salesTodayTotalPesewas,
        restockCount: restockList.length,
        expiryCount: expiryList.length,
      };
    },
    {
      salesTodayCount: 0,
      salesTodayTotalPesewas: 0,
      restockCount: restockList.length,
      expiryCount: expiryList.length,
    },
  );
}
