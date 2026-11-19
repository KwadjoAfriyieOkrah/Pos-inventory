"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/server/auth";
import { INVALID_LOGIN_MESSAGE } from "../../../server/auth/login";

export async function loginAction(
  _previousState: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
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
