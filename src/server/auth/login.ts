import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auditEvents, users } from "../../../db/schema";
import { db } from "@/server/db/client";
import { DUMMY_HASH, verifyPassword } from "./password";

export const INVALID_LOGIN_MESSAGE = "Email or password is incorrect";

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
  let current = error;
  const visited = new Set<object>();

  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);

    if (
      "code" in current &&
      typeof current.code === "string" &&
      /^[0-9A-Z]{5}$/.test(current.code)
    ) {
      return current.code;
    }

    current = "cause" in current ? current.cause : undefined;
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
    const reason = !user.isActive
      ? passwordMatches
        ? "inactive"
        : "inactive_and_bad_password"
      : "bad_password";

    // Login is refused when the audit write fails; this is deliberate.
    try {
      await db.insert(auditEvents).values({
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: "auth.login_failed",
        entityType: "user",
        entityId: user.id,
        payload: { reason },
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
