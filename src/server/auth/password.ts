import "server-only";
import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(
  passwordHash: string | null,
  plain: string,
): Promise<boolean> {
  if (!passwordHash) return false;

  try {
    return await verify(passwordHash, plain);
  } catch {
    return false;
  }
}

export const DUMMY_HASH = await hashPassword(
  randomBytes(32).toString("base64url"),
);
