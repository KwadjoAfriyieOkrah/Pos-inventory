import { and, desc, eq } from "drizzle-orm";
import { auditEvents } from "../../../db/schema";
import { db } from "@/server/db/client";
import { requireBranch, type DataScope } from "./scope";

export async function listAuditEvents(
  scope: DataScope,
  branchId: string,
  options: { limit: number },
) {
  requireBranch(scope, branchId, "audit.view");

  const requestedLimit = Number.isFinite(options.limit)
    ? Math.trunc(options.limit)
    : 200;
  const limit = Math.min(200, Math.max(0, requestedLimit));
  if (limit === 0) return [];

  return db
    .select({
      id: auditEvents.id,
      organizationId: auditEvents.organizationId,
      branchId: auditEvents.branchId,
      terminalId: auditEvents.terminalId,
      actorUserId: auditEvents.actorUserId,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      payload: auditEvents.payload,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, scope.organizationId),
        eq(auditEvents.branchId, branchId),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}
