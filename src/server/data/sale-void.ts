import "server-only";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  auditEvents,
  batches,
  branchSettings,
  saleVoids,
  sales,
  stockMovements,
  users,
} from "../../../db/schema";
import { accraToday } from "@/lib/time";
import { db } from "@/server/db/client";
import { PERMISSIONS } from "./permissions";
import {
  requireBranch,
  type AuthorizedBranch,
  type DataScope,
} from "./scope";

export type VoidResult =
  | {
      ok: true;
      voidId: string;
      status: "completed" | "pending_approval";
    }
  | { ok: false; message: string };

type VoidTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function postgresFields(error: unknown): { code?: string; constraint?: string } {
  let current = error;
  const visited = new Set<object>();

  while (
    typeof current === "object" &&
    current !== null &&
    !visited.has(current)
  ) {
    visited.add(current);
    const code =
      "code" in current && typeof current.code === "string"
        ? current.code
        : undefined;
    const constraint =
      "constraint" in current && typeof current.constraint === "string"
        ? current.constraint
        : undefined;

    if (code || constraint) return { code, constraint };
    current = "cause" in current ? current.cause : undefined;
  }

  return {};
}

function isDuplicateSaleVoid(error: unknown): boolean {
  const { code, constraint } = postgresFields(error);
  return (
    code === "23505" &&
    (constraint === "sale_voids_sale_id_request_only_unique" ||
      constraint === "sale_voids_sale_id_unique")
  );
}

async function restoreStock(
  tx: VoidTransaction,
  access: AuthorizedBranch,
  actorUserId: string,
  saleId: string,
): Promise<void> {
  const movementRows = await tx
    .select({
      batchId: stockMovements.batchId,
      quantity: sql<number>`sum(-${stockMovements.quantityDelta})`,
    })
    .from(stockMovements)
    .where(
      and(
        eq(stockMovements.organizationId, access.organizationId),
        eq(stockMovements.branchId, access.branchId),
        eq(stockMovements.movementType, "sale"),
        eq(stockMovements.referenceId, saleId),
        lt(stockMovements.quantityDelta, 0),
      ),
    )
    .groupBy(stockMovements.batchId);

  const quantities = new Map<string, number>();
  for (const row of movementRows) {
    const quantity = Number(row.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error("Invalid stock reversal quantity.");
    }
    quantities.set(row.batchId, quantity);
  }

  const batchIds = [...quantities.keys()];
  if (batchIds.length === 0) return;

  const lockedBatches = await tx
    .select({
      id: batches.id,
      quantityOnHand: batches.quantityOnHand,
    })
    .from(batches)
    .where(
      and(
        eq(batches.organizationId, access.organizationId),
        eq(batches.branchId, access.branchId),
        inArray(batches.id, batchIds),
      ),
    )
    .orderBy(asc(batches.id))
    .for("update");

  for (const batch of lockedBatches) {
    const quantity = quantities.get(batch.id);
    if (quantity === undefined) continue;

    await tx
      .update(batches)
      .set({ quantityOnHand: batch.quantityOnHand + quantity })
      .where(
        and(
          eq(batches.id, batch.id),
          eq(batches.organizationId, access.organizationId),
          eq(batches.branchId, access.branchId),
        ),
      );

    await tx.insert(stockMovements).values({
      organizationId: access.organizationId,
      branchId: access.branchId,
      batchId: batch.id,
      movementType: "reversal",
      quantityDelta: quantity,
      referenceId: saleId,
      createdBy: actorUserId,
    });
  }
}

export async function requestVoid(
  scope: DataScope,
  access: AuthorizedBranch,
  saleId: string,
  reason: string,
): Promise<VoidResult> {
  access = await requireBranch(
    scope,
    access.branchId,
    PERMISSIONS.saleCreate,
  );

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);

      const [sale] = await tx
        .select({
          totalPesewas: sales.totalPesewas,
          createdAt: sales.createdAt,
        })
        .from(sales)
        .where(
          and(
            eq(sales.id, saleId),
            eq(sales.organizationId, access.organizationId),
            eq(sales.branchId, access.branchId),
          ),
        )
        .limit(1);

      if (!sale) return { ok: false, message: "Sale not found." };

      const businessDate = accraToday(sale.createdAt);
      if (businessDate !== accraToday()) {
        return {
          ok: false,
          message:
            "Only sales from today can be voided. Ask the owner to correct an older sale.",
        };
      }

      const [settings] = await tx
        .select({
          limitPesewas: branchSettings.voidAutoApproveLimitPesewas,
        })
        .from(branchSettings)
        .where(
          and(
            eq(branchSettings.branchId, access.branchId),
            eq(branchSettings.organizationId, access.organizationId),
          ),
        )
        .limit(1);

      const limitPesewas = settings?.limitPesewas ?? null;
      const autoApprove =
        limitPesewas !== null && sale.totalPesewas <= limitPesewas;
      const status = autoApprove ? "completed" : "pending_approval";
      const requestedAt = new Date();

      const [createdVoid] = await tx
        .insert(saleVoids)
        .values({
          organizationId: access.organizationId,
          branchId: access.branchId,
          saleId,
          status,
          reason,
          requestedBy: scope.userId,
          requestedAt,
          businessDate,
        })
        .returning({ id: saleVoids.id, status: saleVoids.status });

      if (!createdVoid) throw new Error("Sale void was not created.");

      if (autoApprove) {
        await restoreStock(tx, access, scope.userId, saleId);
      }

      await tx.insert(auditEvents).values({
        organizationId: access.organizationId,
        branchId: access.branchId,
        actorUserId: scope.userId,
        action: autoApprove ? "sale.voided" : "sale.void_requested",
        entityType: "sale",
        entityId: saleId,
        payload: { status: createdVoid.status },
      });

      return {
        ok: true,
        voidId: createdVoid.id,
        status:
          createdVoid.status === "completed" ? "completed" : "pending_approval",
      };
    });
  } catch (error) {
    if (isDuplicateSaleVoid(error)) {
      return { ok: false, message: "This sale has already been voided." };
    }
    throw error;
  }
}

export async function approveVoid(
  scope: DataScope,
  access: AuthorizedBranch,
  voidId: string,
): Promise<VoidResult> {
  access = await requireBranch(
    scope,
    access.branchId,
    PERMISSIONS.saleVoid,
  );

  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);

    const [pendingVoid] = await tx
      .select({
        id: saleVoids.id,
        saleId: saleVoids.saleId,
        status: saleVoids.status,
        reason: saleVoids.reason,
        requestedBy: saleVoids.requestedBy,
        requestedAt: saleVoids.requestedAt,
        businessDate: saleVoids.businessDate,
      })
      .from(saleVoids)
      .where(
        and(
          eq(saleVoids.id, voidId),
          isNull(saleVoids.decisionFor),
          eq(saleVoids.organizationId, access.organizationId),
          eq(saleVoids.branchId, access.branchId),
        ),
      )
      .limit(1);

    if (!pendingVoid || pendingVoid.status !== "pending_approval") {
      return { ok: false, message: "This void is not waiting for approval." };
    }

    const [decisionRow] = await tx
      .select({ id: saleVoids.id })
      .from(saleVoids)
      .where(
        and(
          eq(saleVoids.decisionFor, pendingVoid.id),
          eq(saleVoids.organizationId, access.organizationId),
          eq(saleVoids.branchId, access.branchId),
        ),
      )
      .limit(1);

    if (decisionRow) {
      return { ok: false, message: "This void is not waiting for approval." };
    }

    await restoreStock(tx, access, scope.userId, pendingVoid.saleId);

    let createdDecision: { id: string } | undefined;
    try {
      [createdDecision] = await tx
        .insert(saleVoids)
        .values({
          organizationId: access.organizationId,
          branchId: access.branchId,
          saleId: pendingVoid.saleId,
          status: "completed",
          decisionFor: pendingVoid.id,
          reason: pendingVoid.reason,
          requestedBy: pendingVoid.requestedBy,
          requestedAt: pendingVoid.requestedAt,
          approvedBy: scope.userId,
          decidedAt: new Date(),
          businessDate: pendingVoid.businessDate,
        })
        .returning({ id: saleVoids.id });
    } catch (error) {
      const { code, constraint } = postgresFields(error);
      if (code === "23505" && constraint === "sale_voids_decision_for_unique") {
        return { ok: false, message: "This void is not waiting for approval." };
      }
      throw error;
    }

    if (!createdDecision) throw new Error("Sale void approval was not created.");

    await tx.insert(auditEvents).values({
      organizationId: access.organizationId,
      branchId: access.branchId,
      actorUserId: scope.userId,
      action: "sale.void_approved",
      entityType: "sale",
      entityId: pendingVoid.saleId,
      payload: { status: "completed" },
    });

    return { ok: true, voidId: createdDecision.id, status: "completed" };
  });
}

export type PendingVoid = {
  voidId: string;
  saleId: string;
  saleNumber: string;
  totalPesewas: number;
  requesterName: string;
  reason: string;
  requestedAt: string;
};

export async function listPendingVoids(
  scope: DataScope,
  access: AuthorizedBranch,
): Promise<PendingVoid[]> {
  access = await requireBranch(scope, access.branchId, PERMISSIONS.saleVoid);

  const rows = await db
    .select({
      voidId: saleVoids.id,
      saleId: saleVoids.saleId,
      saleNumber: sales.saleNumber,
      totalPesewas: sales.totalPesewas,
      requesterName: users.fullName,
      reason: saleVoids.reason,
      requestedAt: saleVoids.requestedAt,
    })
    .from(saleVoids)
    .innerJoin(
      sales,
      and(
        eq(sales.id, saleVoids.saleId),
        eq(sales.organizationId, saleVoids.organizationId),
        eq(sales.branchId, saleVoids.branchId),
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, saleVoids.requestedBy),
        eq(users.organizationId, saleVoids.organizationId),
      ),
    )
    .where(
      and(
        eq(saleVoids.status, "pending_approval"),
        isNull(saleVoids.decisionFor),
        eq(saleVoids.organizationId, access.organizationId),
        eq(saleVoids.branchId, access.branchId),
        sql`not exists (select 1 from sale_voids d where d.decision_for = ${saleVoids.id})`,
      ),
    )
    .orderBy(asc(saleVoids.requestedAt))
    .limit(100);

  return rows.map((row) => ({
    ...row,
    requestedAt: row.requestedAt.toISOString(),
  }));
}

