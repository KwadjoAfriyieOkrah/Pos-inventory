import { date, integer, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { branches } from "./branches";

export const branchSaleCounters = pgTable(
  "branch_sale_counters",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    businessDate: date("business_date").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.branchId, table.businessDate] }),
  ],
);
