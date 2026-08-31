import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export function SignInUp() {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.trim().length >= 6 && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setInfo(null);

    if (mode === 'sign-in') {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) setError(signInError.message);
    } else {
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) {
        setError(signUpError.message);
      } else {
        setInfo('Account created. If email confirmation is required, check your inbox before signing in.');
      }
    }
    setBusy(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-1 text-xl font-bold text-blue-900">Feedbook</h1>
        <p className="mb-6 text-sm text-gray-500">Restaurant Management · Web Admin</p>

        <div className="mb-4 flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => setMode('sign-in')}
            className={`rounded px-3 py-1 ${mode === 'sign-in' ? 'bg-blue-100 font-semibold text-blue-800' : 'text-gray-500'}`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode('sign-up')}
            className={`rounded px-3 py-1 ${mode === 'sign-up' ? 'bg-blue-100 font-semibold text-blue-800' : 'text-gray-500'}`}
          >
            Create account
          </button>
        </div>

        <label className="mb-1 block text-xs font-semibold text-gray-500">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-xs font-semibold text-gray-500">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />

        {error && (
          <div className="mb-3 rounded border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-3 rounded border-l-4 border-green-600 bg-green-50 px-3 py-2 text-sm text-green-700">
            {info}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded bg-blue-700 py-2 text-sm font-medium text-white disabled:bg-gray-300 disabled:text-gray-500"
        >
          {busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
