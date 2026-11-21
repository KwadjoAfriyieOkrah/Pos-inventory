import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { medicines } from "./medicines";
import { organizations } from "./organizations";

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").notNull(),
    medicineId: uuid("medicine_id").notNull(),
    batchNumber: text("batch_number").notNull(),
    expiryDate: date("expiry_date").notNull(),
    unitCostPesewas: bigint("unit_cost_pesewas", { mode: "number" }).notNull(),
    quantityOnHand: integer("quantity_on_hand").notNull(),
  },
  (table) => [
    foreignKey({
      name: "batches_branch_organization_fk",
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
    foreignKey({
      name: "batches_medicine_organization_fk",
      columns: [table.medicineId, table.organizationId],
      foreignColumns: [medicines.id, medicines.organizationId],
    }),
    unique("batches_branch_medicine_batch_number_unique").on(
      table.branchId,
      table.medicineId,
      table.batchNumber,
    ),
    unique("batches_id_branch_id_unique").on(table.id, table.branchId),
    check(
      "batches_unit_cost_pesewas_check",
      sql`${table.unitCostPesewas} >= 0`,
    ),
    check(
      "batches_quantity_on_hand_check",
      sql`${table.quantityOnHand} >= 0`,
    ),
    index("batches_branch_medicine_expiry_date_idx").on(
      table.branchId,
      table.medicineId,
      table.expiryDate,
    ),
  ],
);
