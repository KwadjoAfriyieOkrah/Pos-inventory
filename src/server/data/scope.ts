import { auditEvents } from "../../../db/schema";
import { db } from "@/server/db/client";
import { ForbiddenError } from "./errors";
import type { Permission } from "./permissions";

declare const authorizedBranchBrand: unique symbol;

export type AuthorizedBranch = {
  organizationId: string;
  branchId: string;
  readonly [authorizedBranchBrand]: true;
};

export const AUDIT_ACTIONS = {
  accessDenied: "access.denied",
} as const;

export interface DataScope {
  userId: string;
  organizationId: string;
  branches: Map<string, Set<string>>;
}

export function can(
  scope: DataScope,
  branchId: string,
  permission: Permission,
): boolean {
  return scope.branches.get(branchId)?.has(permission) ?? false;
}

export async function requireBranch(
  scope: DataScope,
  branchId: string,
  permission: Permission,
): Promise<AuthorizedBranch> {
  if (!can(scope, branchId, permission)) {
    // Keep this outside the caller's transaction so rollback cannot erase the denial. Its foreign keys take only key-share locks on the referenced branch and user rows, not the batch rows sales lock. If the record cannot be written, the check must still deny access.
    try {
      await db.insert(auditEvents).values({
        organizationId: scope.organizationId,
        branchId,
        actorUserId: scope.userId,
        action: AUDIT_ACTIONS.accessDenied,
        entityType: "branch",
        entityId: branchId,
        payload: { permission },
      });
    } catch {
      throw new ForbiddenError();
    }

    throw new ForbiddenError();
  }

  // This is the only place authorization is created.
  return {
    organizationId: scope.organizationId,
    branchId,
  } as AuthorizedBranch;
}
