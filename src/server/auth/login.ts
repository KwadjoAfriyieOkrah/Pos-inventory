import "server-only";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { auditEvents, users } from "../../../db/schema";
import { authDb } from "./login-db";
import { DUMMY_HASH, verifyPassword } from "./password";
import {
  countFailures,
  EMAIL_LIMIT,
  EMAIL_WINDOW_MINUTES,
  finalizeReservations,
  hashKey,
  lockKeys,
  pruneStaleFailures,
  reserveFailure,
  releaseTerminalAdmission,
  TERMINAL_LIMIT,
  TERMINAL_WINDOW_MINUTES,
  tryAcquireTerminalAdmission,
} from "./rate-limit";
import { resolveTerminal } from "./terminal";

export const INVALID_LOGIN_MESSAGE = "Email or password is incorrect";
export const RATE_LIMITED_LOGIN_MESSAGE =
  "Too many attempts. Try again in 15 minutes.";
export const LOCK_TIMEOUT_LOGIN_MESSAGE =
  "Too many attempts right now. Try again in a moment.";
export const UNREGISTERED_TERMINAL_MESSAGE =
  "This device is not registered. Contact the pharmacy owner.";

export type LoginReason =
  | "invalid_input"
  | "unregistered_terminal"
  | "locked"
  | "busy"
  | "unavailable"
  | "bad_credentials";

export type LoginResult =
  | {
      ok: true;
      user: {
        id: string;
        organizationId: string;
        email: string;
        fullName: string;
      };
    }
  | { ok: false; reason: LoginReason; message: string };

const LOGIN_MESSAGES: Record<LoginReason, string> = {
  invalid_input: INVALID_LOGIN_MESSAGE,
  unregistered_terminal: UNREGISTERED_TERMINAL_MESSAGE,
  locked: RATE_LIMITED_LOGIN_MESSAGE,
  busy: LOCK_TIMEOUT_LOGIN_MESSAGE,
  unavailable: "Login is temporarily unavailable. Try again shortly.",
  bad_credentials: INVALID_LOGIN_MESSAGE,
};

function fail(reason: LoginReason): LoginResult {
  return { ok: false, reason, message: LOGIN_MESSAGES[reason] };
}

const FINALIZE_ATTEMPTS = 3;
const FINALIZE_RETRY_DELAYS_MS = [0, 100, 300];
const TRANSIENT_SQLSTATES = new Set([
  "55P03",
  "40P01",
  "08006",
  "08001",
  "57P01",
]);

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const credentialsSchema = z.object({
  email: z.string().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
});

type LoginUser = {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  passwordHash: string | null;
  isActive: boolean;
};

type ReservationResult =
  | { kind: "locked"; result: LoginResult }
  | {
      kind: "reserved";
      ids: [string, string];
    };

function databaseErrorCode(error: unknown): string {
  let current = error;
  const visited = new Set<object>();

  while (
    typeof current === "object" &&
    current !== null &&
    !visited.has(current)
  ) {
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

function isAuthPoolConnectTimeout(error: unknown): boolean {
  let current = error;
  const visited = new Set<object>();

  while (
    typeof current === "object" &&
    current !== null &&
    !visited.has(current)
  ) {
    visited.add(current);
    if (
      "message" in current &&
      current.message === "timeout exceeded when trying to connect"
    ) {
      return true;
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}

export async function login(input: unknown): Promise<LoginResult> {
  const now = new Date();
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input");

  const { email, password } = parsed.data;
  let terminalToken: string | undefined;

  try {
    terminalToken = (await cookies()).get("pos_terminal")?.value;
  } catch {
    return fail("unavailable");
  }

  let terminal: Awaited<ReturnType<typeof resolveTerminal>>;
  try {
    terminal = await resolveTerminal(terminalToken);
  } catch (error) {
    console.error(databaseErrorCode(error));
    return fail("unavailable");
  }
  if (!terminal) return fail("unregistered_terminal");

  const emailKeyHash = hashKey(email);
  const terminalKeyHash = hashKey(terminal.id);
  if (!tryAcquireTerminalAdmission(terminal.id)) {
    return fail("busy");
  }

  try {
    const emailKey = { type: "email" as const, hash: emailKeyHash };
    const terminalKey = {
      type: "terminal" as const,
      hash: terminalKeyHash,
    };
    let lockedAuditAttempt = false;
    let reservation: ReservationResult;

    try {
      reservation = await authDb.transaction(
        async (tx): Promise<ReservationResult> => {
          await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
          await lockKeys(tx, [emailKey, terminalKey]);
          await pruneStaleFailures(tx, now);

          const emailFailures = await countFailures(
            tx,
            "email",
            emailKeyHash,
            EMAIL_WINDOW_MINUTES,
            now,
          );
          const terminalFailures = await countFailures(
            tx,
            "terminal",
            terminalKeyHash,
            TERMINAL_WINDOW_MINUTES,
            now,
          );
          const lockedScope =
            emailFailures >= EMAIL_LIMIT
              ? "email"
              : terminalFailures >= TERMINAL_LIMIT
                ? "terminal"
                : null;

          if (lockedScope) {
            lockedAuditAttempt = true;
            await tx.insert(auditEvents).values({
              organizationId: terminal.organizationId,
              branchId: terminal.branchId,
              terminalId: terminal.id,
              actorUserId: null,
              action: "auth.login_locked",
              entityType: "user",
              payload: { scope: lockedScope },
            });
            return { kind: "locked", result: fail("locked") };
          }

          const emailReservationId = await reserveFailure(
            tx,
            "email",
            emailKeyHash,
            now,
          );
          const terminalReservationId = await reserveFailure(
            tx,
            "terminal",
            terminalKeyHash,
            now,
          );

          return {
            kind: "reserved",
            ids: [emailReservationId, terminalReservationId],
          };
        },
      );
    } catch (error) {
      const errorCode = databaseErrorCode(error);
      console.error(errorCode);
      if (errorCode === "55P03" || isAuthPoolConnectTimeout(error)) {
        return fail("busy");
      }

      return fail(lockedAuditAttempt ? "locked" : "unavailable");
    }

    if (reservation.kind === "locked") return reservation.result;

    let user: LoginUser | undefined;
    try {
      [user] = await authDb
        .select({
          id: users.id,
          organizationId: users.organizationId,
          email: users.email,
          fullName: users.fullName,
          passwordHash: users.passwordHash,
          isActive: users.isActive,
        })
        .from(users)
        .where(
          and(
            eq(users.email, email),
            eq(users.organizationId, terminal.organizationId),
          ),
        )
        .limit(1);
    } catch (error) {
      console.error(databaseErrorCode(error));
      return isAuthPoolConnectTimeout(error)
        ? fail("busy")
        : fail("unavailable");
    }

    let passwordMatches: boolean;
    try {
      passwordMatches = await verifyPassword(
        user?.passwordHash ?? DUMMY_HASH,
        password,
      );
    } catch (error) {
      console.error(databaseErrorCode(error));
      return fail("unavailable");
    }

    const authenticated = Boolean(user && passwordMatches && user.isActive);

    // Login is refused when the audit write fails; this is deliberate.
    let finalized = false;
    for (
      let attempt = 0;
      attempt < FINALIZE_ATTEMPTS && !finalized;
      attempt += 1
    ) {
      if (attempt > 0) {
        await sleep(FINALIZE_RETRY_DELAYS_MS[attempt]);
      }

      try {
        await authDb.transaction(async (tx) => {
          await finalizeReservations(
            tx,
            reservation.ids,
            authenticated ? "succeeded" : "failed",
          );

          if (!authenticated && !user) {
            await tx.insert(auditEvents).values({
              organizationId: terminal.organizationId,
              branchId: terminal.branchId,
              terminalId: terminal.id,
              actorUserId: null,
              action: "auth.login_failed",
              entityType: "user",
              payload: { reason: "unknown_email", attempted_email: email },
            });
          } else if (!authenticated && user) {
            const reason = !user.isActive
              ? passwordMatches
                ? "inactive"
                : "inactive_and_bad_password"
              : "bad_password";

            await tx.insert(auditEvents).values({
              organizationId: terminal.organizationId,
              branchId: terminal.branchId,
              terminalId: terminal.id,
              actorUserId: user.id,
              action: "auth.login_failed",
              entityType: "user",
              entityId: user.id,
              payload: { reason },
            });
          } else if (user) {
            await tx.insert(auditEvents).values({
              organizationId: terminal.organizationId,
              branchId: terminal.branchId,
              terminalId: terminal.id,
              actorUserId: user.id,
              action: "auth.login_succeeded",
              entityType: "user",
              entityId: user.id,
              payload: {},
            });
          }
        });
        finalized = true;
      } catch (error) {
        const errorCode = databaseErrorCode(error);
        if (
          !TRANSIENT_SQLSTATES.has(errorCode) ||
          attempt === FINALIZE_ATTEMPTS - 1
        ) {
          console.error(errorCode);
          return fail("unavailable");
        }
      }
    }

    if (!authenticated || !user) return fail("bad_credentials");

    return {
      ok: true,
      user: {
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        fullName: user.fullName,
      },
    };
  } finally {
    releaseTerminalAdmission(terminal.id);
  }
}
