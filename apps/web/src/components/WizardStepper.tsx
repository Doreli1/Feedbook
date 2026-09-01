import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

// AFD §3.7.1 — the restaurant self-registration wizard's numbered steps.
// Screen 1 of the AFD table (הצטרפות/sign-in) is deliberately NOT part of
// this numbered sequence: it's a precondition, not a step you revisit or
// track progress through — the only way back to it is the sign-out button,
// which signs out.
const STEP_KEYS: TranslationKey[] = [
  'stepRestaurantDetails',
  'stepKosher',
  'stepMenu',
  'stepReview',
  'stepPendingReview',
  'stepDecision',
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
                isCurrent ? 'bg-blue-700' : isDone ? 'bg-blue-300 hover:bg-blue-500' : 'bg-gray-200'
              }`}
            />
            <span
              className={`block truncate text-[9px] leading-tight ${
                isCurrent ? 'font-semibold text-blue-700' : clickable ? 'text-blue-500' : 'text-gray-400'
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
