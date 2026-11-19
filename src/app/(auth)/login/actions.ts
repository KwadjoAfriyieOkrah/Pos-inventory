"use server";

import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { signIn } from "@/server/auth";
import { INVALID_LOGIN_MESSAGE } from "../../../server/auth/login";
import { resolveTerminal } from "../../../server/auth/terminal";

const UNREGISTERED_TERMINAL_MESSAGE =
  "This device is not registered. Contact the pharmacy owner.";

export async function loginAction(
  _previousState: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  let terminalToken: string | undefined;
  try {
    terminalToken = (await cookies()).get("pos_terminal")?.value;
  } catch {
    return { error: UNREGISTERED_TERMINAL_MESSAGE };
  }

  if (!(await resolveTerminal(terminalToken))) {
    return { error: UNREGISTERED_TERMINAL_MESSAGE };
  }

  try {
    await signIn("credentials", formData);
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: INVALID_LOGIN_MESSAGE };
    }

    throw error;
  }

  return { error: null };
}
