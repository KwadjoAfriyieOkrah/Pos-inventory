import { pgTable, date, index, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    branchCode: text("branch_code").notNull(),
    digitalAddress: text("digital_address").notNull(),
    phone: text("phone"),
    licenceNumber: text("licence_number").notNull(),
    licenceExpiresOn: date("licence_expires_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("branches_licence_number_unique").on(table.licenceNumber),
    unique("branches_organization_id_branch_code_unique").on(
      table.organizationId,
      table.branchCode,
    ),
    unique("branches_id_organization_id_unique").on(
      table.id,
      table.organizationId,
    ),
    index("branches_organization_id_idx").on(table.organizationId),
  ],
);
