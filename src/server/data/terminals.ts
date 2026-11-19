import { and, eq } from "drizzle-orm";
import { terminals } from "../../../db/schema";
import { db } from "@/server/db/client";
import { requireBranch, type DataScope } from "./scope";

export async function listTerminals(
  scope: DataScope,
  branchId: string,
  options: { limit: number } = { limit: 200 },
) {
  requireBranch(scope, branchId, "user.manage");

  const requestedLimit = Number.isFinite(options.limit)
    ? Math.trunc(options.limit)
    : 200;
  const limit = Math.min(200, Math.max(0, requestedLimit));
  if (limit === 0) return [];

  return db
    .select({
      id: terminals.id,
      name: terminals.name,
      branchId: terminals.branchId,
      registeredAt: terminals.registeredAt,
      revokedAt: terminals.revokedAt,
    })
    .from(terminals)
    .where(
      and(
        eq(terminals.organizationId, scope.organizationId),
        eq(terminals.branchId, branchId),
      ),
    )
    .limit(limit);
}
