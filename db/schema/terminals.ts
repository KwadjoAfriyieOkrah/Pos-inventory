import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { organizations } from "./organizations";

export const terminals = pgTable(
  "terminals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").notNull(),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "terminals_branch_organization_fk",
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
    unique("terminals_token_hash_unique").on(table.tokenHash),
    unique("terminals_id_organization_id_unique").on(
      table.id,
      table.organizationId,
    ),
    check(
      "terminals_token_hash_length_check",
      sql`char_length(${table.tokenHash}) = 64`,
    ),
    index("terminals_branch_id_idx").on(table.branchId),
  ],
);
