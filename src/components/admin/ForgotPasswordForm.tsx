"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  forgotPasswordAction,
  resetPasswordAction,
  type ForgotPasswordState,
  type ResetPasswordState,
} from "@/lib/admin/actions";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

/**
 * Forgotten password, in two steps on one page.
 *
 * Step one asks for the address. Step two takes the code and the new password
 * TOGETHER, because there is deliberately no endpoint that only checks a code —
 * one that existed would let an attacker test six-digit codes for free. Here
 * every guess costs a full submission and one of five attempts.
 *
 * Which step is showing is derived from whether the first action reported a
 * code going out, so a reload does not silently drop someone back to the start
 * with a live code they can no longer type in.
 */
export function ForgotPasswordForm() {
  const [request, requestAction] = useActionState<ForgotPasswordState, FormData>(
    forgotPasswordAction,
    {},
  );

  if (request.sent) {
    return <CodeStep email={request.email ?? ""} notice={request.sent} />;
  }

  return (
    <form action={requestAction} className="flex flex-col gap-4">
      <div>
        <h1 className="text-title text-ink">Forgot your password?</h1>
        <p className="mt-1 text-caption text-muted">
          We&apos;ll send a 6-digit code to your admin email and to the shop&apos;s Telegram.
        </p>
      </div>

      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        defaultValue={request.email ?? ""}
        required
        autoFocus
      />

      {request.error && (
        <p role="alert" className="rounded-sm bg-sale-soft px-3 py-2 text-caption text-sale">
          {request.error}
        </p>
      )}

      <SubmitButton idle="Send code" busy="Sending…" />

      <Link
        href="/admin/login"
        className="text-center text-caption text-muted underline underline-offset-4 hover:text-ink"
      >
        Back to sign in
      </Link>
    </form>
  );
}

function CodeStep({ email, notice }: { email: string; notice: string }) {
  const [state, action] = useActionState<ResetPasswordState, FormData>(
    resetPasswordAction,
    {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <h1 className="text-title text-ink">Enter your code</h1>
        <p className="mt-1 text-caption text-muted">{notice}</p>
      </div>

      {/* The address is carried forward rather than asked for again. It is not
          a secret — the code is — and re-typing it is one more way to fail. */}
      <input type="hidden" name="email" value={email} />

      <Input
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="000000"
        required
        autoFocus
      />

      <Input
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters, with an uppercase letter, a lowercase letter and a number."
        required
      />

      <Input
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
      />

      {state.error && (
        <p role="alert" className="rounded-sm bg-sale-soft px-3 py-2 text-caption text-sale">
          {state.error}
        </p>
      )}

      <SubmitButton idle="Set new password" busy="Saving…" />

      <p className="text-center text-micro text-muted">
        The code expires in 15 minutes and works once. Didn&apos;t get it?{" "}
        <Link href="/admin/forgot-password" className="underline underline-offset-4">
          Start again
        </Link>
      </p>
    </form>
  );
}

/**
 * Split out so `useFormStatus` can read the parent form's pending state — the
 * hook only reports for a form above it in the tree.
 */
function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
      {pending ? busy : idle}
    </Button>
  );
}
