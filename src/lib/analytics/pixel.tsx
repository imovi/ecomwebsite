import Script from "next/script";
import { getTrackingConfig } from "@/lib/data/tracking";

/**
 * Meta Pixel loader.
 *
 * The pixel id comes from store settings at request time, not from a build-time
 * environment variable, so the shop owner can connect their own pixel from the
 * admin dashboard and have it live on the next page load rather than the next
 * deploy. Renders nothing when no pixel is configured or tracking is switched
 * off — a pre-launch environment firing AddToCart teaches a live ad account the
 * wrong audience.
 *
 * `afterInteractive` rather than `beforeInteractive`: the pixel is not needed to
 * render the page, and blocking first paint on a third-party script is exactly
 * what makes a product page feel slow on a 4G connection. The trade-off is that
 * a shopper who leaves within the first second is not counted — an acceptable
 * loss for a faster page.
 *
 * The browser handles engagement events (ViewContent, AddToCart,
 * InitiateCheckout). Purchase is reported by the API itself, from the one process
 * that holds the Conversions API token — see
 * `backend/src/modules/marketing/meta-capi.service.ts`.
 */
export async function MetaPixel() {
  const { pixelId, domainVerification } = await getTrackingConfig();

  /* Independent of the pixel: Meta reads this tag to confirm domain ownership,
     which has to be possible before any events are worth sending. */
  const verificationTag = domainVerification ? (
    <meta name="facebook-domain-verification" content={domainVerification} />
  ) : null;

  if (!pixelId) return verificationTag;

  return (
    <>
      {verificationTag}

      <Script id="meta-pixel" strategy="afterInteractive">
        {`
!function(f,b,e,v,n,t,s){
  if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;
  s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)
}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
        `}
      </Script>

      {/*
        Noscript fallback. Counts visitors whose browser blocks the script —
        a meaningful slice of traffic on cheap Android devices.
      */}
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
