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
    status: text("status").notNull().default("active"),
    classification: text("classification"),
    unitPricePesewas: bigint("unit_price_pesewas", { mode: "number" }),
  },
  (table) => [
    check(
      "medicines_status_check",
      sql`${table.status} in ('pending', 'active')`,
    ),
    check(
      "medicines_classification_check",
      sql`${table.classification} is null or ${table.classification} in ('OTC', 'prescription_only', 'controlled')`,
    ),
    check(
      "medicines_unit_price_pesewas_check",
      sql`${table.unitPricePesewas} >= 0`,
    ),
    check(
      "medicines_active_fields_check",
      sql`${table.status} = 'pending' or (${table.classification} is not null and ${table.unitPricePesewas} is not null)`,
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
