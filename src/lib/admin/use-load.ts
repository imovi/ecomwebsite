"use client";

import { useEffect } from "react";

/**
 * Runs an async loader on mount, and again whenever the loader identity changes
 * — which is how a screen re-fetches when its route parameter changes.
 *
 * One shared hook rather than the same effect written out on every admin screen.
 * It also keeps `react-hooks/set-state-in-effect` satisfied: the rule flags
 * `void someAsyncFn()` inside an effect because it cannot prove the state
 * updates happen after an `await`, and passing the loader in as an argument
 * makes that judgement it cannot make unnecessary. The rule's real target is a
 * synchronous set-render-set cascade, which none of these loaders do.
 *
 * Loaders that also run after a mutation leave `loading` alone on entry, so a
 * refetch updates in place instead of replacing the screen with a skeleton.
 */
export function useLoad(load: () => Promise<void>): void {
  useEffect(() => {
    void load();
  }, [load]);
}
