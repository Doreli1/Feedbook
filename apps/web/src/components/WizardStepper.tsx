// AFD §3.7.1 — the 7 screens of the restaurant self-registration wizard.
const STEPS = [
  'הצטרפות',
  'פרטי מסעדה',
  'כשרות',
  'תפריט',
  'סקירה והסכם',
  'ממתין לאישור',
  'החלטה',
];

export function WizardStepper({ currentStep }: { currentStep: number }) {
  return (
    <div dir="rtl" className="mb-4 flex gap-1">
      {STEPS.map((label, index) => {
        const stepNumber = index + 1;
        const isCurrent = stepNumber === currentStep;
        const isDone = stepNumber < currentStep;
        return (
          <div key={label} className="flex-1 text-center">
            <div
              className={`mb-1 h-1 rounded-full ${
                isCurrent ? 'bg-blue-700' : isDone ? 'bg-blue-300' : 'bg-gray-200'
              }`}
            />
            <span
              className={`block truncate text-[9px] leading-tight ${
                isCurrent ? 'font-semibold text-blue-700' : 'text-gray-400'
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
