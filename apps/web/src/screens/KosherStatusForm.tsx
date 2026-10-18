import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { WizardShell } from '../components/WizardShell';
import { KosherCertificateUpload } from '../components/KosherCertificateUpload';
import { useI18n } from '../lib/i18n';
import type { Restaurant } from '@feedbook/types';

interface Props {
  session: Session;
  restaurant: Restaurant;
  onNext: () => void;
  onUpdated: () => void;
  // Free step-bar navigation — nothing to flush here first: upload/remove
  // both save immediately on click, there's no debounced draft in flight.
  onStepClick?: (step: number) => void;
  onExit?: () => void;
}

// AFD §3.7.1 screen 3: "סטטוס כשרות (אופציונלי)" — self-declaration + upload,
// skippable. API Spec §5.1-5.2. The actual upload/remove flow lives in
// KosherCertificateUpload.tsx, shared with the post-approval Restaurant
// Details screen's own "כשרות" section.
export function KosherStatusForm({ session, restaurant, onNext, onUpdated, onStepClick, onExit }: Props) {
  const { t } = useI18n();
  const isCertified = restaurant.kosher_status === 'certified';

  return (
    <WizardShell
      restaurantName={restaurant.name}
      restaurantAddress={restaurant.address ?? undefined}
      userEmail={session.user.email}
      onSignOut={() => void supabase.auth.signOut()}
      currentStep={2}
      onStepClick={onStepClick}
      onExit={onExit}
    >
      <div className="card p-8">
        <h1 className="mb-1 text-xl font-bold text-ink">{t('kosherStepTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('kosherStepSubtitle')}</p>

        <p className="mb-3 text-sm font-medium text-ink">{t('kosherQuestion')}</p>

        <KosherCertificateUpload session={session} restaurant={restaurant} onUpdated={onUpdated} />

        <button onClick={onNext} className="w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover">
          {isCertified ? t('continue') : t('kosherSkip')}
        </button>
      </div>
    </WizardShell>
  );
}
