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
  chevronUp: <path d="m19 15-7-7-7 7" />,
  arrowRight: <path d="M4 12h16m0 0-6-6m6 6-6 6" />,
  arrowUp: <path d="M12 20V4m0 0-6 6m6-6 6 6" />,
  arrowDown: <path d="M12 4v16m0 0-6-6m6 6 6-6" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
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
  /* Filled, unlike everything else here: three hollow rings at 20px read as a
     row of tiny circles rather than the "more" affordance people tap. */
  dots: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  signOut: (
    <>
      <path d="M15 4V3.6A1.6 1.6 0 0 0 13.4 2h-7A1.6 1.6 0 0 0 4.8 3.6v16.8A1.6 1.6 0 0 0 6.4 22h7a1.6 1.6 0 0 0 1.6-1.6V20" />
      <path d="M10.5 12h9.5m0 0-3.2-3.2M20 12l-3.2 3.2" />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8" r="3.5" />
      <path d="M3 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.2a3.5 3.5 0 0 1 0 5.6" />
      <path d="M17.6 14.3A6.5 6.5 0 0 1 21 20" />
    </>
  ),
  /* Sliders rather than a gear: a 24px gear needs eight teeth to read as one,
     and at 20px they close up into a blob. */
  settings: (
    <>
      <path d="M4 7.5h9.5M18.5 7.5H20" />
      <path d="M4 16.5h1.5M10.5 16.5H20" />
      <circle cx="16" cy="7.5" r="2.5" />
      <circle cx="8" cy="16.5" r="2.5" />
    </>
  ),
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
  tablet: (
    <>
      <rect x="4.5" y="2.5" width="15" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  tv: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2.5" />
      <path d="M12 17v4M8 21h8" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 9.6h.01M9.5 9.6h.01M13 9.6h.01M16.5 9.6h.01" />
      <path d="M6 12.8h.01M9.5 12.8h.01M13 12.8h.01M16.5 12.8h.01" />
      <path d="M8.5 15.6h7" />
    </>
  ),
  mouse: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="5" />
      <path d="M12 6.5v4" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3.5h10V8" />
      <rect x="3" y="8" width="18" height="8" rx="2.5" />
      <path d="M7 13h10v7.5H7z" />
    </>
  ),
  router: (
    <>
      <rect x="3" y="14" width="18" height="6.5" rx="2.5" />
      <path d="M6.5 17.2h.01M9.5 17.2h.01" />
      <path d="M8.5 10.6a5 5 0 0 1 7 0" />
      <path d="M6 8a8.5 8.5 0 0 1 12 0" />
    </>
  ),
  earbuds: (
    <>
      <path d="M6.5 3.5a3 3 0 0 1 3 3v8.5a3 3 0 1 1-3-3" />
      <path d="M17.5 3.5a3 3 0 0 0-3 3v8.5a3 3 0 1 0 3-3" />
    </>
  ),
  microphone: (
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3.5M9 21.5h6" />
    </>
  ),
  drone: (
    <>
      {/* Flattened rotors rather than circles: at 20px four equal circles read
          as dots, and an ellipse is what a spinning propeller looks like. */}
      <ellipse cx="5" cy="6.5" rx="3" ry="1.6" />
      <ellipse cx="19" cy="6.5" rx="3" ry="1.6" />
      <ellipse cx="5" cy="17.5" rx="3" ry="1.6" />
      <ellipse cx="19" cy="17.5" rx="3" ry="1.6" />
      <rect x="9.5" y="10" width="5" height="4" rx="1.5" />
      <path d="m6.6 8 2.9 2M17.4 8l-2.9 2M6.6 16l2.9-2M17.4 16l-2.9-2" />
    </>
  ),
  pendrive: (
    <>
      <rect x="3" y="9" width="13" height="6" rx="1.8" />
      <path d="M16 10.5h3.5a1.5 1.5 0 0 1 0 3H16" />
      <path d="M6.5 11v2" />
    </>
  ),

  /* --- Lighting and electrical -------------------------------------------- */
  bulb: (
    <>
      <path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3Z" />
      <path d="M10 19h4M10.5 21.5h3" />
    </>
  ),
  lamp: (
    <>
      <path d="M8.5 3h7l3 7h-13l3-7Z" />
      <path d="M12 10v9M8 21h8" />
    </>
  ),
  torch: (
    <>
      {/* A flared head over a straight body. Without the flare it is a
          thermometer, and next to `power` it would be a second battery. */}
      <path d="M8 8.5 10 4h4l2 4.5" />
      <path d="M9.5 8.5h5v11a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5v-11Z" />
      <path d="M9.5 12.5h5" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5" />
      <path d="M6.5 8h11v2.5a5.5 5.5 0 0 1-11 0V8Z" />
      <path d="M12 16v5" />
    </>
  ),
  socket: (
    <>
      {/* Plate, round face, two slots. Two dots over a mouth line — the obvious
          drawing — reads as a face, and this registry already has a robot. */}
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <circle cx="12" cy="12" r="6" />
      <path d="M9.9 10.2v3M14.1 10.2v3" />
    </>
  ),
  switch: (
    <>
      <rect x="5.5" y="2.5" width="13" height="19" rx="2.5" />
      <rect x="9.5" y="7.5" width="5" height="9" rx="1.5" />
      <path d="M9.5 12h5" />
    </>
  ),
  fan: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 9.8V4a3 3 0 0 1 3 3c0 1.6-1.3 2.8-3 2.8Z" />
      <path d="M14.2 12H20a3 3 0 0 1-3 3c-1.6 0-2.8-1.3-2.8-3Z" />
      <path d="M12 14.2V20a3 3 0 0 1-3-3c0-1.6 1.3-2.8 3-2.8Z" />
      <path d="M9.8 12H4a3 3 0 0 1 3-3c1.6 0 2.8 1.3 2.8 3Z" />
    </>
  ),
  cable: (
    <>
      {/* A connector head and a hanging cord. Drawn as a spool of wire it was
          indistinguishable from a disc. */}
      <rect x="8.5" y="2.5" width="7" height="5" rx="1.5" />
      <path d="M10.5 2.5v-1M13.5 2.5v-1" />
      <path d="M12 7.5v2.5c0 4-5 3.2-5 7 0 2.1 1.7 3.5 3.8 3.5" />
    </>
  ),
  bolt: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" />,

  /* --- Toys ---------------------------------------------------------------- */
  teddy: (
    <>
      <circle cx="6.8" cy="6" r="2.6" />
      <circle cx="17.2" cy="6" r="2.6" />
      <circle cx="12" cy="13" r="7" />
      <path d="M9.8 11.5h.01M14.2 11.5h.01" />
      <circle cx="12" cy="15" r="1.6" />
    </>
  ),
  blocks: (
    <>
      <rect x="8" y="3" width="8" height="8" rx="1.5" />
      <rect x="2.5" y="13" width="8" height="8" rx="1.5" />
      <rect x="13.5" y="13" width="8" height="8" rx="1.5" />
    </>
  ),
  car: (
    <>
      <path d="M3.5 15.5v-2.2l2.2-4.3h11l3.8 4.3v2.2" />
      <path d="M3.5 15.5h17" />
      <circle cx="8" cy="17.6" r="2" />
      <circle cx="16" cy="17.6" r="2" />
    </>
  ),
  robot: (
    <>
      <rect x="4.5" y="7.5" width="15" height="12" rx="3" />
      <path d="M12 4.8v2.7" />
      <circle cx="12" cy="3.6" r="1.1" />
      <path d="M9.3 12h.01M14.7 12h.01" />
      <path d="M9.5 16h5" />
      <path d="M2 12v3M22 12v3" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 7 3.5 2.5-1.3 4.2h-4.4L8.5 9.5 12 7Z" />
      <path d="M12 3v4M4.3 9.4h4.2M19.7 9.4h-4.2M7 19l2.8-5.3M17 19l-2.8-5.3" />
    </>
  ),
  rocket: (
    <>
      {/* Fins carry the whole read. Without them the nose cone alone is a map
          pin, which this registry also has. */}
      <path d="M12 2.5c2.6 2.3 4 5.6 4 9L14 14.5h-4L8 11.5c0-3.4 1.4-6.7 4-9Z" />
      <circle cx="12" cy="9" r="1.7" />
      <path d="M10 12.6 7 15.2v3.4l2.6-2M14 12.6l3 2.6v3.4l-2.6-2" />
      <path d="M10.6 17.5 12 21.5l1.4-4" />
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
