import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const loginFailures = pgTable(
  "login_failures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keyType: text("key_type").notNull(),
    keyHash: text("key_hash").notNull(),
    failedAt: timestamp("failed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: text("status").notNull().default("failed"),
  },
  (table) => [
    check(
      "login_failures_key_type_check",
      sql`${table.keyType} in ('email', 'terminal')`,
    ),
    check(
      "login_failures_key_hash_length_check",
      sql`length(${table.keyHash}) = 64`,
    ),
    check(
      "login_failures_status_check",
      sql`${table.status} in ('pending', 'failed', 'succeeded')`,
    ),
    index("login_failures_key_type_key_hash_failed_at_idx").on(
      table.keyType,
      table.keyHash,
      table.failedAt,
    ),
  ],
);
