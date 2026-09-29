import { useState, type ReactNode } from 'react';
import { TopBar } from './TopBar';
import { WizardStepper } from './WizardStepper';
import { ConfirmDialog } from './ConfirmDialog';
import { useI18n } from '../lib/i18n';

interface Props {
  restaurantName?: string;
  restaurantAddress?: string;
  // Shown in the header's account menu in place of restaurantName until a
  // restaurant exists to name it (step 1, before the first save) — mirrors
  // the Dashboard's own TopBar, which always has a restaurant name to show by
  // the time it renders at all.
  userEmail?: string;
  onSignOut: () => void;
  currentStep: number;
  onStepClick?: (step: number) => void;
  // Passed straight through to WizardStepper — see its own doc comment.
  activeSubStep?: 'menu' | 'seating';
  onSubStepClick?: (subStep: 'menu' | 'seating') => void;
  // Omits the step bar entirely — for reusing this same header+content shell
  // outside the actual wizard sequence (editing an already-approved
  // restaurant's details from the Dashboard), where showing "step 1 of 4"
  // would misleadingly imply the rest of the wizard still needs doing.
  hideStepper?: boolean;
  // Only screens with a real, genuinely-lossy draft (typed but not yet
  // submitted — e.g. a half-filled "add dish" form) should ever pass true.
  // A screen that already saves everything before navigating (like
  // RestaurantDetailsForm's autosave flush) must NOT set this — warning
  // about data loss that can't actually happen would just be a false alarm.
  isDirty?: boolean;
  // Lets the Feedbook logo act as a "back to dashboard" exit — only passed
  // when the caller has a real dashboard to return to (see App.tsx). Guarded
  // by the same unsaved-changes dialog as in-wizard step navigation.
  onExit?: () => void;
  children: ReactNode;
}

// Full-page shell for the restaurant registration wizard, inspired by
// Booking's partner-onboarding layout (dark full-width header bar, a
// full-width step bar below it, wide breathing room for content) — but kept
// on Feedbook's own design tokens (--ink/--accent, Rubik/Heebo), not
// Booking's blue. Deliberately distinct from the compact centered-card shell
// still used by the plain auth screens (sign-in, MFA, password reset): this
// is the "restaurant registration" family (AFD §3.7), not the "login" one.
export function WizardShell({
  restaurantName,
  restaurantAddress,
  userEmail,
  onSignOut,
  currentStep,
  onStepClick,
  activeSubStep,
  onSubStepClick,
  hideStepper = false,
  isDirty = false,
  onExit,
  children,
}: Props) {
  const { t } = useI18n();
  // Stashes the navigation that was about to happen so the dialog's own
  // "leave" button can run it later — a step number, a sub-step name, or the
  // exit action, never more than one at a time, so a single pending-action
  // slot covers any of the three sources.
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);

  function guardedStepClick(step: number) {
    if (isDirty) {
      setPendingNav(() => () => onStepClick?.(step));
    } else {
      onStepClick?.(step);
    }
  }

  function guardedSubStepClick(subStep: 'menu' | 'seating') {
    if (isDirty) {
      setPendingNav(() => () => onSubStepClick?.(subStep));
    } else {
      onSubStepClick?.(subStep);
    }
  }

  function guardedExit() {
    if (isDirty) {
      setPendingNav(() => () => onExit?.());
    } else {
      onExit?.();
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Brand and business-context+language sit at the bar's true edges —
          full-bleed, same placement as Booking's own header — not
          constrained to the step bar/content's narrower centered width. */}
      <TopBar
        restaurantName={restaurantName ?? userEmail}
        restaurantAddress={restaurantAddress}
        onSignOut={onSignOut}
        onLogoClick={onExit && guardedExit}
      />

      {!hideStepper && (
        <div className="border-b border-border bg-surface px-4 py-4 sm:px-8">
          <div className="mx-auto max-w-3xl">
            <WizardStepper
              currentStep={currentStep}
              onStepClick={onStepClick && guardedStepClick}
              activeSubStep={activeSubStep}
              onSubStepClick={onSubStepClick && guardedSubStepClick}
            />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">{children}</main>

      <ConfirmDialog
        open={pendingNav !== null}
        title={t('unsavedChangesTitle')}
        description={t('unsavedChangesDescription')}
        confirmLabel={t('leaveStepConfirm')}
        cancelLabel={t('continue')}
        onConfirm={() => {
          pendingNav?.();
          setPendingNav(null);
        }}
        onCancel={() => setPendingNav(null)}
      />
    </div>
  );
}
