// Small inline outline icons, same hand-authored-SVG approach as
// LanguageToggle's flags — no icon library dependency for two glyphs.
// currentColor throughout so each usage controls its own color via className.

export function TrashIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 6h12M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2m-7 0 .8 10.2a1 1 0 0 0 1 .8h6.4a1 1 0 0 0 1-.8L15 6" />
      <path d="M8.5 9.5v4M11.5 9.5v4" />
    </svg>
  );
}

export function InfoIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v4.5" />
      <circle cx="10" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function QrCodeIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="3" width="5" height="5" rx="0.5" />
      <rect x="12" y="3" width="5" height="5" rx="0.5" />
      <rect x="3" y="12" width="5" height="5" rx="0.5" />
      <path d="M12.5 12.5h2v2h-2z" fill="currentColor" stroke="none" />
      <path d="M16.5 12.5v2M12.5 16.5h4" />
    </svg>
  );
}

export function PencilIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.2 3.8a1.5 1.5 0 0 1 2.1 2.1L7 15.2l-3 .8.8-3 9.4-9.2Z" />
    </svg>
  );
}

export function CheckIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 10.5 8 14l8-8" />
    </svg>
  );
}

// Exact Ionicons "notifications-outline" path data (ionic-team/ionicons),
// the same glyph the mobile app renders via @expo/vector-icons — swapped in
// 2026-09-20 so the Web Admin's bell matches it exactly instead of being a
// separately hand-drawn approximation. Kept at Ionicons' own 512-unit
// viewBox (and its stroke width) rather than rescaled to this file's usual
// 0 0 20 20, since viewBox scaling makes that unnecessary and rescaling by
// hand risks subtly distorting the shape.
export function BellIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M427.68,351.43C402,320,383.87,304,383.87,217.35,383.87,138,343.35,109.73,310,96c-4.43-1.82-8.6-6-9.95-10.55C294.2,65.54,277.8,48,256,48S217.79,65.55,212,85.47c-1.35,4.6-5.52,8.71-9.95,10.53-33.39,13.75-73.87,41.92-73.87,121.35C128.13,304,110,320,84.32,351.43,73.68,364.45,83,384,101.61,384H410.49C429,384,438.26,364.39,427.68,351.43Z" />
      <path d="M320,384v16a64,64,0,0,1-128,0V384" />
    </svg>
  );
}

// Exact Ionicons "mail-outline" path data — the diner-messages icon
// (2026-09-20), matching the mobile app's own HeaderMenu envelope exactly.
// Placeholder for now: renders in the TopBar with no click behavior yet,
// since the feature it will open ("all message types/requests from diners
// to the restaurant") is explicitly deferred to a later session.
export function EnvelopeIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="48" y="96" width="416" height="320" rx="40" ry="40" />
      <polyline points="112 160 256 272 400 160" />
    </svg>
  );
}

export function UserIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="10" cy="6.8" r="3.3" />
      <path d="M3.3 16.5a6.7 6.7 0 0 1 13.4 0" />
    </svg>
  );
}

export function EyeIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10Z" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

export function EyeOffIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2.5 2.5l15 15" />
      <path d="M8.3 4.7A8.9 8.9 0 0 1 10 4.5c5.5 0 8.5 5.5 8.5 5.5a15.6 15.6 0 0 1-3.1 3.7M5.6 5.9C3.2 7.3 1.5 10 1.5 10s3 5.5 8.5 5.5a8.5 8.5 0 0 0 3.1-.6" />
      <path d="M7.6 8.6a2.5 2.5 0 0 0 3.5 3.5" />
    </svg>
  );
}

export function CloseIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}

// Exact path data from Ionicons "sparkles-outline" (ionic-team/ionicons),
// the same icon the mobile app's own Feedstars badge uses
// (BurgerSideMenu.tsx) — kept pixel-identical so the two sides of the
// product show the same mark, not a lookalike redrawn by hand.
export function SparklesIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M259.92,262.91,216.4,149.77a9,9,0,0,0-16.8,0L156.08,262.91a9,9,0,0,1-5.17,5.17L37.77,311.6a9,9,0,0,0,0,16.8l113.14,43.52a9,9,0,0,1,5.17,5.17L199.6,490.23a9,9,0,0,0,16.8,0l43.52-113.14a9,9,0,0,1,5.17-5.17L378.23,328.4a9,9,0,0,0,0-16.8L265.09,268.08A9,9,0,0,1,259.92,262.91Z" />
      <polygon points="108 68 88 16 68 68 16 88 68 108 88 160 108 108 160 88 108 68" />
      <polygon points="426.67 117.33 400 48 373.33 117.33 304 144 373.33 170.67 400 240 426.67 170.67 496 144 426.67 117.33" />
    </svg>
  );
}

// Dashboard tab icons (2026-09-20) — same approach as BellIcon/EnvelopeIcon:
// exact path data pulled from ionic-team/ionicons rather than hand-drawn, one
// per tab, shown to the tab label's physical right.
export function DashboardIcon({ className = 'h-4 w-4' }: { className?: string }) {
  // Ionicons "speedometer-outline" — the needle (first path) has no fill:none
  // in the source, i.e. it's meant to render as a solid shape, not a stroked
  // outline like the rest of the glyph.
  return (
    <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path
        fill="currentColor"
        stroke="none"
        d="M326.1,231.9l-47.5,75.5a31,31,0,0,1-7,7,30.11,30.11,0,0,1-35-49l75.5-47.5a10.23,10.23,0,0,1,11.7,0A10.06,10.06,0,0,1,326.1,231.9Z"
      />
      <path d="M256,64C132.3,64,32,164.2,32,287.9A223.18,223.18,0,0,0,88.3,436.4c1.1,1.2,2.1,2.4,3.2,3.5a25.19,25.19,0,0,0,37.1-.1,173.13,173.13,0,0,1,254.8,0,25.19,25.19,0,0,0,37.1.1l3.2-3.5A223.18,223.18,0,0,0,480,287.9C480,164.2,379.7,64,256,64Z" />
      <line x1="256" y1="128" x2="256" y2="160" />
      <line x1="416" y1="288" x2="384" y2="288" />
      <line x1="128" y1="288" x2="96" y2="288" />
      <line x1="165.49" y1="197.49" x2="142.86" y2="174.86" />
      <line x1="346.51" y1="197.49" x2="369.14" y2="174.86" />
    </svg>
  );
}

export function MenuTabIcon({ className = 'h-4 w-4' }: { className?: string }) {
  // Ionicons "restaurant-outline".
  return (
    <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M57.49,47.74,425.92,416.17a37.28,37.28,0,0,1,0,52.72h0a37.29,37.29,0,0,1-52.72,0l-90-91.55A32,32,0,0,1,274,354.91v-5.53a32,32,0,0,0-9.52-22.78l-11.62-10.73a32,32,0,0,0-29.8-7.44h0A48.53,48.53,0,0,1,176.5,295.8L91.07,210.36C40.39,159.68,21.74,83.15,57.49,47.74Z" />
      <path d="M400,32l-77.25,77.25A64,64,0,0,0,304,154.51v14.86a16,16,0,0,1-4.69,11.32L288,192" />
      <path d="M320,224l11.31-11.31A16,16,0,0,1,342.63,208h14.86a64,64,0,0,0,45.26-18.75L480,112" />
      <line x1="440" y1="72" x2="360" y2="152" />
      <path d="M200,368,100.28,468.28a40,40,0,0,1-56.56,0h0a40,40,0,0,1,0-56.56L128,328" />
    </svg>
  );
}

export function InventoryIcon({ className = 'h-4 w-4' }: { className?: string }) {
  // Ionicons "cube-outline".
  return (
    <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M448,341.37V170.61A32,32,0,0,0,432.11,143l-152-88.46a47.94,47.94,0,0,0-48.24,0L79.89,143A32,32,0,0,0,64,170.61V341.37A32,32,0,0,0,79.89,369l152,88.46a48,48,0,0,0,48.24,0l152-88.46A32,32,0,0,0,448,341.37Z" />
      <polyline points="69 153.99 256 263.99 443 153.99" />
      <line x1="256" y1="463.99" x2="256" y2="263.99" />
    </svg>
  );
}

export function OrdersTabIcon({ className = 'h-4 w-4' }: { className?: string }) {
  // Ionicons "receipt-outline" — the same glyph the mobile app's order
  // tracker uses for its "received" timeline stage (OrderTracker.tsx).
  return (
    <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinejoin="round" className={className}>
      <polyline points="160 336 160 48 192 64 224 48 255.94 64 288.31 48 320 64 351.79 48 383.72 64 416 48 448.01 64 480 48 480 272" />
      <path d="M480,272V384a80,80,0,0,1-80,80h0a80,80,0,0,1-80-80V336H48a15.86,15.86,0,0,0-16,16c0,64,6.74,112,80,112H400" />
      <line x1="224" y1="144" x2="416" y2="144" strokeLinecap="round" />
      <line x1="288" y1="224" x2="416" y2="224" strokeLinecap="round" />
    </svg>
  );
}

export function TablesTabIcon({ className = 'h-4 w-4' }: { className?: string }) {
  // Ionicons "grid-outline".
  return (
    <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="48" y="48" width="176" height="176" rx="20" ry="20" />
      <rect x="288" y="48" width="176" height="176" rx="20" ry="20" />
      <rect x="48" y="288" width="176" height="176" rx="20" ry="20" />
      <rect x="288" y="288" width="176" height="176" rx="20" ry="20" />
    </svg>
  );
}

export function TeamTabIcon({ className = 'h-4 w-4' }: { className?: string }) {
  // Ionicons "people-outline".
  return (
    <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M402,168c-2.93,40.67-33.1,72-66,72s-63.12-31.32-66-72c-3-42.31,26.37-72,66-72S405,126.46,402,168Z" />
      <path d="M336,304c-65.17,0-127.84,32.37-143.54,95.41-2.08,8.34,3.15,16.59,11.72,16.59H467.83c8.57,0,13.77-8.25,11.72-16.59C463.85,335.36,401.18,304,336,304Z" strokeLinecap="butt" />
      <path d="M200,185.94C197.66,218.42,173.28,244,147,244S96.3,218.43,94,185.94C91.61,152.15,115.34,128,147,128S202.39,152.77,200,185.94Z" />
      <path d="M206,306c-18.05-8.27-37.93-11.45-59-11.45-52,0-102.1,25.85-114.65,76.2C30.7,377.41,34.88,384,41.72,384H154" strokeLinecap="butt" />
    </svg>
  );
}
