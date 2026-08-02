import { cn } from "@/lib/utils";

/**
 * Inline icon registry.
 *
 * A dependency-free alternative to an icon package: every glyph the store uses
 * is here, tree-shaken by nothing because it's a single small module, and
 * rendered as `currentColor` stroke so it inherits text colour everywhere.
 */

const paths: Record<string, React.ReactNode> = {
  search: <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35" />,
  cart: (
    <>
      <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.55L21 8H6" />
      <circle cx="10" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
    </>
  ),
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  arrowRight: <path d="M4 12h16m0 0-6-6m6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="m4 12.5 5 5L20 6.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.2 2.8 2.8L16 9.8" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    </>
  ),
  truck: (
    <>
      <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </>
  ),
  shield: <path d="M12 3l7 3v6c0 4-3 7.2-7 9-4-1.8-7-5-7-9V6l7-3Z" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14-4.5L4 9" />
      <path d="M4 13a8 8 0 0 0 14 4.5L20 15" />
      <path d="M4 5v4h4M20 19v-4h-4" />
    </>
  ),
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  phone: (
    <path d="M6 3h3l1.5 4-2 1.5a11 11 0 0 0 5 5L15 11.5 19 13v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4 5.2 2 2 0 0 1 6 3Z" />
  ),
  whatsapp: (
    <path d="M4 20l1.3-4A8 8 0 1 1 8.5 19L4 20Zm5.6-9.4c.4 1.6 1.9 3.2 3.6 3.7l1-1 2 .9v1.2c-2.7.4-6.4-2.5-7.2-5.5l1.1-.6.9 1.9-1.4-.6Z" />
  ),
  location: (
    <>
      <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  package: (
    <>
      <path d="M3 8l9-4 9 4-9 4-9-4Z" />
      <path d="M3 8v8l9 4 9-4V8" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.2v.6" />
    </>
  ),
  spinner: <path d="M12 3a9 9 0 1 0 9 9" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.6A10.6 10.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.8 17.8 0 0 1-3.1 4M6.5 7.4C4 9.1 2.5 12 2.5 12S6 18.5 12 18.5a9.9 9.9 0 0 0 3.3-.6" />
      <path d="M9.5 10.2a3 3 0 0 0 4.2 4.2" />
    </>
  ),

  /* --- Category glyphs --------------------------------------------------- */
  mobile: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  headphones: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="2.5" y="13.5" width="4" height="7" rx="2" />
      <rect x="17.5" y="13.5" width="4" height="7" rx="2" />
    </>
  ),
  watch: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="3" />
      <path d="M9.5 7V3.5h5V7M9.5 17v3.5h5V17" />
    </>
  ),
  laptop: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M2 19h20" />
    </>
  ),
  speaker: (
    <>
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <circle cx="12" cy="15" r="3" />
      <path d="M12 6.5v.6" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8h3l1.5-2.5h9L18 8h3v11H3z" />
      <circle cx="12" cy="13.5" r="3.5" />
    </>
  ),
  power: (
    <>
      <rect x="4" y="7" width="14" height="10" rx="2.5" />
      <path d="M18 10.5h2.5v3H18" />
      <path d="M7.5 10v4M11 10v4" />
    </>
  ),
  gamepad: (
    <>
      <path d="M7.5 8h9a4.5 4.5 0 0 1 4.4 5.5l-.6 2.7A2.6 2.6 0 0 1 16 17l-1.6-2h-4.8L8 17a2.6 2.6 0 0 1-4.3-.8l-.6-2.7A4.5 4.5 0 0 1 7.5 8Z" />
      <path d="M7 11v2.4M5.8 12.2h2.4M15.5 11.4h.01M17.4 13.2h.01" />
    </>
  ),
};

export type IconName = keyof typeof paths;

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName | string;
  size?: number;
}

export function Icon({ name, size = 20, className, ...rest }: IconProps) {
  const glyph = paths[name] ?? paths.package;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      {...rest}
    >
      {glyph}
    </svg>
  );
}
