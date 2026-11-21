import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./organizations";

export const medicines = pgTable(
  "medicines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    dosageForm: text("dosage_form").notNull(),
    unitPricePesewas: bigint("unit_price_pesewas", { mode: "number" }).notNull(),
  },
  (table) => [
    check(
      "medicines_unit_price_pesewas_check",
      sql`${table.unitPricePesewas} >= 0`,
    ),
    unique("medicines_organization_id_name_unique").on(
      table.organizationId,
      table.name,
    ),
    unique("medicines_id_organization_id_unique").on(
      table.id,
      table.organizationId,
    ),
  ],
);
