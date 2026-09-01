// Brand mark shown on every auth/registration screen — always pinned to the
// left edge regardless of the surrounding RTL layout, matching how an
// international brand's logotype stays put independent of content language.
export function FeedbookBrand({ className = '' }: { className?: string }) {
  return (
    <div dir="ltr" className={`text-left ${className}`}>
      <span className="font-brand text-2xl font-bold text-blue-900">Feedbook</span>
    </div>
  );
}
