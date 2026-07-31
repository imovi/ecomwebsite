import Script from "next/script";
import { getTrackingConfig } from "@/lib/data/tracking";

/**
 * Google Tag Manager loader.
 *
 * WHY GTM AND NOT A GA4 MEASUREMENT ID
 * ------------------------------------
 * GTM is a container the shop owner fills from Google's own UI — GA4, Google Ads
 * conversion tracking, remarketing. One container id here therefore covers every
 * Google product they will ever add, and adding one becomes a change in their
 * dashboard rather than a schema migration and a deploy in this codebase.
 *
 * The container id comes from store settings at request time, like the Meta pixel,
 * so connecting it is a form rather than a rebuild. Renders nothing when unset or
 * switched off.
 *
 * `afterInteractive`, for the same reason as the Meta pixel: GTM pulls in whatever
 * tags the container holds, and blocking first paint on that is exactly what makes
 * a product page feel slow on 4G. The `dataLayer` is seeded before the script
 * loads, so events pushed by a component that mounts early are not lost — GTM
 * replays whatever it finds in the array on startup.
 */
export async function GoogleTagManager() {
  const { gtmContainerId } = await getTrackingConfig();

  if (!gtmContainerId) return null;

  return (
    <>
      <Script id="gtm-init" strategy="afterInteractive">
        {`
window.dataLayer = window.dataLayer || [];
window.dataLayer.push({'gtm.start': new Date().getTime(), event: 'gtm.js'});
(function(w,d,s,l,i){
  var f=d.getElementsByTagName(s)[0],
      j=d.createElement(s),
      dl=l!='dataLayer'?'&l='+l:'';
  j.async=true;
  j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
  f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtmContainerId}');
        `}
      </Script>

      {/*
        Noscript fallback. Counts visitors whose browser blocks the script, which
        on cheap Android devices is a meaningful slice of traffic. Only tags
        configured to fire on the noscript pageview will run.
      */}
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${gtmContainerId}`}
          height="0"
          width="0"
          style={{ display: "none", visibility: "hidden" }}
          title="Google Tag Manager"
        />
      </noscript>
    </>
  );
}
