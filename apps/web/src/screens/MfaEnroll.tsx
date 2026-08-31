import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export function MfaEnroll({ onDone }: { onDone: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (enrollError) {
        setError(enrollError.message);
        return;
      }
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFactorId(data.id);
    })();
  }, []);

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (!factorId || code.trim().length !== 6) return;
    setBusy(true);
    setError(null);

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
        <h1 className="mb-1 text-lg font-bold text-blue-900">Set up two-factor authentication</h1>
        <p className="mb-4 text-sm text-gray-500">
          Required for every staff account. Scan this code with an authenticator app (Google
          Authenticator, Authy, etc.) — sign-in isn't possible without it.
        </p>

        {error && (
          <div className="mb-3 rounded border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {qr && <img src={qr} alt="Two-factor authentication QR code" className="mx-auto mb-3 h-40 w-40" />}
        {secret && (
          <p className="mb-4 break-all text-center text-xs text-gray-400">Manual entry key: {secret}</p>
        )}

        <form onSubmit={handleVerify}>
          <label className="mb-1 block text-xs font-semibold text-gray-500">6-digit code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            inputMode="numeric"
            className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-center text-lg tracking-widest"
          />
          <button
            type="submit"
            disabled={code.trim().length !== 6 || busy || !factorId}
            className="w-full rounded bg-blue-700 py-2 text-sm font-medium text-white disabled:bg-gray-300 disabled:text-gray-500"
          >
            {busy ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
