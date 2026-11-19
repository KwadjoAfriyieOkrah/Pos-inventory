import "server-only";
import { createHash } from "node:crypto";
import { and, count, eq, gt, inArray, sql } from "drizzle-orm";
import { loginFailures } from "../../../db/schema";
import type { db } from "@/server/db/client";

export const EMAIL_LIMIT = 5;
export const EMAIL_WINDOW_MINUTES = 15;
export const TERMINAL_LIMIT = 30;
export const TERMINAL_WINDOW_MINUTES = 60;
// The cap equals the email limit, so N concurrent attempts from one terminal record at most 5 failures.
export const PER_TERMINAL_IN_FLIGHT = EMAIL_LIMIT;

type KeyType = "email" | "terminal";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type RateLimitKey = { type: KeyType; hash: string };

const terminalAttemptsInFlight = new Map<string, number>();

export function hashKey(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function tryAcquireTerminalAdmission(terminalId: string): boolean {
  const inFlight = terminalAttemptsInFlight.get(terminalId) ?? 0;
  if (inFlight >= PER_TERMINAL_IN_FLIGHT) return false;

  terminalAttemptsInFlight.set(terminalId, inFlight + 1);
  return true;
}

export function releaseTerminalAdmission(terminalId: string): void {
  const inFlight = terminalAttemptsInFlight.get(terminalId) ?? 0;
  if (inFlight <= 1) {
    terminalAttemptsInFlight.delete(terminalId);
    return;
  }

  terminalAttemptsInFlight.set(terminalId, inFlight - 1);
}

export async function lockKeys(
  tx: Transaction,
  keys: RateLimitKey[],
): Promise<void> {
  // This serializes concurrent attempts per key, and the sorted order prevents deadlock between requests that lock the same two keys.
  const sortedKeys = [...keys].sort((left, right) => {
    if (left.type !== right.type) return left.type < right.type ? -1 : 1;
    if (left.hash === right.hash) return 0;
    return left.hash < right.hash ? -1 : 1;
  });

  for (const key of sortedKeys) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${key.type} || ':' || ${key.hash}))`,
    );
  }
}

export async function countFailures(
  tx: Transaction,
  type: KeyType,
  hash: string,
  windowMinutes: number,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - windowMinutes * 60_000);
  const [result] = await tx
    .select({ failures: count() })
    .from(loginFailures)
    .where(
      and(
        eq(loginFailures.keyType, type),
        eq(loginFailures.keyHash, hash),
        gt(loginFailures.failedAt, cutoff),
        inArray(loginFailures.status, ["pending", "failed"]),
      ),
    );

  return result.failures;
}

export async function reserveFailure(
  tx: Transaction,
  type: KeyType,
  hash: string,
  now: Date,
): Promise<string> {
  const [reservation] = await tx
    .insert(loginFailures)
    .values({
      keyType: type,
      keyHash: hash,
      failedAt: now,
      status: "pending",
    })
    .returning({ id: loginFailures.id });

  if (!reservation) throw new Error("Login reservation was not created");
  return reservation.id;
}

export async function finalizeReservations(
  tx: Transaction,
  reservationIds: [string, string],
  status: "failed" | "succeeded",
): Promise<void> {
  const finalized = await tx
    .update(loginFailures)
    .set({ status })
    .where(inArray(loginFailures.id, reservationIds))
    .returning({ id: loginFailures.id });

  if (finalized.length !== reservationIds.length) {
    throw new Error("Login reservations could not be finalized");
  }
}

export async function pruneStaleFailures(
  tx: Transaction,
  now: Date,
  limit = 100,
): Promise<void> {
  const batchLimit = Math.max(0, Math.trunc(limit));
  if (batchLimit === 0) return;
  const staleBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  await tx.execute(
    sql`DELETE FROM ${loginFailures}
      WHERE ${loginFailures.id} IN (
        SELECT ${loginFailures.id}
        FROM ${loginFailures}
        WHERE ${loginFailures.failedAt} < ${staleBefore}
        LIMIT ${batchLimit}
        FOR UPDATE SKIP LOCKED
      )`,
  );
}
