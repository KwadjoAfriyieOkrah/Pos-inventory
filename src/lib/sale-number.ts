import { sql, type SQL } from "drizzle-orm";

type SaleNumberExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

type SaleNumberResult = {
  rows?: { sale_number?: string | null }[];
};

export function branchCodeFromName(name: string): string {
  const finalLetter = name.trim().slice(-1);
  if (!/^[A-Za-z]$/.test(finalLetter)) {
    throw new Error("Branch name must end with a letter to derive a branch code.");
  }
  return finalLetter.toUpperCase();
}

export async function nextSaleNumber(
  tx: SaleNumberExecutor,
  organizationId: string,
  branchId: string,
  businessDate: string,
): Promise<string> {
  const result = (await tx.execute(sql`
    WITH counter AS (
      INSERT INTO branch_sale_counters (branch_id, business_date, last_value)
      VALUES (${branchId}::uuid, ${businessDate}::date, 1)
      ON CONFLICT (branch_id, business_date) DO UPDATE
      SET last_value = branch_sale_counters.last_value + 1
      RETURNING last_value, business_date
    )
    SELECT
      upper(right(btrim(branches.name), 1)) || '-' ||
      to_char(counter.business_date, 'YYYYMMDD') || '-' ||
      lpad(counter.last_value::text, 4, '0') AS sale_number
    FROM counter
    INNER JOIN branches
      ON branches.id = ${branchId}::uuid
     AND branches.organization_id = ${organizationId}::uuid
  `)) as SaleNumberResult;

  const saleNumber = result.rows?.[0]?.sale_number;
  if (!saleNumber) {
    throw new Error("Sale number could not be allocated.");
  }
  return saleNumber;
}
