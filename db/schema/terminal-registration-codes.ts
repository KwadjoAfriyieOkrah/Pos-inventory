import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { organizations } from "./organizations";

export const terminalRegistrationCodes = pgTable(
  "terminal_registration_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id").notNull(),
    name: text("name").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "terminal_registration_codes_branch_organization_fk",
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
    unique("terminal_registration_codes_code_hash_unique").on(table.codeHash),
    check(
      "terminal_registration_codes_code_hash_length_check",
      sql`char_length(${table.codeHash}) = 64`,
    ),
  ],
);
