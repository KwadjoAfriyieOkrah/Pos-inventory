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
import { PERMISSIONS } from "@/server/data/permissions";
import { can, requireBranch } from "@/server/data/scope";

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
