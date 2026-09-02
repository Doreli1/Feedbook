import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { FeedbookBrand } from '../components/FeedbookBrand';
import { LanguageToggle } from '../components/LanguageToggle';
import { useI18n } from '../lib/i18n';

export function MfaEnroll({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Guards against a second concurrent enrollment attempt — React 19
  // StrictMode double-invokes effects in development specifically to catch
  // exactly this: two overlapping startEnrollment() calls otherwise race on
  // creating/cleaning up the same TOTP factor.
  const enrollmentStarted = useRef(false);

  useEffect(() => {
    if (enrollmentStarted.current) return;
    enrollmentStarted.current = true;
    void startEnrollment();
  }, []);

  async function startEnrollment() {
    setError(null);

    // Supabase creates a factor the moment enroll() is called, before it's
    // verified. If a previous attempt was abandoned mid-way (refresh, back
    // button, closed tab), that unverified factor is left behind and a plain
    // enroll() collides with it ("A factor with the friendly name ... already
    // exists"). Check for and clear any stale unverified factor first, so the
    // common case (nothing stale) doesn't pay for a request we know will fail.
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const stale = (factors?.all ?? []).filter(
      (f) => f.factor_type === 'totp' && f.status === 'unverified',
    );
    for (const f of stale) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (enrollError) {
      setError(enrollError.message);
      return;
    }

    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
    setFactorId(data.id);
  }

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
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="card w-full max-w-sm p-8">
        <div dir="ltr" className="mb-3 flex items-start justify-between">
          <FeedbookBrand />
          <LanguageToggle />
        </div>
        <h1 className="mb-1 text-lg font-bold text-ink">{t('mfaEnrollTitle')}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{t('mfaEnrollSubtitle')}</p>

        {error && (
          <div className="mb-3 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {qr && <img src={qr} alt="Two-factor authentication QR code" className="mx-auto mb-3 h-40 w-40" />}
        {secret && (
          <p className="mb-4 break-all text-center text-xs text-muted-foreground">
            {t('manualEntryKey')}: {secret}
          </p>
        )}

        <form onSubmit={handleVerify}>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('sixDigitCode')}</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            inputMode="numeric"
            className="mb-4 w-full rounded border border-border px-3 py-2 text-center text-lg tracking-widest"
          />
          <button
            type="submit"
            disabled={code.trim().length !== 6 || busy || !factorId}
            className="mb-3 w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
          >
            {busy ? t('verifying') : t('verifyAndContinue')}
          </button>
        </form>

        {/* Escape route (Nielsen heuristic #3) — without this, a user stuck on
            an errored enrollment (wrong account, wants different credentials)
            has no way back to sign-in. */}
        <button
          onClick={() => void supabase.auth.signOut()}
          className="w-full rounded border border-border py-2 text-sm text-muted-foreground hover:bg-surface-2"
        >
          {t('signOutAndStartOver')}
        </button>
      </div>
    </div>
  );
}
