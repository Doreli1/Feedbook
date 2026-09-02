import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';
import { CheckIcon } from './Icons';

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
        const clickable = isDone && !!onStepClick;

        if (index === SETUP_STEP_INDEX && isCurrent && activeSubStep) {
          return (
            <div key={key} className="flex flex-1 gap-1.5">
              <SubSegment label={t('stepMenu')} active={activeSubStep === 'menu'} onClick={() => onSubStepClick?.('menu')} />
              <SubSegment
                label={t('stepSeating')}
                active={activeSubStep === 'seating'}
                onClick={() => onSubStepClick?.('seating')}
              />
            </div>
          );
        }

        return (
          <button
            key={key}
            type="button"
            disabled={!clickable}
            onClick={() => onStepClick?.(stepNumber)}
            className={`flex-1 text-center ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <span
              className={`mb-2 flex items-center justify-center gap-1 truncate text-xs font-medium sm:text-sm ${
                isCurrent ? 'text-ink' : isDone ? 'text-accent' : 'text-muted-foreground'
              }`}
            >
              {isDone && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
              {t(key)}
            </span>
            <div
              className={`h-1.5 rounded-full ${
                isCurrent ? 'bg-accent' : isDone ? 'bg-accent/60 hover:bg-accent' : 'bg-surface-2'
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}

// One half of the split "הגדרת המסעדה" segment — same visual language as a
// full segment (label above a bar), just narrower and always clickable
// (switching between menu/seating isn't a one-way completion gate the way
// the parent steps are, so there's no separate "done" state to show here).
function SubSegment({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex-1 text-center">
      <span className={`mb-2 block truncate text-xs font-medium sm:text-sm ${active ? 'text-ink' : 'text-muted-foreground hover:text-accent'}`}>
        {label}
      </span>
      <div className={`h-1.5 rounded-full ${active ? 'bg-accent' : 'bg-surface-2 hover:bg-accent/40'}`} />
    </button>
  );
}
