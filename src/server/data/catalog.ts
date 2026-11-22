import "server-only";
import { asc, eq } from "drizzle-orm";
import { medicines } from "../../../db/schema";
import { db } from "@/server/db/client";
import { PERMISSIONS } from "./permissions";
import { requireBranch, type AuthorizedBranch, type DataScope } from "./scope";

export type SaleableMedicine = {
  id: string;
  name: string;
  dosageForm: string;
  unitPricePesewas: number;
};

export async function listSaleableMedicines(
  scope: DataScope,
  access: AuthorizedBranch,
): Promise<SaleableMedicine[]> {
  access = await requireBranch(scope, access.branchId, PERMISSIONS.saleCreate);

  const rows = await db
    .select({
      id: medicines.id,
      name: medicines.name,
      dosageForm: medicines.dosageForm,
      unitPricePesewas: medicines.unitPricePesewas,
    })
    .from(medicines)
    .where(eq(medicines.organizationId, access.organizationId))
    .orderBy(asc(medicines.name));

  return rows.map((medicine) => {
    if (!Number.isSafeInteger(medicine.unitPricePesewas)) {
      throw new RangeError("Medicine price exceeds the supported money range.");
    }

    return medicine;
  });
}
