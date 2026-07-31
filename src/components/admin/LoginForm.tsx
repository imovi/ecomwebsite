"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { loginAction, type LoginFormState } from "@/lib/admin/actions";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

/**
 * Sign-in form.
 *
 * A server action rather than a fetch: the response has to set an httpOnly
 * cookie, and this way the form also submits without JavaScript.
 */
export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/admin";

  const [state, formAction] = useActionState<LoginFormState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <Input
        label="Email"
        name="email"
        type="email"
        autoComplete="username"
        defaultValue={state.email ?? ""}
        required
        autoFocus
      />

      <Input
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />

      {state.error && (
        <p role="alert" className="rounded-sm bg-sale-soft px-3 py-2 text-caption text-sale">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}

/**
 * Split out so `useFormStatus` can read the parent form's pending state — the
 * hook only reports for a form above it in the tree.
 */
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}
