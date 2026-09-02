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
