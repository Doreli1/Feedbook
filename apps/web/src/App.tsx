import { useAuth } from './lib/useAuth';
import { SignInUp } from './screens/SignInUp';
import { MfaEnroll } from './screens/MfaEnroll';
import { MfaChallenge } from './screens/MfaChallenge';
import { Dashboard } from './screens/Dashboard';

function App() {
  const { status, session, refresh } = useAuth();

  if (status === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </main>
    );
  }
  if (status === 'signed-out') return <SignInUp />;
  if (status === 'needs-enrollment') return <MfaEnroll onDone={refresh} />;
  if (status === 'needs-challenge') return <MfaChallenge onDone={refresh} />;
  return <Dashboard email={session?.user.email} />;
}

export default App;
