import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

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

export function WizardStepper({ currentStep, onStepClick }: Props) {
  const { t } = useI18n();

  return (
    <div className="mb-4 flex gap-1">
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
            <div
              className={`mb-1 h-1 rounded-full ${
                isCurrent ? 'bg-accent' : isDone ? 'bg-accent-soft hover:bg-accent/60' : 'bg-surface-2'
              }`}
            />
            <span
              className={`block truncate text-[9px] leading-tight ${
                isCurrent ? 'font-semibold text-accent' : clickable ? 'text-accent/70' : 'text-muted-foreground'
              }`}
            >
              {t(key)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
