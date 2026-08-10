"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout, readSession, requestResetCode, submitResetCode } from "./session";
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

/* -------------------------------------------------------------------------- */
/* Forgotten password                                                         */
/* -------------------------------------------------------------------------- */

export interface ForgotPasswordState {
  error?: string;
  /** The API's confirmation, shown once a code has gone out. */
  sent?: string;
  /** Carried into the second step so the code can be matched to an account. */
  email?: string;
}

/**
 * Step one: ask for a code.
 *
 * The success message is whatever the API said, verbatim. It answers the same
 * way for an address that exists and one that never did — rewording it here is
 * exactly how that protection gets lost.
 */
export async function forgotPasswordAction(
  _state: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) return { error: "Enter your email address." };

  const result = await requestResetCode(email);
  if (!result.ok) return { error: result.error, email };

  /* Shown as a problem, not as progress. Advancing to the code screen here
     would sit the user in front of an input for a code the server has just
     said it cannot send. */
  if (!result.canDeliver) return { error: result.message, email };

  return { sent: result.message, email };
}

export interface ResetPasswordState {
  error?: string;
  email?: string;
}

/**
 * Step two: spend the code and set the new password.
 *
 * Both fields are checked here before the request, so an obvious mistake does
 * not burn one of the five attempts the code allows.
 */
export async function resetPasswordAction(
  _state: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!code) return { error: "Enter the 6-digit code.", email };
  if (newPassword !== confirmPassword) {
    return { error: "The two passwords do not match.", email };
  }

  const result = await submitResetCode({ email, code, newPassword });
  if (!result.ok) return { error: result.error, email };

  /* Straight to sign-in. The API revoked every session for this account, so
     there is nothing to carry forward — and arriving at a login form is the
     clearest possible confirmation that the new password is now the one. */
  redirect("/admin/login?reset=1");
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
