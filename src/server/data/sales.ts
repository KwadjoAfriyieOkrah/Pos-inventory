import "server-only";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditEvents,
  batches,
  medicines,
  payments,
  saleLines,
  sales,
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

export class SaleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleValidationError";
  }
}

export type CompleteSaleInput = {
  idempotencyKey: string;
  lines: readonly { medicineId: string; quantity: string }[];
  paymentMethod: string;
  tenderedGhs?: string;
  reference?: string;
};

export type CompleteSaleResult = {
  saleId: string;
  totalPesewas: number;
  paymentMethod: "cash" | "momo";
  changePesewas: number;
  reference: string | null;
  duplicate: boolean;
};

const lineSchema = z.object({
  medicineId: z.string().uuid("Medicine is not available for sale."),
  quantity: z
    .string()
    .regex(/^[1-9]\d*$/, "Quantity must be a whole number from 1 to 99.")
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(1)
        .max(99, "Quantity must be a whole number from 1 to 99."),
    ),
});

const saleInputSchema = z
  .object({
    idempotencyKey: z
      .string()
      .trim()
      .min(1, "Sale request key is required.")
      .max(200),
    lines: z.array(lineSchema).min(1, "Add at least one item to the sale."),
    paymentMethod: z.enum(["cash", "momo"], {
      error: "Choose a valid payment method.",
    }),
    tenderedGhs: z.string().optional(),
    reference: z.string().trim().optional(),
  })
  .superRefine((input, context) => {
    const medicineIds = new Set<string>();
    for (const line of input.lines) {
      if (medicineIds.has(line.medicineId)) {
        context.addIssue({
          code: "custom",
          message: "Each medicine may only appear once in the sale.",
        });
        break;
      }
      medicineIds.add(line.medicineId);
    }

    if (input.paymentMethod === "cash" && !input.tenderedGhs) {
      context.addIssue({
        code: "custom",
        message: "Enter a valid amount using up to two decimal places.",
      });
    }

    if (input.paymentMethod === "momo") {
      const reference = input.reference?.trim() ?? "";
      if (reference.length < 4 || reference.length > 40) {
        context.addIssue({
          code: "custom",
          message: "MoMo reference must be 4 to 40 characters.",
        });
      }
    }
  });

type SaleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function firstIssue(error: z.ZodError): SaleValidationError {
  const issue = error.issues[0];
  return new SaleValidationError(
    issue?.message ?? "The sale details are invalid.",
  );
}

async function findSaleByIdempotencyKey(
  tx: SaleTransaction,
  organizationId: string,
  branchId: string,
  idempotencyKey: string,
): Promise<CompleteSaleResult | null> {
  const [existing] = await tx
    .select({
      saleId: sales.id,
      totalPesewas: sales.totalPesewas,
      paymentMethod: sales.paymentMethod,
      amountPesewas: payments.amountPesewas,
      paymentMethodRecorded: payments.method,
      reference: payments.reference,
    })
    .from(sales)
    .innerJoin(payments, eq(payments.saleId, sales.id))
    .where(
      and(
        eq(sales.organizationId, organizationId),
        eq(sales.branchId, branchId),
        eq(sales.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (!existing) return null;
  if (
    !Number.isSafeInteger(existing.totalPesewas) ||
    !Number.isSafeInteger(existing.amountPesewas) ||
    existing.paymentMethod !== existing.paymentMethodRecorded
  ) {
    throw new Error("Stored sale payment is inconsistent.");
  }

  const paymentMethod = existing.paymentMethod;
  if (paymentMethod !== "cash" && paymentMethod !== "momo") {
    throw new Error("Stored sale has an unsupported payment method.");
  }
  const changePesewas =
    paymentMethod === "cash"
      ? existing.amountPesewas - existing.totalPesewas
      : 0;
  if (!Number.isSafeInteger(changePesewas) || changePesewas < 0) {
    throw new Error("Stored sale change is inconsistent.");
  }

  return {
    saleId: existing.saleId,
    totalPesewas: existing.totalPesewas,
    paymentMethod,
    changePesewas,
    reference: existing.reference,
    duplicate: true,
  };
}

export async function completeSale(
  scope: DataScope,
  access: AuthorizedBranch,
  input: CompleteSaleInput,
): Promise<CompleteSaleResult> {
  access = await requireBranch(scope, access.branchId, PERMISSIONS.saleCreate);

  const key = z
    .string()
    .trim()
    .min(1, "Sale request key is required.")
    .max(200)
    .safeParse(input.idempotencyKey);
  if (!key.success) throw firstIssue(key.error);

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);

    const existing = await findSaleByIdempotencyKey(
      tx,
      access.organizationId,
      access.branchId,
      key.data,
    );
    if (existing) return existing;

    const parsed = saleInputSchema.safeParse(input);
    if (!parsed.success) throw firstIssue(parsed.error);

    const requestedLines = [...parsed.data.lines].sort((left, right) =>
      left.medicineId.localeCompare(right.medicineId),
    );
    const medicineIds = requestedLines.map((line) => line.medicineId);
    const medicineRows = await tx
      .select({
        id: medicines.id,
        name: medicines.name,
        unitPricePesewas: medicines.unitPricePesewas,
      })
      .from(medicines)
      .where(
        and(
          eq(medicines.organizationId, access.organizationId),
          eq(medicines.status, "active"),
          inArray(medicines.id, medicineIds),
        ),
      );
    const medicineById = new Map(
      medicineRows.map((medicine) => [medicine.id, medicine]),
    );

    let totalPesewas = 0;
    for (const line of requestedLines) {
      const medicine = medicineById.get(line.medicineId);
      if (!medicine || medicine.unitPricePesewas === null) {
        throw new SaleValidationError("Medicine is not available for sale.");
      }
      if (
        !Number.isSafeInteger(medicine.unitPricePesewas) ||
        medicine.unitPricePesewas < 0
      ) {
        throw new RangeError("Medicine price exceeds the supported money range.");
      }

      const lineTotalPesewas = medicine.unitPricePesewas * line.quantity;
      if (!Number.isSafeInteger(lineTotalPesewas)) {
        throw new RangeError("Sale line total exceeds the supported money range.");
      }
      totalPesewas += lineTotalPesewas;
      if (!Number.isSafeInteger(totalPesewas)) {
        throw new RangeError("Sale total exceeds the supported money range.");
      }
    }

    let tenderedPesewas: number;
    let reference: string | null = null;
    if (parsed.data.paymentMethod === "cash") {
      try {
        tenderedPesewas = toPesewas(parsed.data.tenderedGhs ?? "");
      } catch (error) {
        if (error instanceof Error) {
          throw new SaleValidationError(error.message);
        }
        throw error;
      }
      if (tenderedPesewas < totalPesewas) {
        throw new SaleValidationError("Tendered amount must cover the sale total.");
      }
    } else {
      tenderedPesewas = totalPesewas;
      reference = parsed.data.reference?.trim() ?? "";
      if (reference.length < 4 || reference.length > 40) {
        throw new SaleValidationError("MoMo reference must be 4 to 40 characters.");
      }
    }

    const [createdSale] = await tx
      .insert(sales)
      .values({
        organizationId: access.organizationId,
        branchId: access.branchId,
        cashierId: scope.userId,
        idempotencyKey: key.data,
        totalPesewas,
        paymentMethod: parsed.data.paymentMethod,
      })
      .onConflictDoNothing({
        target: [sales.branchId, sales.idempotencyKey],
      })
      .returning({
        id: sales.id,
        totalPesewas: sales.totalPesewas,
        paymentMethod: sales.paymentMethod,
      });

    if (!createdSale) {
      const duplicate = await findSaleByIdempotencyKey(
        tx,
        access.organizationId,
        access.branchId,
        key.data,
      );
      if (!duplicate) {
        throw new Error("Sale could not be retrieved after an idempotency conflict.");
      }
      return duplicate;
    }

    const allocations: {
      medicineId: string;
      batchId: string;
      quantity: number;
      unitPricePesewas: number;
      lineTotalPesewas: number;
      quantityOnHand: number;
    }[] = [];
    const today = accraToday();

    for (const line of requestedLines) {
      const medicine = medicineById.get(line.medicineId);
      if (!medicine || medicine.unitPricePesewas === null) {
        throw new SaleValidationError("Medicine is not available for sale.");
      }

      const availableBatches = await tx
        .select({
          id: batches.id,
          batchNumber: batches.batchNumber,
          quantityOnHand: batches.quantityOnHand,
        })
        .from(batches)
        .where(
          and(
            eq(batches.organizationId, access.organizationId),
            eq(batches.branchId, access.branchId),
            eq(batches.medicineId, line.medicineId),
            gt(batches.expiryDate, today),
            gt(batches.quantityOnHand, 0),
          ),
        )
        .orderBy(asc(batches.expiryDate), asc(batches.batchNumber))
        .for("update");

      let remaining = line.quantity;
      for (const batch of availableBatches) {
        if (remaining === 0) break;
        const quantity = Math.min(batch.quantityOnHand, remaining);
        const lineTotalPesewas = medicine.unitPricePesewas * quantity;
        if (!Number.isSafeInteger(lineTotalPesewas)) {
          throw new RangeError("Sale line total exceeds the supported money range.");
        }
        allocations.push({
          medicineId: medicine.id,
          batchId: batch.id,
          quantity,
          unitPricePesewas: medicine.unitPricePesewas,
          lineTotalPesewas,
          quantityOnHand: batch.quantityOnHand,
        });
        remaining -= quantity;
      }

      if (remaining > 0) {
        throw new SaleValidationError(
          `Not enough stock for ${medicine.name}.`,
        );
      }
    }

    for (const allocation of allocations) {
      await tx
        .update(batches)
        .set({ quantityOnHand: allocation.quantityOnHand - allocation.quantity })
        .where(eq(batches.id, allocation.batchId));

      await tx.insert(stockMovements).values({
        organizationId: access.organizationId,
        branchId: access.branchId,
        batchId: allocation.batchId,
        movementType: "sale",
        quantityDelta: -allocation.quantity,
        referenceId: createdSale.id,
        createdBy: scope.userId,
      });

      await tx.insert(saleLines).values({
        saleId: createdSale.id,
        medicineId: allocation.medicineId,
        batchId: allocation.batchId,
        quantity: allocation.quantity,
        unitPricePesewas: allocation.unitPricePesewas,
        lineTotalPesewas: allocation.lineTotalPesewas,
      });
    }

    await tx.insert(payments).values({
      saleId: createdSale.id,
      amountPesewas: tenderedPesewas,
      method: parsed.data.paymentMethod,
      reference,
    });

    await tx.insert(auditEvents).values({
      organizationId: access.organizationId,
      branchId: access.branchId,
      actorUserId: scope.userId,
      action: "sale.completed",
      entityType: "sale",
      entityId: createdSale.id,
      payload: {
        lines: requestedLines.length,
        totalPesewas,
      },
    });

    return {
      saleId: createdSale.id,
      totalPesewas,
      paymentMethod: parsed.data.paymentMethod,
      changePesewas: tenderedPesewas - totalPesewas,
      reference,
      duplicate: false,
    };
  });
}
