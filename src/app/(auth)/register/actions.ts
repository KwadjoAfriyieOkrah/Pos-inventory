"use server";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import {
  terminalRegistrationCodes,
  terminals,
} from "../../../../db/schema";
import {
  generateTerminalToken,
  hashTerminalToken,
} from "../../../server/auth/terminal";

const invalidCodeMessage = "Registration code is not valid.";
const registrationCodeSchema = z.string().regex(/^[A-Z2-7]{10}$/);

export async function exchangeTerminalRegistrationCode(
  input: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = registrationCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidCodeMessage };

  const token = generateTerminalToken();
  const tokenHash = hashTerminalToken(token);
  const codeHash = createHash("sha256").update(parsed.data).digest("hex");
  const registrationToken = await db.transaction(async (tx) => {
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

  if (!registrationToken) {
    return { ok: false, message: invalidCodeMessage };
  }

  const cookieStore = await cookies();
  cookieStore.set("pos_terminal", registrationToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return { ok: true };
}
