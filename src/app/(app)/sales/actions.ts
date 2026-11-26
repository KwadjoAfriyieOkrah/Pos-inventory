"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { loadScope } from "@/server/auth/scope";
import {
  completeSale,
  SaleValidationError,
  type CompleteSaleResult,
} from "@/server/data/sales";
import { ForbiddenError } from "@/server/data/errors";
import { PERMISSIONS } from "@/server/data/permissions";
import type { AuthorizedBranch } from "@/server/data/scope";
import { can, requireBranch } from "@/server/data/scope";
import { requestVoid } from "@/server/data/sale-void";
import { z } from "zod";

export type SaleActionState = {
  error: string | null;
  result: CompleteSaleResult | null;
};

const initialState: SaleActionState = { error: null, result: null };

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function getSignedInScope() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return loadScope(session.user.id, session.user.organizationId);
}

export async function completeSaleAction(
  _previousState: SaleActionState,
  formData: FormData,
): Promise<SaleActionState> {
  const scope = await getSignedInScope();
  const branchId = [...scope.branches.keys()].find((id) =>
    can(scope, id, PERMISSIONS.saleCreate),
  );
  if (!branchId) {
    return {
      ...initialState,
      error: "You do not have a branch where sales can be created.",
    };
  }

  const access = await requireBranch(scope, branchId, PERMISSIONS.saleCreate);
  const medicineIds = formData.getAll("medicineId");
  const quantities = formData.getAll("quantity");
  const lines =
    medicineIds.length === quantities.length
      ? medicineIds.map((medicineId, index) => ({
          medicineId: typeof medicineId === "string" ? medicineId : "",
          quantity:
            typeof quantities[index] === "string" ? quantities[index] : "",
        }))
      : [];

  try {
    const result = await completeSale(scope, access, {
      idempotencyKey: formString(formData, "idempotencyKey"),
      lines,
      paymentMethod: formString(formData, "paymentMethod"),
      tenderedGhs: formString(formData, "tenderedGhs"),
      reference: formString(formData, "reference"),
    });

    revalidatePath("/stock");
    revalidatePath("/dashboard");
    return { error: null, result };
  } catch (error) {
    if (error instanceof SaleValidationError) {
      return { ...initialState, error: error.message };
    }
    throw error;
  }
}

export type VoidRequestState = {
  message: string | null;
  tone: "success" | "error" | null;
};

const voidRequestSchema = z.object({
  saleId: z.string().uuid(),
  branchId: z.string().uuid(),
  reason: z
    .string()
    .trim()
    .min(5, "Give a reason of at least 5 characters.")
    .max(200, "Keep the reason under 200 characters."),
});

export async function requestVoidAction(
  _previousState: VoidRequestState,
  formData: FormData,
): Promise<VoidRequestState> {
  const parsed = voidRequestSchema.safeParse({
    saleId: formString(formData, "saleId"),
    branchId: formString(formData, "branchId"),
    reason: formString(formData, "reason"),
  });
  if (!parsed.success) {
    return {
      message: parsed.error.issues[0]?.message ?? "Check the sale and reason.",
      tone: "error",
    };
  }

  const scope = await getSignedInScope();
  let access: AuthorizedBranch;
  try {
    access = await requireBranch(scope, parsed.data.branchId, PERMISSIONS.saleCreate);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { message: "You cannot request voids for this branch.", tone: "error" };
    }
    throw error;
  }

  const result = await requestVoid(scope, access, parsed.data.saleId, parsed.data.reason);
  revalidatePath("/sales/history");
  if (!result.ok) return { message: result.message, tone: "error" };
  return result.status === "completed"
    ? { message: "Voided. The stock has been returned.", tone: "success" }
    : { message: "Request sent. The owner will approve it in Void approvals.", tone: "success" };
}
