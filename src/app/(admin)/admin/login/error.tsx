"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/** Marks that this tab has already spent its one automatic reload. */
const RELOADED_KEY = "gng:admin-login-reloaded";

/** How long to let the reload take before assuming it is not going to happen. */
const RELOAD_GRACE_MS = 4000;

/**
 * Sign-in errors, recovered from rather than reported.
 *
 * `deploymentId` turns a stale tab into a hard navigation the moment it tries to
 * NAVIGATE, so most of this class of failure never reaches a person. It cannot
 * help the tab that navigates nowhere: left open on this page across a deploy,
 * or restored from the back-forward cache, whose first act is to submit a form
 * carrying a server action id the current build has never heard of.
 *
 * Everywhere else that lands on the generic error screen, which is fair — the
 * admin can read it and press the button. Here it is not: this is the page
 * someone is on precisely because they have no session yet, so a dead end asks
 * them to solve a build-versioning problem in order to log in. Reloading fetches
 * the current build and puts a working form in front of them, which is what the
 * button on the generic screen does anyway, one click later.
 */
export default function AdminLoginError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  /* Next 16.2's replacement for `reset`. It re-FETCHES the segment as well as
     re-rendering it, where `reset` only clears the error state and re-renders
     with the JavaScript already loaded — which for a stale bundle is the very
     thing at fault. */
  unstable_retry: () => void;
}) {
  /**
   * At most one automatic reload, and only for this tab.
   *
   * A stale bundle is fixed by the reload and never comes back. Anything else —
   * the API being unreachable, a genuine fault in this page — reproduces on the
   * fresh build too, and reloading on sight of it would spin the browser
   * forever. So the second failure gets the screen and the person gets a choice.
   *
   * `sessionStorage` rather than component state, since the reload is what
   * discards component state. Scoped to the tab, so it cannot leave a
   * long-running browser permanently unwilling to retry.
   *
   * Read and claimed in the initialiser rather than in an effect, because it is
   * the value this render depends on and not a reaction to it. On the server
   * there is no `sessionStorage`; the catch answers `false` and the screen
   * renders, which is the right outcome where there is no browser to reload.
   */
  const [reloading, setReloading] = useState(() => {
    try {
      if (sessionStorage.getItem(RELOADED_KEY) === "1") return false;
      sessionStorage.setItem(RELOADED_KEY, "1");
      return true;
    } catch {
      /* Private mode, or storage disabled. Treat it as "already tried": a
         reload we cannot record is a reload we cannot stop repeating. */
      return false;
    }
  });

  useEffect(() => {
    // Replace with a real error reporter (Sentry, etc.) before launch.
    console.error(error);
  }, [error]);

  useEffect(() => {
    if (!reloading) return;

    window.location.reload();

    /* A reload that does not take — refused by the browser, or just slow —
       would otherwise leave this page blank for good, and a blank page is the
       one thing indistinguishable from a broken sign-in. Give it a few seconds
       and then show the screen, so there is always something to press. */
    const timer = setTimeout(() => setReloading(false), RELOAD_GRACE_MS);
    return () => clearTimeout(timer);
  }, [reloading]);

  /* The reload is in flight. Rendering the failure for the half-second before
     the page goes away would only be a flash of bad news that turns out not to
     have been true. */
  if (reloading) return null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-5 py-12">
      <div className="w-full max-w-[380px] text-center">
        <p className="text-title text-ink">Could not sign you in</p>
        <p className="mt-2 text-caption text-muted">
          Something went wrong on our side. Please try again in a moment.
        </p>
        <div className="mt-6 flex justify-center gap-2.5">
          <Button variant="primary" size="lg" onClick={() => unstable_retry()}>
            Try again
          </Button>
        </div>
      </div>
    </main>
  );
}
