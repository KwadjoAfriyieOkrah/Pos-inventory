import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { organizations } from "./organizations";
import { users } from "./users";
import { batches } from "./batches";

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    movementType: text("movement_type").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    referenceId: uuid("reference_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "stock_movements_branch_organization_fk",
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
    foreignKey({
      name: "stock_movements_batch_branch_fk",
      columns: [table.batchId, table.branchId],
      foreignColumns: [batches.id, batches.branchId],
    }),
    check(
      "stock_movements_movement_type_check",
      sql`${table.movementType} in ('receipt', 'sale', 'adjustment')`,
    ),
    check(
      "stock_movements_quantity_delta_check",
      sql`${table.quantityDelta} <> 0`,
    ),
    index("stock_movements_batch_created_at_idx").on(
      table.batchId,
      table.createdAt,
    ),
  ],
);
