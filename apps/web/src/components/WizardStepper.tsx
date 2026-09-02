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
const STEP_KEYS: TranslationKey[] = [
  'stepRestaurantDetails',
  'stepKosher',
  'stepMenu',
  'stepReview',
];

interface Props {
  currentStep: number;
  onStepClick?: (step: number) => void;
}

// Full-width segmented bar, Booking-partner-onboarding-inspired: a colored
// line per step with the label above it, a checkmark once done. Lives inside
// WizardShell's header area, spanning the page width, not a compact card.
export function WizardStepper({ currentStep, onStepClick }: Props) {
  const { t } = useI18n();

  return (
    <div className="flex gap-2 sm:gap-4">
      {STEP_KEYS.map((key, index) => {
        const stepNumber = index + 1;
        const isCurrent = stepNumber === currentStep;
        const isDone = stepNumber < currentStep;
        const clickable = isDone && !!onStepClick;

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
