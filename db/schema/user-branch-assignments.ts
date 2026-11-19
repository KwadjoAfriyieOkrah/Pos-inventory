import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { roles } from "./roles";
import { users } from "./users";

export const userBranchAssignments = pgTable(
  "user_branch_assignments",
  {
    userId: uuid("user_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    roleId: uuid("role_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
  },
  (table) => [
    primaryKey({
      name: "user_branch_assignments_pkey",
      columns: [table.userId, table.branchId],
    }),
    foreignKey({
      name: "user_branch_assignments_user_organization_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "user_branch_assignments_branch_organization_fk",
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
    foreignKey({
      name: "user_branch_assignments_role_organization_fk",
      columns: [table.roleId, table.organizationId],
      foreignColumns: [roles.id, roles.organizationId],
    }),
    index("user_branch_assignments_branch_id_idx").on(table.branchId),
  ],
);
