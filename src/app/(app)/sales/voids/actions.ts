"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/server/auth";
import { loadScope } from "@/server/auth/scope";
import { PERMISSIONS } from "@/server/data/permissions";
import { can, requireBranch } from "@/server/data/scope";
import { approveVoid, rejectVoid } from "@/server/data/sale-void";

const voidIdSchema = z.object({
  voidId: z.string().uuid(),
});

async function getSignedInScope() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return loadScope(session.user.id, session.user.organizationId);
}

export async function approveVoidAction(
  formData: FormData,
): Promise<string | null> {
  const scope = await getSignedInScope();
  const parsed = voidIdSchema.safeParse({
    voidId: formData.get("voidId"),
  });

  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? null;
  }

  const branchId = [...scope.branches.keys()].find((id) =>
    can(scope, id, PERMISSIONS.saleVoid),
  );
  if (!branchId) {
    return "You do not have permission to approve sale voids.";
  }

  const access = await requireBranch(scope, branchId, PERMISSIONS.saleVoid);
  const result = await approveVoid(scope, access, parsed.data.voidId);
  if (!result.ok) {
    return result.message;
  }

  revalidatePath("/sales/voids");
  return null;
}

export async function rejectVoidAction(
  formData: FormData,
): Promise<string | null> {
  const scope = await getSignedInScope();
  const parsed = voidIdSchema.safeParse({
    voidId: formData.get("voidId"),
  });

  if (!parsed.success) {
    return parsed.error.issues[0]?.message ?? null;
  }

  const branchId = [...scope.branches.keys()].find((id) =>
    can(scope, id, PERMISSIONS.saleVoid),
  );
  if (!branchId) {
    return "You do not have permission to reject sale voids.";
  }

  const access = await requireBranch(scope, branchId, PERMISSIONS.saleVoid);
  const result = await rejectVoid(scope, access, parsed.data.voidId);
  if (!result.ok) {
    return result.message;
  }

  revalidatePath("/sales/voids");
  return null;
}
