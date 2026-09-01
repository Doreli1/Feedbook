import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { FeedbookBrand } from '../components/FeedbookBrand';
import { LanguageToggle } from '../components/LanguageToggle';
import { useI18n } from '../lib/i18n';

export function MfaChallenge({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (code.trim().length !== 6) return;
    setBusy(true);
    setError(null);

    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    const factorId = factors?.totp[0]?.id;
    if (factorsError || !factorId) {
      setError(factorsError?.message ?? 'No two-factor method found on this account');
      setBusy(false);
      return;
    }

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setError(challengeError?.message ?? 'Could not start the verification challenge');
      setBusy(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }
    onDone();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md">
        <div dir="ltr" className="mb-3 flex items-start justify-between">
          <FeedbookBrand />
          <LanguageToggle />
        </div>
        <h1 className="mb-1 text-lg font-bold text-blue-900">{t('mfaChallengeTitle')}</h1>
        <p className="mb-4 text-sm text-gray-500">{t('mfaChallengeSubtitle')}</p>

        {error && (
          <div className="mb-3 rounded border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleVerify}>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            inputMode="numeric"
            className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-center text-lg tracking-widest"
          />
          <button
            type="submit"
            disabled={code.trim().length !== 6 || busy}
            className="mb-3 w-full rounded bg-blue-700 py-2 text-sm font-medium text-white disabled:bg-gray-300 disabled:text-gray-500"
          >
            {busy ? t('verifying') : t('verify')}
          </button>
        </form>

        {/* Escape route (Nielsen heuristic #3) — wrong account or lost
            authenticator app, either way the user needs a way back. */}
        <button
          onClick={() => void supabase.auth.signOut()}
          className="w-full rounded border border-gray-300 py-2 text-sm text-gray-500 hover:bg-gray-50"
        >
          {t('signOutAndStartOver')}
        </button>
      </div>
    </div>
  );
}
