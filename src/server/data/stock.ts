import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { batches, branches, medicines } from "../../../db/schema";
import { db } from "@/server/db/client";
import { PERMISSIONS } from "./permissions";
import { can, requireBranch, type AuthorizedBranch, type DataScope } from "./scope";

type BranchBatchBase = {
  id: string;
  batchNumber: string;
  medicineName: string;
  expiryDate: string;
  quantityOnHand: number;
};

export type BranchBatch = BranchBatchBase & {
  unitCostPesewas?: number;
};

export type ReadableBranch = {
  id: string;
  name: string;
};

export async function listReadableBranches(
  scope: DataScope,
  access: AuthorizedBranch,
): Promise<ReadableBranch[]> {
  access = await requireBranch(
    scope,
    access.branchId,
    PERMISSIONS.reportViewBranch,
  );
  const branchIds = [...scope.branches.keys()].filter((branchId) =>
    can(scope, branchId, PERMISSIONS.reportViewBranch),
  );

  if (branchIds.length === 0) return [];

  return db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(
      and(
        eq(branches.organizationId, access.organizationId),
        inArray(branches.id, branchIds),
      ),
    )
    .orderBy(asc(branches.name));
}

export async function listBranchBatches(
  scope: DataScope,
  access: AuthorizedBranch,
): Promise<BranchBatch[]> {
  access = await requireBranch(
    scope,
    access.branchId,
    PERMISSIONS.reportViewBranch,
  );

  const where = and(
    eq(batches.organizationId, access.organizationId),
    eq(batches.branchId, access.branchId),
  );
  const includeUnitCost = can(
    scope,
    access.branchId,
    PERMISSIONS.reportViewAll,
  );

  if (includeUnitCost) {
    const rows = await db
      .select({
        id: batches.id,
        batchNumber: batches.batchNumber,
        medicineName: medicines.name,
        expiryDate: batches.expiryDate,
        quantityOnHand: batches.quantityOnHand,
        unitCostPesewas: batches.unitCostPesewas,
      })
      .from(batches)
      .innerJoin(
        medicines,
        and(
          eq(medicines.id, batches.medicineId),
          eq(medicines.organizationId, batches.organizationId),
        ),
      )
      .where(where)
      .orderBy(asc(medicines.name), asc(batches.expiryDate));

    return rows.map((batch) => {
      if (!Number.isSafeInteger(batch.unitCostPesewas)) {
        throw new RangeError("Batch unit cost exceeds the supported money range.");
      }

      return batch;
    });
  }

  return db
    .select({
      id: batches.id,
      batchNumber: batches.batchNumber,
      medicineName: medicines.name,
      expiryDate: batches.expiryDate,
      quantityOnHand: batches.quantityOnHand,
    })
    .from(batches)
    .innerJoin(
      medicines,
      and(
        eq(medicines.id, batches.medicineId),
        eq(medicines.organizationId, batches.organizationId),
      ),
    )
    .where(where)
    .orderBy(asc(medicines.name), asc(batches.expiryDate));
}
