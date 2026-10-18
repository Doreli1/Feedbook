// An iOS-style on/off switch, extracted out of MenuManager.tsx (2026-10-18)
// so the same "off by default, reveals a section's own editor once switched
// on" pattern can be reused outside the menu builder too (e.g. the
// Restaurant Details screen's "כשרות" section). The knob's position is
// driven by `margin-inline-start` rather than a `translateX` transform —
// that's the one CSS property here that both animates smoothly AND is
// direction-aware on its own, so the same code slides the knob the
// physically-correct way in both RTL and LTR without reading `dir`
// explicitly (a `translateX` sign would need to flip per direction by hand,
// the exact class of bug documented for this app's RTL back-icon fix).
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-border-strong'}`}
    >
      <span
        className="h-4 w-4 rounded-full bg-white shadow transition-[margin-inline-start] duration-150"
        style={{ marginInlineStart: checked ? '1.125rem' : '0.125rem' }}
      />
    </button>
  );
}
