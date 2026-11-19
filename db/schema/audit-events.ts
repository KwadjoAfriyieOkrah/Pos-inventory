import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { branches } from "./branches";
import { organizations } from "./organizations";
import { users } from "./users";

// Audit payloads must never include passwords, tokens, or other secrets.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    branchId: uuid("branch_id"),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    // NULL skips the composite check under default MATCH SIMPLE, keeping organization-level and system events valid.
    foreignKey({
      name: "audit_events_branch_organization_fk",
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }),
    foreignKey({
      name: "audit_events_actor_organization_fk",
      columns: [table.actorUserId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    index("audit_events_branch_id_created_at_idx").on(
      table.branchId,
      table.createdAt,
    ),
    index("audit_events_organization_id_created_at_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);
