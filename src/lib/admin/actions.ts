"use server";

import { redirect } from "next/navigation";
import { login, logout, readSession } from "./session";
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

/** Only same-site paths are honoured, so `?next=` cannot become a redirector. */
function safeNext(value: unknown): string {
  if (typeof value !== "string" || value === "") return "/admin";
  if (!value.startsWith("/admin")) return "/admin";
  /* Protocol-relative URLs (`//evil.com`) start with a slash too. */
  if (value.startsWith("//")) return "/admin";
  return value;
}

export async function loginAction(
  _state: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Enter your email and password.", email };
  }

  const result = await login(email, password);
  if (!result.ok) return { error: result.error, email };

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
