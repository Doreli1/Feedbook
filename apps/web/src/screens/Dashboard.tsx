import { supabase } from '../lib/supabase';

export function Dashboard({ email }: { email: string | undefined }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <p className="mb-2 text-sm text-gray-500">Signed in as</p>
      <p className="mb-6 text-lg font-semibold text-gray-900">{email}</p>
      <p className="mb-6 max-w-sm text-center text-sm text-gray-400">
        No restaurant is linked to this account yet — the self-registration wizard (AFD §3.7)
        hasn't been built here yet.
      </p>
      <button
        onClick={() => void supabase.auth.signOut()}
        className="rounded border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
      >
        Sign out
      </button>
    </div>
  );
}
