import { useState } from 'react';
import { useAuth } from './lib/useAuth';
import { useOwnRestaurants } from './lib/useOwnRestaurants';
import { useActiveRestaurantId } from './lib/useActiveRestaurantId';
import { useI18n } from './lib/i18n';
import { SignInUp } from './screens/SignInUp';
import { SetNewPassword } from './screens/SetNewPassword';
import { MfaEnroll } from './screens/MfaEnroll';
import { MfaChallenge } from './screens/MfaChallenge';
import { RegistrationWizard } from './screens/RegistrationWizard';
import { RestaurantDetailsForm } from './screens/RestaurantDetailsForm';
import { Dashboard } from './screens/Dashboard';

function LoadingScreen() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">{t('loading')}</p>
    </main>
  );
}

function AuthenticatedRouter({ session }: { session: NonNullable<ReturnType<typeof useAuth>['session']> }) {
  const { t } = useI18n();
  const { loading, restaurants, refresh } = useOwnRestaurants(session);
  const { activeId, setActiveId } = useActiveRestaurantId(restaurants);
  // Explicitly starting a second (or later) restaurant, via the header's
  // "+ add restaurant" button — distinct from having zero restaurants yet,
  // since in that case the active restaurant may already be a perfectly
  // normal approved one that Dashboard would otherwise show.
  const [startingNew, setStartingNew] = useState(false);
  // Editing an already-approved restaurant's details from the Dashboard —
  // distinct from the wizard's own step 1 (onboarding_status === 'draft'),
  // which is a different route below and doesn't need this flag at all.
  const [editingDetails, setEditingDetails] = useState(false);

  if (loading) return <LoadingScreen />;

  if (startingNew || restaurants.length === 0) {
    return (
      <RegistrationWizard
        session={session}
        restaurant={null}
        onRefresh={refresh}
        onCreated={(id) => {
          setActiveId(id);
          setStartingNew(false);
        }}
      />
    );
  }

  const activeRestaurant = restaurants.find((r) => r.id === activeId) ?? restaurants[0];
  if (!activeRestaurant) return <LoadingScreen />;

  if (activeRestaurant.onboarding_status === 'draft') {
    return <RegistrationWizard session={session} restaurant={activeRestaurant} onRefresh={refresh} />;
  }

  if (editingDetails) {
    return (
      <RestaurantDetailsForm
        session={session}
        restaurant={activeRestaurant}
        onNext={() => {
          setEditingDetails(false);
          void refresh();
        }}
        primaryLabel={t('saveAndReturnToDashboard')}
      />
    );
  }

  return (
    <Dashboard
      email={session.user.email}
      restaurant={activeRestaurant}
      restaurants={restaurants}
      onSwitchRestaurant={setActiveId}
      onAddRestaurant={() => setStartingNew(true)}
      onEditDetails={() => setEditingDetails(true)}
    />
  );
}

function App() {
  const { status, session, refresh, refreshRecovery } = useAuth();

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'signed-out') return <SignInUp />;
  // A recovery session with MFA enrolled must clear a challenge before
  // Supabase will allow the actual password change (see useAuth.ts).
  if (status === 'password-recovery-challenge') return <MfaChallenge onDone={refreshRecovery} />;
  if (status === 'password-recovery') return <SetNewPassword onDone={refresh} />;
  if (status === 'needs-enrollment') return <MfaEnroll onDone={refresh} />;
  if (status === 'needs-challenge') return <MfaChallenge onDone={refresh} />;
  if (!session) return <LoadingScreen />;
  return <AuthenticatedRouter session={session} />;
}

export default App;
