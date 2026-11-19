import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { terminals } from "../../../db/schema/terminals";

export function hashTerminalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateTerminalToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function resolveTerminal(token: string | undefined) {
  if (!token) return null;

  const [terminal] = await db
    .select({
      id: terminals.id,
      organizationId: terminals.organizationId,
      branchId: terminals.branchId,
    })
    .from(terminals)
    .where(
      and(
        eq(terminals.tokenHash, hashTerminalToken(token)),
        isNull(terminals.revokedAt),
      ),
    )
    .limit(1);

  return terminal ?? null;
}
