"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { loadScope } from "@/server/auth/scope";
import {
  activateMedicine,
  listReceiptLines,
  receiveGoods,
  ReceivingValidationError,
} from "@/server/data/receiving";
import { PERMISSIONS } from "@/server/data/permissions";
import { can, requireBranch } from "@/server/data/scope";

export type ReceivingActionState = {
  error: string | null;
  success: string | null;
  receiptLines: {
    medicineName: string;
    batchNumber: string;
    expiryDate: string;
    quantity: number;
    status: "pending" | "active";
    unitCostPesewas?: number;
  }[] | null;
};

const initialState: ReceivingActionState = {
  error: null,
  success: null,
  receiptLines: null,
};

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

export async function receiveStockAction(
  _previousState: ReceivingActionState,
  formData: FormData,
): Promise<ReceivingActionState> {
  const scope = await getSignedInScope();
  const branchId = formString(formData, "branchId");

  if (!can(scope, branchId, PERMISSIONS.stockReceive)) {
    return {
      ...initialState,
      error: "You do not have permission to receive stock.",
    };
  }

  const access = await requireBranch(
    scope,
    branchId,
    PERMISSIONS.stockReceive,
  );
  const newMedicine = formString(formData, "medicineMode") === "new";
  const line = {
    ...(newMedicine
      ? {
          newMedicine: {
            name: formString(formData, "medicineName"),
            dosageForm: formString(formData, "dosageForm"),
          },
        }
      : { medicineId: formString(formData, "medicineId") }),
    batchNumber: formString(formData, "batchNumber"),
    expiryDate: formString(formData, "expiryDate"),
    quantity: formString(formData, "quantity"),
    unitCostGhs: formString(formData, "unitCostGhs"),
  };

  try {
    const result = await receiveGoods(scope, access, {
      idempotencyKey: formString(formData, "idempotencyKey"),
      supplierName: formString(formData, "supplierName"),
      supplierInvoice: formString(formData, "supplierInvoice"),
      lines: [line],
    });

    revalidatePath("/stock");
    revalidatePath("/stock/receive");
    const receiptLines = await listReceiptLines(
      scope,
      access,
      result.receiptId,
    );
    const receivedLine = receiptLines[0];
    if (!receivedLine) {
      throw new Error("The received receipt has no lines.");
    }
    const receivedNewMedicine =
      newMedicine && receivedLine.status === "pending";

    return {
      error: null,
      success: receivedNewMedicine
        ? `Received ${receivedLine.quantity} units of ${receivedLine.medicineName} (new). It's waiting for owner approval before it can be sold.`
        : `Received ${receivedLine.quantity} units of ${receivedLine.medicineName}.`,
      receiptLines,
    };
  } catch (error) {
    if (error instanceof ReceivingValidationError) {
      return { ...initialState, error: error.message };
    }
    throw error;
  }
}

export async function activateMedicineAction(
  _previousState: ReceivingActionState,
  formData: FormData,
): Promise<ReceivingActionState> {
  const scope = await getSignedInScope();
  const branchId = formString(formData, "branchId");

  if (!can(scope, branchId, PERMISSIONS.medicineEdit)) {
    return {
      ...initialState,
      error: "You do not have permission to approve medicines.",
    };
  }

  const access = await requireBranch(
    scope,
    branchId,
    PERMISSIONS.medicineEdit,
  );

  try {
    await activateMedicine(scope, access, formString(formData, "medicineId"), {
      classification: formString(formData, "classification"),
      unitPriceGhs: formString(formData, "unitPriceGhs"),
    });
    revalidatePath("/stock");
    return {
      error: null,
      success: "Medicine approved and activated.",
      receiptLines: null,
    };
  } catch (error) {
    if (error instanceof ReceivingValidationError) {
      return { ...initialState, error: error.message };
    }
    throw error;
  }
}
