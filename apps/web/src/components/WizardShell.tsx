import type { ReactNode } from 'react';
import { FeedbookBrand } from './FeedbookBrand';
import { LanguageToggle } from './LanguageToggle';
import { WizardStepper } from './WizardStepper';

interface Props {
  restaurantName?: string;
  restaurantAddress?: string;
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
  currentStep,
  onStepClick,
  activeSubStep,
  onSubStepClick,
  hideStepper = false,
  children,
}: Props) {
  return (
    <div className="min-h-screen bg-background">
      {/* Brand and business-context+language sit at the bar's true edges —
          full-bleed, same placement as Booking's own header — not
          constrained to the step bar/content's narrower centered width. */}
      <header dir="ltr" className="flex items-center justify-between gap-4 bg-ink px-6 py-3 sm:px-12">
        <FeedbookBrand onDark />
        <div className="flex min-w-0 items-center gap-1.5">
          {restaurantName && (
            <div dir="auto" className="max-w-[220px] text-right">
              <p className="truncate text-sm font-medium text-white">{restaurantName}</p>
              {restaurantAddress && <p className="truncate text-xs text-white/70">{restaurantAddress}</p>}
            </div>
          )}
          <LanguageToggle onDark />
        </div>
      </header>

      {!hideStepper && (
        <div className="border-b border-border bg-surface px-4 py-4 sm:px-8">
          <div className="mx-auto max-w-3xl">
            <WizardStepper
              currentStep={currentStep}
              onStepClick={onStepClick}
              activeSubStep={activeSubStep}
              onSubStepClick={onSubStepClick}
            />
          </div>
        </div>
      )}

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">{children}</main>
    </div>
  );
}
