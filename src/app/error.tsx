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

  return (
    <main className="flex flex-1 items-center justify-center">
      <EmptyState
        icon="alert"
        title={copy.common.errorTitle}
        body={copy.common.errorBody}
      >
        <div className="flex gap-2.5">
          <Button variant="primary" size="lg" onClick={reset}>
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
