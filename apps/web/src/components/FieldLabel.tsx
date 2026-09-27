import { useState } from 'react';
import { InfoIcon } from './Icons';

interface Props {
  text: string;
  hint: string;
}

// A field label with a hover/focus "what does this mean?" bubble — styled
// after Booking.com's own info-tooltip pattern (referenced directly by the
// user, 2026-09-17): a rounded speech-bubble with a small pointer, opening
// above a blue "!" marker, cursor turning to a pointing hand on hover
// (matching DashboardShell's own module tabs). The marker's only circle is
// the one InfoIcon already draws itself — an earlier version wrapped it in
// its own bordered/rounded button too, which read as two concentric circles
// (2026-09-17 feedback: keep exactly one border around the "!").
//
// Used across every Web Admin screen that has form fields — the label text
// itself stays in the Web Admin's documented professional register
// (Content Guidelines §1.1: "efficient, businesslike, a work tool under
// time pressure," deliberately distinct from the diner app's "warm and
// friendly" voice), but the bubble's own copy — opened only when a user
// deliberately hovers or tabs to it, never part of the main UI chrome — is
// where each screen's caller can afford the warmer, more human phrasing.
export function FieldLabel({ text, hint }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <label className="mb-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
      <span>{text}</span>
      <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <button
          type="button"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          aria-label={hint}
          className="flex cursor-pointer items-center justify-center text-sky-600 transition-colors hover:text-sky-700"
        >
          <InfoIcon className="h-5 w-5" />
        </button>
        {open && (
          <div role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2">
            <div className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-xs font-normal leading-relaxed text-ink shadow-lg">
              {hint}
            </div>
            {/* The pointer triangle: a small rotated square, only its
                bottom-right border pair drawn (which becomes the outward-
                facing edges after the 45° rotation) so it reads as a
                downward-pointing tip matching the bubble's own border,
                without a visible seam where it overlaps the bubble. left-1/2
                (physical, not the logical `start-1/2`) is deliberate here —
                paired with translateX(-50%) for centering, mixing a logical
                offset with a physical transform would silently break
                centering under RTL (the transform never flips, so an
                RTL-flipped `start-1/2` combined with it drifts off-center). */}
            <span className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-b border-e border-border bg-surface" />
          </div>
        )}
      </span>
    </label>
  );
}
