"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin/client";
import type { ApiFraudReport } from "@/lib/api/types";

/**
 * Courier delivery rates for a page of orders, from what is already stored.
 *
 * THIS NEVER SIGNS IN TO A COURIER
 * --------------------------------
 * Fifty rows against five merchant panels is two hundred and fifty logins to
 * draw one screen — unusable, and the fastest way to get the shop's courier
 * accounts locked. So the list reads only results already fetched, which is
 * what the subscriber on `order.created` puts there when the order arrives.
 *
 * A number nobody has looked up is simply missing from the answer, and its row
 * shows no badge at all. That is the honest reading: "not looked up" is not
 * "never took delivery".
 *
 * Returns `{}` on failure, deliberately. The badge is context on a screen whose
 * job is the order queue; a courier-check outage must not put an error banner
 * over the queue, and the full record with its own error handling is one click
 * away on the order itself.
 */
export function useCachedFraud(phones: string[]): Record<string, ApiFraudReport> {
  const [reports, setReports] = useState<Record<string, ApiFraudReport>>({});

  /* Keyed on the sorted set rather than the array: re-sorting or re-rendering
     the same page of orders must not re-fetch, and a dependency on the array
     itself would fire on every render. */
  const key = [...new Set(phones)].sort().join(",");

  useEffect(() => {
    /* Nothing to ask about. Returning early rather than clearing state keeps
       the effect free of a synchronous setState, and there is nothing to clear:
       an empty page of orders renders no badges either way. */
    if (!key) return;

    let current = true;

    void adminApi
      .post<{ reports: Record<string, ApiFraudReport> }>("admin/fraud/cached", {
        phones: key.split(","),
      })
      .then((data) => {
        if (current) setReports(data.reports);
      })
      .catch(() => {
        /* Left empty — see above. */
      });

    return () => {
      current = false;
    };
  }, [key]);

  return reports;
}
