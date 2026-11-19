import { sql } from "drizzle-orm";
import {
  check,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { roles } from "./roles";

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    permission: text("permission").notNull(),
  },
  (table) => [
    primaryKey({
      name: "role_permissions_pkey",
      columns: [table.roleId, table.permission],
    }),
    check(
      "role_permissions_permission_check",
      sql`${table.permission} in ('sale.create', 'sale.void', 'sale.refund', 'price.override', 'batch.override', 'stock.receive', 'stock.adjust', 'transfer.initiate', 'transfer.receive', 'report.view_branch', 'report.view_all', 'medicine.edit', 'user.manage', 'audit.view')`,
    ),
  ],
);
