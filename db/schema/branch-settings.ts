import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  pgTable,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";

export const branchSettings = pgTable(
  "branch_settings",
  {
    branchId: uuid("branch_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    voidAutoApproveLimitPesewas: bigint(
      "void_auto_approve_limit_pesewas",
      { mode: "number" },
    ),
  },
  (table) => [
    check(
      "branch_settings_void_auto_approve_limit_pesewas_check",
      sql`${table.voidAutoApproveLimitPesewas} is null or ${table.voidAutoApproveLimitPesewas} >= 0`,
    ),
    foreignKey({
      name: "branch_settings_branch_organization_fk",
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
  ],
);
