"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { redeemRegistrationCode } from "../../../server/auth/register";

const invalidCodeMessage = "Registration code is not valid.";
const registrationCodeSchema = z.string().regex(/^[A-Z2-7]{10}$/);

export async function exchangeTerminalRegistrationCode(
  input: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = registrationCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: invalidCodeMessage };

  const token = await redeemRegistrationCode(parsed.data);
  if (!token) {
    return { ok: false, message: invalidCodeMessage };
  }

  const cookieStore = await cookies();
  cookieStore.set("pos_terminal", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 31536000,
  });

  return { ok: true };
}
