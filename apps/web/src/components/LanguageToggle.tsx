import { useI18n } from '../lib/i18n';
import { Tooltip } from './Tooltip';

// Inline SVGs, not emoji flags: Windows has no native color-emoji glyphs for
// regional-indicator flag sequences and silently falls back to rendering the
// literal two-letter code ("US"/"IL") as plain text instead of a flag image
// — caught by actually looking at a screenshot, not by reading the code.
function FlagIL() {
  return (
    <svg viewBox="0 0 24 16" className="h-full w-full">
      <rect width="24" height="16" fill="#ffffff" />
      <rect y="1.5" width="24" height="2.2" fill="#0038b8" />
      <rect y="12.3" width="24" height="2.2" fill="#0038b8" />
      <g fill="none" stroke="#0038b8" strokeWidth="0.9">
        <polygon points="12,5.3 13.9,8.6 10.1,8.6" />
        <polygon points="12,10.7 13.9,7.4 10.1,7.4" />
      </g>
    </svg>
  );
}

function FlagUS() {
  const stripeH = 16 / 13;
  return (
    <svg viewBox="0 0 24 16" className="h-full w-full">
      <rect width="24" height="16" fill="#b22234" />
      {[1, 3, 5, 7, 9, 11].map((i) => (
        <rect key={i} y={i * stripeH} width="24" height={stripeH} fill="#ffffff" />
      ))}
      <rect width="10.4" height={7 * stripeH} fill="#3c3b6e" />
    </svg>
  );
}

// A single circular flag badge reflecting the current language — click to
// switch to the other one. IL flag while Hebrew is active, US flag while
// English is.
export function LanguageToggle({
  className = '',
  onDark = false,
  placement = 'top',
}: {
  className?: string;
  onDark?: boolean;
  // TopBar's own usage sits in the header, at the very top of the page, so
  // the default upward-opening bubble had nowhere to go and got clipped by
  // the top of the browser window (reported 2026-09-24) — every other
  // usage (sign-in, MFA screens, etc.) has room above it, so 'top' stays the
  // default there.
  placement?: 'top' | 'bottom';
}) {
  const { lang, setLang } = useI18n();

  return (
    <Tooltip content={lang === 'he' ? 'English' : 'עברית'} className={className} placement={placement}>
      <button
        type="button"
        onClick={() => setLang(lang === 'he' ? 'en' : 'he')}
        aria-label={lang === 'he' ? 'Switch to English' : 'עבור לעברית'}
        className={`h-8 w-8 overflow-hidden rounded-full border shadow-sm ${onDark ? 'border-white/50 hover:border-white' : 'border-border hover:border-border-strong'}`}
      >
        {lang === 'he' ? <FlagIL /> : <FlagUS />}
      </button>
    </Tooltip>
  );
}
