import { useAuth } from './lib/useAuth';
import { useOwnRestaurant } from './lib/useOwnRestaurant';
import { SignInUp } from './screens/SignInUp';
import { MfaEnroll } from './screens/MfaEnroll';
import { MfaChallenge } from './screens/MfaChallenge';
import { RestaurantDetailsForm } from './screens/RestaurantDetailsForm';
import { Dashboard } from './screens/Dashboard';

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-gray-400">Loading…</p>
    </main>
  );
}

function AuthenticatedRouter({ session }: { session: NonNullable<ReturnType<typeof useAuth>['session']> }) {
  const { loading, restaurant, refresh } = useOwnRestaurant(session);

  if (loading) return <LoadingScreen />;
  if (!restaurant) {
    return <RestaurantDetailsForm session={session} restaurant={null} onCreated={refresh} />;
  }
  if (restaurant.onboarding_status === 'draft') {
    return <RestaurantDetailsForm session={session} restaurant={restaurant} onCreated={refresh} />;
  }
  return <Dashboard email={session.user.email} restaurant={restaurant} />;
}

function App() {
  const { status, session, refresh } = useAuth();

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'signed-out') return <SignInUp />;
  if (status === 'needs-enrollment') return <MfaEnroll onDone={refresh} />;
  if (status === 'needs-challenge') return <MfaChallenge onDone={refresh} />;
  if (!session) return <LoadingScreen />;
  return <AuthenticatedRouter session={session} />;
}

export default App;
