// Feedbook diner app — visual language, source: original capstone project ch.
// 6.2 (client-side interface) via Feedbook_UI_Milestone4_Mobile_Spec.docx §2.
// Deliberately its own palette, distinct from the Web Admin's later
// Booking-inspired navy/teal Design System — the diner app's screens (and
// this spec) are based on the earlier client-app chapter of the thesis, not
// the business-side one that informed the web redesign.
export const colors = {
  royalBlue: '#1B3FA8',
  royalBlueDark: '#122B7A',
  white: '#FFFFFF',
  ink: '#1B2430',
  textMuted: '#6E6A61',
  border: '#E3DED2',
  surface: '#FFFFFF',
  background: '#F6F4EF',
  danger: '#DC2626', // sign-out / destructive actions only, per spec rule #5
  dangerSoft: '#FBEAEA',
  success: '#22C55E', // available table
  successSoft: '#E7F3EA',
  occupied: '#9CA3AF', // occupied table
  selected: '#1B3FA8', // table the user just picked
  smoking: '#D97706',
  // Real-time, data-driven dish bullets (2026-09-24) — both deliberately
  // distinct from `danger` (#DC2626), which this file already reserves for
  // sign-out/destructive actions only (spec rule #5 above).
  bottleGreen: '#3D7A4A', // today's order-count / last-ordered activity line — lightened 2026-09-27, was #2F5233
  darkRed: '#8B1E1E', // high-demand / sold-out filled badges (white text on top)
  brightRed: '#E11D2A', // "כמעט אזל" text-only label (2026-09-27) — darkRed read as too muted with no fill behind it, this one's meant to pop on its own
  valueOrange: '#EA580C', // "משתלם במיוחד" badge frame, per the 7.1.1 mockup
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radii = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
