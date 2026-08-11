"use client";

import { useEffect } from "react";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Layout";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with a real error reporter (Sentry, etc.) before launch.
    console.error(error);
  }, [error]);

  /**
   * Reload the page rather than re-render it.
   *
   * `reset()` re-runs the failed segment with the JavaScript the browser
   * already has. That is enough for something transient, and useless for the
   * error people actually hit here: a page held open across a deploy calls a
   * server action whose id no longer exists, and every retry sends the same
   * dead id from the same stale bundle. The button looked broken because, for
   * that error, it was.
   *
   * A reload fixes both cases — it fetches the current build, and a transient
   * failure gets its retry regardless. The only cost is losing in-page state,
   * which on an error screen has already been lost.
   */
  function retry(): void {
    if (typeof window !== "undefined") {
      window.location.reload();
      return;
    }
    reset();
  }

  return (
    <main className="flex flex-1 items-center justify-center">
      <EmptyState
        icon="alert"
        title={copy.common.errorTitle}
        body={copy.common.errorBody}
      >
        <div className="flex gap-2.5">
          <Button variant="primary" size="lg" onClick={retry}>
            {copy.common.retry}
          </Button>
          <Button href="/" variant="secondary" size="lg">
            {copy.common.goHome}
          </Button>
        </div>
      </EmptyState>
    </main>
  );
}
