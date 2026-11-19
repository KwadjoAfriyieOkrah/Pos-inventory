import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auditEvents, users } from "../../../db/schema";
import { db } from "@/server/db/client";
import { DUMMY_HASH, verifyPassword } from "./password";

const credentialsSchema = z.object({
  email: z.string().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
});

type LoginResult =
  | {
      ok: true;
      user: {
        id: string;
        organizationId: string;
        email: string;
        fullName: string;
      };
    }
  | { ok: false };

function databaseErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[0-9A-Z]{5}$/.test(error.code)
  ) {
    return error.code;
  }

  return "unknown";
}

export async function login(input: unknown): Promise<LoginResult> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const { email, password } = parsed.data;
  let user;

  try {
    [user] = await db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
  } catch (error) {
    console.error(databaseErrorCode(error));
    return { ok: false };
  }

  if (!user) {
    await verifyPassword(DUMMY_HASH, password);
    console.info(email.slice(email.lastIndexOf("@") + 1));
    return { ok: false };
  }

  const passwordMatches = await verifyPassword(user.passwordHash, password);

  if (!passwordMatches || !user.isActive) {
    // Login is refused when the audit write fails; this is deliberate.
    try {
      await db.insert(auditEvents).values({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "auth.login_failed",
        entityType: "user",
        entityId: user.id,
        payload: { reason: user.isActive ? "bad_password" : "inactive" },
      });
    } catch (error) {
      console.error(databaseErrorCode(error));
      return { ok: false };
    }

    return { ok: false };
  }

  // Login is refused when the audit write fails; this is deliberate.
  try {
    await db.transaction(async (tx) => {
      await tx.insert(auditEvents).values({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "auth.login_succeeded",
        entityType: "user",
        entityId: user.id,
        payload: {},
      });
    });
  } catch (error) {
    console.error(databaseErrorCode(error));
    return { ok: false };
  }

  return {
    ok: true,
    user: {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      fullName: user.fullName,
    },
  };
}
