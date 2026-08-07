"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout, readSession } from "./session";
import { RETURN_TO_COOKIE, RETURN_TO_PATH, safeReturnTo } from "./return-to";
import type { ApiAdmin } from "@/lib/api/types";

/**
 * Session server actions.
 *
 * Sign-in and sign-out are server actions rather than proxy routes because they
 * are the two operations that must write cookies from a form submission, and an
 * action gives progressive enhancement for free — the login form works before
 * any JavaScript has loaded.
 */

export interface LoginFormState {
  error?: string;
  /** Echoed back so a failed attempt does not clear the email field. */
  email?: string;
}

export async function loginAction(
  _state: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const value = formData.get("next");
  const next = safeReturnTo(typeof value === "string" ? value : null);

  if (!email || !password) {
    return { error: "Enter your email and password.", email };
  }

  const result = await login(email, password);
  if (!result.ok) return { error: result.error, email };

  /* Spent. Left behind, it would override the destination of the next sign-in
     on this browser for the ten minutes it has left to live. */
  (await cookies()).delete({ name: RETURN_TO_COOKIE, path: RETURN_TO_PATH });

  /* `redirect` throws, so it must sit outside any try/catch. */
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/admin/login");
}

/** Identity for the admin shell. Null when the session is gone. */
export async function currentAdminAction(): Promise<ApiAdmin | null> {
  const { admin } = await readSession();
  return admin ?? null;
}
