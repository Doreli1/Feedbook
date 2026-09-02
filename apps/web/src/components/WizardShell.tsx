import type { ReactNode } from 'react';
import { FeedbookBrand } from './FeedbookBrand';
import { LanguageToggle } from './LanguageToggle';
import { WizardStepper } from './WizardStepper';

interface Props {
  restaurantName?: string;
  restaurantAddress?: string;
  currentStep: number;
  onStepClick?: (step: number) => void;
  children: ReactNode;
}

// Full-page shell for the restaurant registration wizard, inspired by
// Booking's partner-onboarding layout (dark full-width header bar, a
// full-width step bar below it, wide breathing room for content) — but kept
// on Feedbook's own design tokens (--ink/--accent, Rubik/Heebo), not
// Booking's blue. Deliberately distinct from the compact centered-card shell
// still used by the plain auth screens (sign-in, MFA, password reset): this
// is the "restaurant registration" family (AFD §3.7), not the "login" one.
export function WizardShell({ restaurantName, restaurantAddress, currentStep, onStepClick, children }: Props) {
  return (
    <div className="min-h-screen bg-background">
      <header className="bg-ink px-4 py-3 sm:px-8">
        <div dir="ltr" className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <FeedbookBrand onDark />
          <div className="flex min-w-0 items-center gap-3">
            {restaurantName && (
              <div dir="auto" className="max-w-[220px] text-right">
                <p className="truncate text-sm font-medium text-white">{restaurantName}</p>
                {restaurantAddress && <p className="truncate text-xs text-white/70">{restaurantAddress}</p>}
              </div>
            )}
            <LanguageToggle onDark />
          </div>
        </div>
      </header>

      <div className="border-b border-border bg-surface px-4 py-4 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <WizardStepper currentStep={currentStep} onStepClick={onStepClick} />
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">{children}</main>
    </div>
  );
}
