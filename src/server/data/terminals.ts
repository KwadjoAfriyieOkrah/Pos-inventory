import { and, eq } from "drizzle-orm";
import { terminals } from "../../../db/schema";
import { db } from "@/server/db/client";
import { PERMISSIONS } from "./permissions";
import {
  requireBranch,
  type AuthorizedBranch,
  type DataScope,
} from "./scope";

export async function listTerminals(
  scope: DataScope,
  access: AuthorizedBranch,
  options: { limit: number } = { limit: 200 },
) {
  access = await requireBranch(
    scope,
    access.branchId,
    PERMISSIONS.userManage,
  );

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
        eq(terminals.organizationId, access.organizationId),
        eq(terminals.branchId, access.branchId),
      ),
    )
    .limit(limit);
}
