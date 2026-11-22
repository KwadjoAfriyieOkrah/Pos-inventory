import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditEvents,
  batches,
  goodsReceiptLines,
  goodsReceipts,
  medicines,
  stockMovements,
} from "../../../db/schema";
import { accraToday } from "@/lib/time";
import { toPesewas } from "@/lib/money";
import { db } from "@/server/db/client";
import { PERMISSIONS } from "./permissions";
import {
  requireBranch,
  type AuthorizedBranch,
  type DataScope,
} from "./scope";

export class ReceivingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceivingValidationError";
  }
}

export type ReceivingMedicine = {
  id: string;
  name: string;
  dosageForm: string;
  status: string;
};

export type PendingMedicine = {
  id: string;
  name: string;
  dosageForm: string;
};

export type ReceiveMedicineLine = {
  medicineId?: string;
  newMedicine?: { name: string; dosageForm: string };
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  unitCostGhs: string;
};

export type ReceiveGoodsInput = {
  idempotencyKey: string;
  supplierName: string;
  supplierInvoice?: string;
  lines: readonly ReceiveMedicineLine[];
};

export type ReceiveGoodsResult = {
  receiptId: string;
  duplicate: boolean;
};

const pendingMedicineSchema = z.object({
  name: z.string().trim().min(1, "Medicine name is required.").max(200),
  dosageForm: z
    .string()
    .trim()
    .min(1, "Dosage form is required.")
    .max(200),
});

const quantitySchema = z
  .string()
  .regex(/^[1-9]\d*$/, "Quantity must be a positive whole number.")
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .positive()
      .max(2_147_483_647, "Quantity is too large."),
  );

const receiveLineSchema = z
  .object({
    medicineId: z.string().uuid().optional(),
    newMedicine: pendingMedicineSchema.optional(),
    batchNumber: z
      .string()
      .trim()
      .min(1, "Batch number is required.")
      .max(200),
    expiryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry date must be a valid date.")
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return (
          Number.isFinite(parsed.getTime()) &&
          parsed.toISOString().slice(0, 10) === value
        );
      }, "Expiry date must be a valid date."),
    quantity: quantitySchema,
    unitCostGhs: z.string(),
  })
  .superRefine((line, context) => {
    if (Boolean(line.medicineId) === Boolean(line.newMedicine)) {
      context.addIssue({
        code: "custom",
        message: "Choose an existing medicine or enter a new medicine.",
      });
    }
  });

const receiptHeaderSchema = z.object({
  idempotencyKey: z
    .string()
    .trim()
    .min(1, "Receipt request key is required.")
    .max(200),
  supplierName: z.string().trim().min(1, "Supplier name is required.").max(200),
  supplierInvoice: z.string().trim().max(200).optional(),
});

function firstIssue(error: z.ZodError): ReceivingValidationError {
  const issue = error.issues[0];
  return new ReceivingValidationError(
    issue?.message ?? "The receipt details are invalid.",
  );
}

async function findOrCreatePendingMedicine(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  input: { name: string; dosageForm: string },
): Promise<PendingMedicine> {
  const [existing] = await tx
    .select({
      id: medicines.id,
      name: medicines.name,
      dosageForm: medicines.dosageForm,
    })
    .from(medicines)
    .where(
      and(
        eq(medicines.organizationId, organizationId),
        eq(medicines.name, input.name),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [inserted] = await tx
    .insert(medicines)
    .values({
      organizationId,
      name: input.name,
      dosageForm: input.dosageForm,
      status: "pending",
      classification: null,
      unitPricePesewas: null,
    })
    .onConflictDoNothing({
      target: [medicines.organizationId, medicines.name],
    })
    .returning({
      id: medicines.id,
      name: medicines.name,
      dosageForm: medicines.dosageForm,
    });

  if (inserted) return inserted;

  const [concurrent] = await tx
    .select({
      id: medicines.id,
      name: medicines.name,
      dosageForm: medicines.dosageForm,
    })
    .from(medicines)
    .where(
      and(
        eq(medicines.organizationId, organizationId),
        eq(medicines.name, input.name),
      ),
    )
    .limit(1);

  if (!concurrent) {
    throw new Error("Medicine could not be created.");
  }

  return concurrent;
}

export async function listReceivingMedicines(
  scope: DataScope,
  access: AuthorizedBranch,
): Promise<ReceivingMedicine[]> {
  access = await requireBranch(scope, access.branchId, PERMISSIONS.stockReceive);

  return db
    .select({
      id: medicines.id,
      name: medicines.name,
      dosageForm: medicines.dosageForm,
      status: medicines.status,
    })
    .from(medicines)
    .where(eq(medicines.organizationId, access.organizationId))
    .orderBy(asc(medicines.name));
}

export async function listPendingMedicines(
  scope: DataScope,
  access: AuthorizedBranch,
): Promise<PendingMedicine[]> {
  access = await requireBranch(
    scope,
    access.branchId,
    PERMISSIONS.reportViewBranch,
  );

  return db
    .select({
      id: medicines.id,
      name: medicines.name,
      dosageForm: medicines.dosageForm,
    })
    .from(medicines)
    .where(
      and(
        eq(medicines.organizationId, access.organizationId),
        eq(medicines.status, "pending"),
      ),
    )
    .orderBy(asc(medicines.name));
}

export async function createPendingMedicine(
  scope: DataScope,
  access: AuthorizedBranch,
  input: { name: string; dosageForm: string },
): Promise<PendingMedicine> {
  access = await requireBranch(scope, access.branchId, PERMISSIONS.stockReceive);

  const parsed = pendingMedicineSchema.safeParse(input);
  if (!parsed.success) throw firstIssue(parsed.error);

  return db.transaction((tx) =>
    findOrCreatePendingMedicine(tx, access.organizationId, parsed.data),
  );
}

export async function activateMedicine(
  scope: DataScope,
  access: AuthorizedBranch,
  medicineId: string,
  input: { classification: string; unitPriceGhs: string },
): Promise<void> {
  access = await requireBranch(scope, access.branchId, PERMISSIONS.medicineEdit);

  const parsed = z
    .object({
      medicineId: z.string().uuid("Medicine not found."),
      classification: z.enum(["OTC", "prescription_only", "controlled"], {
        error: "Choose a medicine classification.",
      }),
      unitPriceGhs: z.string(),
    })
    .safeParse({ ...input, medicineId });
  if (!parsed.success) throw firstIssue(parsed.error);

  let unitPricePesewas: number;
  try {
    unitPricePesewas = toPesewas(parsed.data.unitPriceGhs);
  } catch (error) {
    if (error instanceof Error) {
      throw new ReceivingValidationError(error.message);
    }
    throw error;
  }

  await db.transaction(async (tx) => {
    const [medicine] = await tx
      .select({
        id: medicines.id,
        classification: medicines.classification,
        unitPricePesewas: medicines.unitPricePesewas,
      })
      .from(medicines)
      .where(
        and(
          eq(medicines.id, parsed.data.medicineId),
          eq(medicines.organizationId, access.organizationId),
        ),
      )
      .for("update")
      .limit(1);

    if (!medicine) {
      throw new ReceivingValidationError("Medicine not found.");
    }

    await tx
      .update(medicines)
      .set({
        status: "active",
        classification: parsed.data.classification,
        unitPricePesewas,
      })
      .where(eq(medicines.id, medicine.id));

    await tx.insert(auditEvents).values({
      organizationId: access.organizationId,
      branchId: access.branchId,
      actorUserId: scope.userId,
      action: "medicine.activated",
      entityType: "medicine",
      entityId: medicine.id,
      payload: {
        oldClassification: medicine.classification,
        oldUnitPricePesewas: medicine.unitPricePesewas,
        newClassification: parsed.data.classification,
        newUnitPricePesewas: unitPricePesewas,
      },
    });
  });
}

export async function receiveGoods(
  scope: DataScope,
  access: AuthorizedBranch,
  input: ReceiveGoodsInput,
): Promise<ReceiveGoodsResult> {
  access = await requireBranch(scope, access.branchId, PERMISSIONS.stockReceive);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);

    const [createdReceipt] = await tx
      .insert(goodsReceipts)
      .values({
        organizationId: access.organizationId,
        branchId: access.branchId,
        supplierName: input.supplierName,
        supplierInvoice: input.supplierInvoice || null,
        receivedBy: scope.userId,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({
        target: [goodsReceipts.branchId, goodsReceipts.idempotencyKey],
      })
      .returning({ id: goodsReceipts.id });

    if (!createdReceipt) {
      const [existingReceipt] = await tx
        .select({ id: goodsReceipts.id })
        .from(goodsReceipts)
        .where(
          and(
            eq(goodsReceipts.organizationId, access.organizationId),
            eq(goodsReceipts.branchId, access.branchId),
            eq(goodsReceipts.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (!existingReceipt) {
        throw new Error("Receipt could not be retrieved after an idempotency conflict.");
      }

      return { receiptId: existingReceipt.id, duplicate: true };
    }

    const header = receiptHeaderSchema.safeParse({
      idempotencyKey: input.idempotencyKey,
      supplierName: input.supplierName,
      supplierInvoice: input.supplierInvoice,
    });
    if (!header.success) throw firstIssue(header.error);

    const parsedLines = z
      .array(receiveLineSchema)
      .min(1, "Add at least one medicine line.")
      .safeParse(input.lines);
    if (!parsedLines.success) throw firstIssue(parsedLines.error);

    const today = accraToday();
    const normalizedLines: {
      medicineId: string;
      batchNumber: string;
      expiryDate: string;
      quantity: number;
      unitCostPesewas: number;
    }[] = [];

    for (const line of parsedLines.data) {
      let medicine: { id: string };
      if (line.newMedicine) {
        medicine = await findOrCreatePendingMedicine(
          tx,
          access.organizationId,
          line.newMedicine,
        );
      } else {
        if (!line.medicineId) {
          throw new ReceivingValidationError("Choose a medicine.");
        }
        const [existing] = await tx
          .select({ id: medicines.id })
          .from(medicines)
          .where(
            and(
              eq(medicines.id, line.medicineId),
              eq(medicines.organizationId, access.organizationId),
            ),
          )
          .limit(1);
        if (!existing) {
          throw new ReceivingValidationError("Medicine not found.");
        }
        medicine = existing;
      }

      let unitCostPesewas: number;
      try {
        unitCostPesewas = toPesewas(line.unitCostGhs);
      } catch (error) {
        if (error instanceof Error) {
          throw new ReceivingValidationError(error.message);
        }
        throw error;
      }

      normalizedLines.push({
        medicineId: medicine.id,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        unitCostPesewas,
      });
    }

    normalizedLines.sort(
      (left, right) =>
        left.medicineId.localeCompare(right.medicineId) ||
        left.batchNumber.localeCompare(right.batchNumber),
    );

    for (const line of normalizedLines) {
      if (line.expiryDate <= today) {
        throw new ReceivingValidationError("Expiry date must be after today.");
      }

      let [batch] = await tx
        .select({
          id: batches.id,
          expiryDate: batches.expiryDate,
          unitCostPesewas: batches.unitCostPesewas,
          quantityOnHand: batches.quantityOnHand,
        })
        .from(batches)
        .where(
          and(
            eq(batches.organizationId, access.organizationId),
            eq(batches.branchId, access.branchId),
            eq(batches.medicineId, line.medicineId),
            eq(batches.batchNumber, line.batchNumber),
          ),
        )
        .for("update")
        .limit(1);

      let batchId: string;
      if (batch) {
        if (
          batch.expiryDate !== line.expiryDate ||
          batch.unitCostPesewas !== line.unitCostPesewas
        ) {
          throw new ReceivingValidationError(
            "Batch already exists with a different expiry or cost.",
          );
        }

        const updatedQuantity = batch.quantityOnHand + line.quantity;
        if (!Number.isSafeInteger(updatedQuantity) || updatedQuantity > 2_147_483_647) {
          throw new ReceivingValidationError("Quantity is too large.");
        }

        await tx
          .update(batches)
          .set({ quantityOnHand: updatedQuantity })
          .where(eq(batches.id, batch.id));
        batchId = batch.id;
      } else {
        const [insertedBatch] = await tx
          .insert(batches)
          .values({
            organizationId: access.organizationId,
            branchId: access.branchId,
            medicineId: line.medicineId,
            batchNumber: line.batchNumber,
            expiryDate: line.expiryDate,
            unitCostPesewas: line.unitCostPesewas,
            quantityOnHand: line.quantity,
          })
          .onConflictDoNothing({
            target: [
              batches.branchId,
              batches.medicineId,
              batches.batchNumber,
            ],
          })
          .returning({ id: batches.id });

        if (insertedBatch) {
          batchId = insertedBatch.id;
        } else {
          [batch] = await tx
            .select({
              id: batches.id,
              expiryDate: batches.expiryDate,
              unitCostPesewas: batches.unitCostPesewas,
              quantityOnHand: batches.quantityOnHand,
            })
            .from(batches)
            .where(
              and(
                eq(batches.organizationId, access.organizationId),
                eq(batches.branchId, access.branchId),
                eq(batches.medicineId, line.medicineId),
                eq(batches.batchNumber, line.batchNumber),
              ),
            )
            .for("update")
            .limit(1);

          if (!batch) {
            throw new Error("Batch could not be retrieved after a concurrent insert.");
          }
          if (
            batch.expiryDate !== line.expiryDate ||
            batch.unitCostPesewas !== line.unitCostPesewas
          ) {
            throw new ReceivingValidationError(
              "Batch already exists with a different expiry or cost.",
            );
          }

          const updatedQuantity = batch.quantityOnHand + line.quantity;
          if (!Number.isSafeInteger(updatedQuantity) || updatedQuantity > 2_147_483_647) {
            throw new ReceivingValidationError("Quantity is too large.");
          }

          await tx
            .update(batches)
            .set({ quantityOnHand: updatedQuantity })
            .where(eq(batches.id, batch.id));
          batchId = batch.id;
        }
      }

      await tx.insert(stockMovements).values({
        organizationId: access.organizationId,
        branchId: access.branchId,
        batchId,
        movementType: "receipt",
        quantityDelta: line.quantity,
        referenceId: createdReceipt.id,
        createdBy: scope.userId,
      });

      await tx.insert(goodsReceiptLines).values({
        receiptId: createdReceipt.id,
        organizationId: access.organizationId,
        medicineId: line.medicineId,
        batchId,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate,
        quantity: line.quantity,
        unitCostPesewas: line.unitCostPesewas,
      });
    }

    await tx.insert(auditEvents).values({
      organizationId: access.organizationId,
      branchId: access.branchId,
      actorUserId: scope.userId,
      action: "stock.received",
      entityType: "goods_receipt",
      entityId: createdReceipt.id,
      payload: { lines: normalizedLines.length },
    });

    return { receiptId: createdReceipt.id, duplicate: false };
  });
}
