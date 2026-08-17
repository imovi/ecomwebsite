"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin/client";

/**
 * How many customers are waiting for a call.
 *
 * Read once per screen so the Orders tabs can show the number without the desk
 * having to click Incomplete to find out there is work.
 *
 * The endpoint takes no paging options — it returns the open leads plus an
 * `openCount` beside them, and rejects anything else in the query string. So
 * this is the same call the Incomplete screen makes, and only the count is
 * kept.
 *
 * Returns 0 when it fails. The badge is a nudge toward a screen that shows the
 * real number in large type; a missing nudge is a smaller harm than an error
 * banner on the orders queue for a decoration that did not load.
 */
export function useOpenCheckoutCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let current = true;

    void adminApi
      .get<{ openCount: number }>("admin/abandoned")
      .then((data) => {
        if (current) setCount(data.openCount);
      })
      .catch(() => {
        /* Left at zero — see above. */
      });

    return () => {
      current = false;
    };
  }, []);

  return count;
}
