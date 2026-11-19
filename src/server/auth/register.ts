import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  terminalRegistrationCodes,
  terminals,
} from "../../../db/schema";
import {
  generateTerminalToken,
  hashTerminalToken,
} from "./terminal";

export async function redeemRegistrationCode(
  code: string,
): Promise<string | null> {
  const token = generateTerminalToken();
  const tokenHash = hashTerminalToken(token);
  const codeHash = createHash("sha256").update(code).digest("hex");

  return db.transaction(async (tx) => {
    const [registration] = await tx
      .update(terminalRegistrationCodes)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(terminalRegistrationCodes.codeHash, codeHash),
          isNull(terminalRegistrationCodes.usedAt),
          gt(terminalRegistrationCodes.expiresAt, sql`now()`),
        ),
      )
      .returning({
        organizationId: terminalRegistrationCodes.organizationId,
        branchId: terminalRegistrationCodes.branchId,
        name: terminalRegistrationCodes.name,
      });

    if (!registration) return null;

    await tx.insert(terminals).values({
      organizationId: registration.organizationId,
      branchId: registration.branchId,
      name: registration.name,
      tokenHash,
    });

    return token;
  });
}
