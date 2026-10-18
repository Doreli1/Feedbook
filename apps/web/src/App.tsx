import { useEffect, useState } from 'react';
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

// A plain string marker on the browser history entry, not a real route —
// this app has no router/URL scheme (see Dashboard.tsx's own tab state for
// the same convention), so the entry's pathname never changes, only this
// state payload. Lets the physical back/forward buttons walk in and out of
// the Restaurant Details edit screen like any other browser navigation,
// instead of leaving the app's own state out of sync with the browser's
// history position (reported gap: forward-after-back did nothing, since the
// old popstate listener only existed while that screen happened to be
// mounted).
const EDITING_DETAILS_HISTORY_MARKER = 'restaurant-details-edit';

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

  // Single always-on listener (not scoped to while the edit screen happens
  // to be mounted) — the source of truth for editingDetails becomes "are we
  // physically sitting on the pushed history entry", so back AND forward
  // both just fall out of this one sync instead of needing separate
  // handling. refresh is a stable useCallback (keyed on the session's own
  // user id — see useOwnRestaurants.ts), safe to depend on directly.
  useEffect(() => {
    function onPopState(event: PopStateEvent) {
      const isEditing = (event.state as { feedbookScreen?: string } | null)?.feedbookScreen === EDITING_DETAILS_HISTORY_MARKER;
      setEditingDetails(isEditing);
      if (!isEditing) void refresh();
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [refresh]);

  function openEditingDetails() {
    window.history.pushState({ feedbookScreen: EDITING_DETAILS_HISTORY_MARKER }, '');
    setEditingDetails(true);
  }

  // Both the primary save button and the plain "back" button call this —
  // going through the same history.back() → popstate → setEditingDetails
  // pipeline physically pressing Back does, instead of flipping the boolean
  // directly. Keeps the browser's own history position and the app's state
  // from ever drifting apart (that drift was the forward-button bug).
  function closeEditingDetails() {
    window.history.back();
  }

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
        // Only a real "add another restaurant" click (not the zero-restaurant
        // first-ever signup, which has no dashboard to exit to) gets a way
        // out via the logo.
        onExit={startingNew && restaurants.length > 0 ? () => setStartingNew(false) : undefined}
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
        onSaved={() => void refresh()}
        onNext={closeEditingDetails}
        primaryLabel={t('saveAndReturnToDashboard')}
        onExit={closeEditingDetails}
      />
    );
  }

  return (
    <Dashboard
      session={session}
      restaurant={activeRestaurant}
      restaurants={restaurants}
      onSwitchRestaurant={setActiveId}
      onAddRestaurant={() => setStartingNew(true)}
      onEditDetails={openEditingDetails}
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
