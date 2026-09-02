// Brand mark shown on every auth/registration screen — always pinned to the
// left edge regardless of the surrounding RTL layout, matching how an
// international brand's logotype stays put independent of content language.
// onDark: for the wizard shell's dark header bar (Booking-style), where the
// default ink color would be invisible against the same dark background.
export function FeedbookBrand({ className = '', onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <div dir="ltr" className={`text-left ${className}`}>
      <span className={`font-brand text-2xl font-bold ${onDark ? 'text-white' : 'text-ink'}`}>Feedbook</span>
    </div>
  );
}
