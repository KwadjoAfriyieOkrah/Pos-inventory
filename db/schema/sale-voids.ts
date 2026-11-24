import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { sales } from "./sales";
import { users } from "./users";

export const saleVoids = pgTable(
  "sale_voids",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    saleId: uuid("sale_id").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by").notNull(),
    approvedBy: uuid("approved_by"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    businessDate: date("business_date").notNull(),
    decisionFor: uuid("decision_for"),
  },
  (table) => [
    uniqueIndex("sale_voids_sale_id_request_only_unique")
      .on(table.saleId)
      .where(sql`${table.decisionFor} is null`),
    unique("sale_voids_decision_for_unique").on(table.decisionFor),
    unique("sale_voids_id_branch_id_unique").on(table.id, table.branchId),
    check(
      "sale_voids_status_check",
      sql`${table.status} in ('pending_approval', 'approved', 'rejected', 'completed')`,
    ),
    check(
      "sale_voids_reason_length_check",
      sql`length(${table.reason}) between 5 and 200`,
    ),
    foreignKey({
      name: "sale_voids_branch_organization_fk",
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
    foreignKey({
      name: "sale_voids_requested_by_organization_fk",
      columns: [table.requestedBy, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "sale_voids_approved_by_organization_fk",
      columns: [table.approvedBy, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "sale_voids_sale_branch_fk",
      columns: [table.saleId, table.branchId],
      foreignColumns: [sales.id, sales.branchId],
    }),
    foreignKey({
      name: "sale_voids_decision_for_branch_fk",
      columns: [table.decisionFor, table.branchId],
      foreignColumns: [table.id, table.branchId],
    }),
  ],
);
