import { useI18n } from '../lib/i18n';

interface Props {
  active: 'menu' | 'seating';
  onMenu: () => void;
  onSeating: () => void;
}

// "הגדרת המסעדה" is one parent step in the main WizardStepper (see
// WizardStepper's STEP_KEYS — stepRestaurantSetup), covering two sub-steps
// (menu, seating) shown here as tabs. Freely switchable both ways — the
// gating (a minimum before advancing to the next parent step) lives in each
// sub-step's own "continue" button, not in this tab switch.
export function SubStepTabs({ active, onMenu, onSeating }: Props) {
  const { t } = useI18n();

  return (
    <div className="mb-6 flex gap-4 border-b border-border">
      <button
        type="button"
        onClick={onMenu}
        className={`-mb-px border-b-2 pb-2 text-sm font-medium ${
          active === 'menu' ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-ink'
        }`}
      >
        {t('stepMenu')}
      </button>
      <button
        type="button"
        onClick={onSeating}
        className={`-mb-px border-b-2 pb-2 text-sm font-medium ${
          active === 'seating' ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-ink'
        }`}
      >
        {t('stepSeating')}
      </button>
    </div>
  );
}
