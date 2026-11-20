import type { DemoStockBatch } from "@/features/demo/stock";

export type BatchStatus = "expired" | "within30" | "within60" | "ok";

const MILLISECONDS_PER_DAY = 86_400_000;

function isoDateDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`Expected an ISO date in YYYY-MM-DD format: ${value}`);
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new RangeError(`Invalid ISO date: ${value}`);
  }

  return timestamp / MILLISECONDS_PER_DAY;
}

export function batchStatus(
  batch: Pick<DemoStockBatch, "expiryDate">,
  today: string,
): BatchStatus {
  const daysUntilExpiry = isoDateDay(batch.expiryDate) - isoDateDay(today);

  if (daysUntilExpiry < 0) {
    return "expired";
  }
  if (daysUntilExpiry <= 30) {
    return "within30";
  }
  if (daysUntilExpiry <= 60) {
    return "within60";
  }
  return "ok";
}

export function stockValuePesewas(
  batches: readonly DemoStockBatch[],
): number {
  return batches.reduce((total, batch) => {
    if (
      !Number.isSafeInteger(batch.quantityOnHand) ||
      batch.quantityOnHand < 0 ||
      !Number.isSafeInteger(batch.unitCostPesewas) ||
      batch.unitCostPesewas < 0
    ) {
      throw new RangeError(
        "Stock quantities and costs must be non-negative integers.",
      );
    }

    const batchValue = batch.quantityOnHand * batch.unitCostPesewas;
    const nextTotal = total + batchValue;
    if (
      !Number.isSafeInteger(batchValue) ||
      !Number.isSafeInteger(nextTotal)
    ) {
      throw new RangeError("Stock value exceeds the supported money range.");
    }

    return nextTotal;
  }, 0);
}
