"use client";

import { useEffect } from "react";
import { captureClickId } from "./fb-click-id";

/**
 * Records the ad click that brought this visitor, on arrival.
 *
 * Renders nothing. It exists because the click id has to be taken from the
 * LANDING url — by the time a shopper reaches checkout the `?fbclid=` is long
 * gone from the address bar — and because the pixel, which normally does this,
 * is a third-party script that a blocker or a bad connection can stop. Those
 * visitors are precisely the ones the server-side conversion report exists to
 * recover, so the capture has to live in first-party code.
 *
 * Mounted in the storefront layout, not the root layout: the admin panel has no
 * shoppers in it, and an owner working the order queue should not be leaving ad
 * attribution behind on their own dashboard.
 */
export function FbClickCapture() {
  useEffect(() => {
    captureClickId();
  }, []);

  return null;
}
