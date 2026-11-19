import { ForbiddenError } from "./errors";

export interface DataScope {
  userId: string;
  organizationId: string;
  branches: Map<string, Set<string>>;
}

export function can(
  scope: DataScope,
  branchId: string,
  permission: string,
): boolean {
  return scope.branches.get(branchId)?.has(permission) ?? false;
}

export function requireBranch(
  scope: DataScope,
  branchId: string,
  permission: string,
): void {
  if (!can(scope, branchId, permission)) {
    throw new ForbiddenError();
  }
}
