import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  content: ReactNode;
  children: ReactNode;
  // Replaces (never merges with) the default `inline-flex` — needed
  // whenever the trigger relies on a layout property of the wrapper itself
  // rather than just the trigger's own classes: a `flex-1` segment that must
  // split a parent row's width evenly, an `ms-auto` push-to-end, or a
  // `block w-full min-w-0` box so a `truncate` child still clips against a
  // real width instead of shrink-to-fit's content width. Mixing a passed
  // `block` with a hardcoded `inline-flex` would leave both classes in the
  // DOM with the winner decided by Tailwind's internal stylesheet order, not
  // by anything meaningful here — so this always fully replaces instead.
  className?: string;
  // 'top' (default) opens the bubble above the trigger — the right default
  // for most of the site, but wrong for a trigger that lives right at the
  // top of the page (the header bar): there's no room above it, and the
  // bubble gets silently clipped by the top of the browser window (reported
  // 2026-09-24 for the envelope and language-toggle header icons). 'bottom'
  // opens it below instead, the same direction already used for the
  // notification bell's own panel.
  placement?: 'top' | 'bottom';
}

// The one shared "Booking-style" speech-bubble tooltip for the whole site
// (2026-09-24) — a rounded bubble with a small pointer triangle, replacing
// every bare `title="..."` (the browser's own unstyled native tooltip) site-
// wide. Same visual language as FieldLabel's "!" hint bubble and the
// inventory screen's low-stock alert-dot bubble, generalized here so any
// trigger element (an icon button, a disabled control, anything) can wrap
// itself in one instead of every call site hand-rolling its own bubble.
//
// Rendered into a portal at `document.body` with viewport-fixed coordinates
// computed from the trigger's own bounding rect, rather than `absolute`
// positioning off the trigger directly — a plain `absolute` bubble gets
// silently clipped by any scrolling/overflow ancestor (hit exactly this bug
// with the ingredients table's `overflow-x-auto` wrapper: setting
// overflow-x alone makes the browser treat overflow-y as `auto` too), and a
// tooltip that can appear anywhere in the app has no way to guarantee it
// never sits inside one.
export function Tooltip({ content, children, className, placement = 'top' }: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const top = placement === 'top' ? rect.top - 8 : rect.bottom + 8;
    setCoords({ top, left: rect.left + rect.width / 2 });
  }, [open, placement]);

  return (
    // Deliberately NOT `position: relative` — the bubble below is portaled
    // with viewport-fixed coordinates, not positioned off this wrapper, so
    // this stays a plain (non-positioned) inline-flex box. That matters for
    // a trigger that itself relies on `absolute` positioning against some
    // further-out ancestor (e.g. a corner delete badge on a photo
    // thumbnail): CSS walks past a non-positioned wrapper to find that
    // ancestor, but a `relative` one here would wrongly become it instead.
    <span
      ref={anchorRef}
      className={className ?? 'inline-flex'}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open &&
        coords &&
        content &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              transform: placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
            className="pointer-events-none z-50 w-max max-w-64"
          >
            {placement === 'bottom' && (
              <span className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px] border-e border-t border-border bg-surface" />
            )}
            <div className="rounded-xl border border-border bg-surface px-3 py-1.5 text-start text-xs font-normal leading-relaxed text-ink shadow-lg">
              {content}
            </div>
            {placement === 'top' && (
              <span className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-b border-e border-border bg-surface" />
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
