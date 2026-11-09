import { useEffect, useRef, useState } from 'react';

// Shared accordion duration (2026-11-05) — the CSS transition on whatever
// element uses this hook's ref must last exactly this long, so the
// scroll-tracking loop below knows when the content has finished growing.
export const ACCORDION_TRANSITION_MS = 280;

// Shared accordion behavior (2026-11-05, explicit user request — first
// built for the Accounts module's own expand-detail row, then applied
// everywhere else a click expands content, e.g. MenuManager's category
// cards): scrolls the expanding OR collapsing element into view
// CONCURRENTLY with its own CSS grid-row animation in either direction, not
// after it finishes, and tracks whether an item has EVER been expanded so
// its content can stay mounted once opened (so a later collapse still has
// something to animate closed, instead of vanishing instantly) without
// paying the cost of mounting every item's content up front, before
// anyone's opened it.
//
// Pass the returned `ref` to the element whose CSS transitions
// grid-template-rows between '0fr' (collapsed) and '1fr' (expanded) over
// exactly ACCORDION_TRANSITION_MS, e.g.:
//   style={{ display: 'grid', gridTemplateRows: expanded ? '1fr' : '0fr',
//            transition: `grid-template-rows ${ACCORDION_TRANSITION_MS}ms ease` }}
// wrapping an inner `<div style={{ overflow: 'hidden' }}>` around the
// actual content — that inner overflow:hidden is required for the '0fr'
// state to actually collapse to zero; a grid item's default
// min-height:auto would otherwise keep it at its content's full height
// regardless of the row track size.
export function useAccordionScrollIntoView(expanded: boolean) {
  const [everExpanded, setEverExpanded] = useState(expanded);
  const ref = useRef<HTMLDivElement>(null);
  // Guards against running the tracking loop on mount (2026-11-05) — once
  // closing was made to track too (any CHANGE of `expanded`, not just a
  // transition into `true`), the effect's very first run — on mount, for
  // every row on the page, most of them collapsed — would otherwise also
  // count as "a change" and scroll every one of them into view as soon as
  // the screen loads. Skipped once, then never again.
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (expanded) setEverExpanded(true);

    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Runs for BOTH directions (2026-11-05, explicit user request — closing
    // used to just snap shut with no scroll adjustment at all; now it
    // mirrors opening exactly). A single scrollIntoView call right when the
    // transition starts would measure the element at its CURRENT height —
    // still the size it's animating FROM, not toward — so the very first
    // correction would already be stale. Calling it with behavior:'auto'
    // (instant, not 'smooth') on every animation frame instead means each
    // call reads the element's CURRENT, still-animating height (growing
    // while opening, shrinking while closing) and makes one small instant
    // correction — a run of these, one per frame, reads as one continuous
    // smooth motion that tracks the content in real time, concurrently
    // with the CSS transition rather than after it. 'smooth' would fight
    // itself here: each frame would restart its own multi-frame easing on
    // top of the last one's, never settling.
    let rafId: number;
    const start = performance.now();
    function track(now: number) {
      ref.current?.scrollIntoView({ behavior: 'auto', block: 'center' });
      if (now - start < ACCORDION_TRANSITION_MS) {
        rafId = requestAnimationFrame(track);
      }
    }
    rafId = requestAnimationFrame(track);
    return () => cancelAnimationFrame(rafId);
  }, [expanded]);

  return { ref, everExpanded };
}
