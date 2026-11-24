import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { batches } from "./batches";
import { branches } from "./branches";
import { medicines } from "./medicines";
import { organizations } from "./organizations";
import { users } from "./users";

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").notNull(),
    cashierId: uuid("cashier_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    saleNumber: text("sale_number").notNull(),
    totalPesewas: bigint("total_pesewas", { mode: "number" }).notNull(),
    paymentMethod: text("payment_method").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "sales_branch_organization_fk",
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
    foreignKey({
      name: "sales_cashier_organization_fk",
      columns: [table.cashierId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    unique("sales_branch_idempotency_key_unique").on(
      table.branchId,
      table.idempotencyKey,
    ),
    unique("sales_branch_id_sale_number_unique").on(
      table.branchId,
      table.saleNumber,
    ),
    check(
      "sales_total_pesewas_check",
      sql`${table.totalPesewas} >= 0`,
    ),
    check(
      "sales_payment_method_check",
      sql`${table.paymentMethod} in ('cash', 'momo')`,
    ),
  ],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    medicineId: uuid("medicine_id")
      .notNull()
      .references(() => medicines.id),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    quantity: integer("quantity").notNull(),
    unitPricePesewas: bigint("unit_price_pesewas", { mode: "number" }).notNull(),
    lineTotalPesewas: bigint("line_total_pesewas", { mode: "number" }).notNull(),
  },
  (table) => [
    // Composite batch/sale branch validation is intentionally deferred.
    check(
      "sale_lines_quantity_check",
      sql`${table.quantity} between 1 and 99`,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id)
      .unique(),
    amountPesewas: bigint("amount_pesewas", { mode: "number" }).notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
  },
  (table) => [
    check(
      "payments_amount_pesewas_check",
      sql`${table.amountPesewas} > 0`,
    ),
    check(
      "payments_method_check",
      sql`${table.method} in ('cash', 'momo')`,
    ),
    check(
      "payments_momo_reference_check",
      sql`(${table.method} = 'momo' and ${table.reference} is not null) or ${table.method} = 'cash'`,
    ),
  ],
);
