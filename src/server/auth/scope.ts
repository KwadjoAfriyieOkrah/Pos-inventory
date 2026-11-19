import "server-only";
import { and, eq } from "drizzle-orm";
import {
  branches,
  rolePermissions,
  roles,
  userBranchAssignments,
  users,
} from "../../../db/schema";
import { db } from "@/server/db/client";
import type { DataScope } from "../data/scope";

export async function loadScope(
  userId: string,
  organizationId: string,
): Promise<DataScope> {
  const rows = await db
    .select({
      branchId: userBranchAssignments.branchId,
      permission: rolePermissions.permission,
    })
    .from(userBranchAssignments)
    .innerJoin(
      users,
      and(
        eq(users.id, userBranchAssignments.userId),
        eq(users.organizationId, userBranchAssignments.organizationId),
      ),
    )
    .innerJoin(
      branches,
      and(
        eq(branches.id, userBranchAssignments.branchId),
        eq(branches.organizationId, userBranchAssignments.organizationId),
      ),
    )
    .innerJoin(
      roles,
      and(
        eq(roles.id, userBranchAssignments.roleId),
        eq(roles.organizationId, userBranchAssignments.organizationId),
      ),
    )
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(
      and(
        eq(userBranchAssignments.userId, userId),
        eq(userBranchAssignments.organizationId, organizationId),
        eq(users.isActive, true),
        eq(users.organizationId, organizationId),
        eq(branches.organizationId, organizationId),
        eq(roles.organizationId, organizationId),
      ),
    );

  const branchPermissions = new Map<string, Set<string>>();

  for (const row of rows) {
    let permissions = branchPermissions.get(row.branchId);
    if (!permissions) {
      permissions = new Set<string>();
      branchPermissions.set(row.branchId, permissions);
    }

    if (row.permission !== null) {
      permissions.add(row.permission);
    }
  }

  return { userId, organizationId, branches: branchPermissions };
}
