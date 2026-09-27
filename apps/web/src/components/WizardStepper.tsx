import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { CheckIcon } from './Icons';
import { Tooltip } from './Tooltip';

// AFD §3.7.1 — the restaurant self-registration wizard's numbered steps.
// Screen 1 of the AFD table (הצטרפות/sign-in) is deliberately NOT part of
// this numbered sequence: it's a precondition, not a step you revisit or
// track progress through — the only way back to it is the sign-out button,
// which signs out. Likewise "pending review" and "decision notification"
// are NOT steps here: they aren't actions the owner takes, just states they
// wait in / get notified about (by email + the Dashboard's own status label,
// Dashboard.tsx's STATUS_KEYS) after submitting. A progress stepper only
// tracks steps the user actively completes.
//
// stepRestaurantSetup is a parent step covering TWO sub-steps (menu,
// seating/tables) — RegistrationWizard's internal step numbers 3 and 4 both
// map to this same parent segment (index 2 here). While either is current,
// that one segment's own bar splits into two smaller sub-bars (menu,
// seating) instead of a separate tab row in the content area below.
const STEP_KEYS: TranslationKey[] = [
  'stepRestaurantDetails',
  'stepKosher',
  'stepRestaurantSetup',
  'stepReview',
];
const SETUP_STEP_INDEX = 2;

interface Props {
  currentStep: number;
  onStepClick?: (step: number) => void;
  // Only meaningful while currentStep is on the "הגדרת המסעדה" parent (3) —
  // which of its two sub-steps is active, and how to switch between them.
  activeSubStep?: 'menu' | 'seating';
  onSubStepClick?: (subStep: 'menu' | 'seating') => void;
}

// Full-width segmented bar, Booking-partner-onboarding-inspired: a colored
// line per step with the label above it, a checkmark once done. Lives inside
// WizardShell's header area, spanning the page width, not a compact card.
export function WizardStepper({ currentStep, onStepClick, activeSubStep, onSubStepClick }: Props) {
  const { t } = useI18n();

  return (
    <div className="flex gap-2 sm:gap-4">
      {STEP_KEYS.map((key, index) => {
        const stepNumber = index + 1;
        const isCurrent = stepNumber === currentStep;
        const isDone = stepNumber < currentStep;
        // Free navigation: any step but the current one is clickable,
        // forward or back — not gated on completion. isDone still drives the
        // checkmark/accent styling below (a simple "have I passed this
        // point" indicator), just no longer gates whether it's clickable.
        const clickable = !isCurrent && !!onStepClick;

        if (index === SETUP_STEP_INDEX && isCurrent && activeSubStep) {
          // Booking-style: only the parent label shows text; the two
          // sub-bars underneath are plain colored ticks (title/aria-label
          // still carry the name for hover tooltips and screen readers,
          // just nothing painted on the tick itself).
          return (
            <div key={key} className="flex-1">
              <span className="mb-2 block truncate text-center text-xs font-medium text-ink sm:text-sm">{t(key)}</span>
              <div className="flex gap-1.5">
                <SubSegment
                  label={t('stepMenu')}
                  active={activeSubStep === 'menu'}
                  onClick={() => onSubStepClick?.('menu')}
                />
                <SubSegment
                  label={t('stepSeating')}
                  active={activeSubStep === 'seating'}
                  onClick={() => onSubStepClick?.('seating')}
                />
              </div>
            </div>
          );
        }

        return (
          <button
            key={key}
            type="button"
            disabled={!clickable}
            onClick={() => onStepClick?.(stepNumber)}
            className={`group flex-1 rounded-md px-2 py-1.5 text-center transition-colors ${
              clickable ? 'cursor-pointer hover:bg-surface-2' : 'cursor-default'
            }`}
          >
            <span
              className={`mb-2 flex items-center justify-center gap-1 truncate text-xs font-medium sm:text-sm ${
                isCurrent ? 'text-ink' : isDone ? 'text-accent' : `text-muted-foreground ${clickable ? 'group-hover:text-accent' : ''}`
              }`}
            >
              {isDone && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
              {t(key)}
            </span>
            <div
              className={`h-1.5 rounded-full ${
                isCurrent ? 'bg-accent' : isDone ? 'bg-accent/60' : 'bg-surface-2'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

// One half of the split "הגדרת המסעדה" segment — a plain colored tick, no
// caption of its own (the one parent label above covers both), matching
// Booking's own split-bar-under-one-title look. `label` still becomes the
// button's accessible name (aria-label, plus the shared bubble tooltip on
// hover) even though nothing is painted on the tick itself.
function SubSegment({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    // flex-1 goes on the tooltip's own wrapper (className prop), not just the
    // button — the wrapper is what actually sits in the parent flex row now,
    // and its own default shrink-to-fit sizing would otherwise stop the two
    // ticks from splitting the row width evenly.
    <Tooltip content={label} className="flex-1">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`h-1.5 w-full cursor-pointer rounded-full transition-colors ${active ? 'bg-accent' : 'bg-surface-2 hover:bg-accent/40'}`}
      />
    </Tooltip>
  );
}
