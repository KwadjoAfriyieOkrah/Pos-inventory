import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
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

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").notNull(),
    supplierName: text("supplier_name").notNull(),
    supplierInvoice: text("supplier_invoice"),
    receivedBy: uuid("received_by").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "goods_receipts_branch_organization_fk",
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
    foreignKey({
      name: "goods_receipts_user_organization_fk",
      columns: [table.receivedBy, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    unique("goods_receipts_branch_idempotency_key_unique").on(
      table.branchId,
      table.idempotencyKey,
    ),
  ],
);

export const goodsReceiptLines = pgTable(
  "goods_receipt_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => goodsReceipts.id),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    medicineId: uuid("medicine_id").notNull(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    batchNumber: text("batch_number").notNull(),
    expiryDate: date("expiry_date").notNull(),
    quantity: integer("quantity").notNull(),
    unitCostPesewas: bigint("unit_cost_pesewas", {
      mode: "number",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "goods_receipt_lines_medicine_organization_fk",
      columns: [table.medicineId, table.organizationId],
      foreignColumns: [medicines.id, medicines.organizationId],
    }),
    check(
      "goods_receipt_lines_quantity_check",
      sql`${table.quantity} > 0`,
    ),
    check(
      "goods_receipt_lines_unit_cost_pesewas_check",
      sql`${table.unitCostPesewas} >= 0`,
    ),
  ],
);
