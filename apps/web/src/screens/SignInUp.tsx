import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { FeedbookBrand } from '../components/FeedbookBrand';
import { LanguageToggle } from '../components/LanguageToggle';
import { useI18n } from '../lib/i18n';

type Mode = 'sign-in' | 'sign-up' | 'forgot-password';

export function SignInUp() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.trim().length > 0 && password.trim().length >= 6 && !busy;
  const canSendReset = email.trim().length > 0 && !busy;

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
        setInfo(t('accountCreatedInfo'));
      }
    }
    setBusy(false);
  }

  async function handleSendResetLink(e: FormEvent) {
    e.preventDefault();
    if (!canSendReset) return;
    setBusy(true);
    setError(null);
    setInfo(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setInfo(t('resetLinkSentInfo'));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form
        onSubmit={mode === 'forgot-password' ? handleSendResetLink : handleSubmit}
        className="card w-full max-w-sm p-8"
      >
        <div dir="ltr" className="mb-4 flex items-start justify-between">
          <FeedbookBrand />
          <LanguageToggle />
        </div>
        <h1 className="mb-6 text-xl font-bold text-ink">{t('restaurantManagement')}</h1>

        {mode !== 'forgot-password' && (
          <div className="mb-4 flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                setMode('sign-in');
                setError(null);
                setInfo(null);
              }}
              className={`rounded px-3 py-1 ${mode === 'sign-in' ? 'bg-accent-soft font-semibold text-accent' : 'text-muted-foreground'}`}
            >
              {t('tabSignIn')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('sign-up');
                setError(null);
                setInfo(null);
              }}
              className={`rounded px-3 py-1 ${mode === 'sign-up' ? 'bg-accent-soft font-semibold text-accent' : 'text-muted-foreground'}`}
            >
              {t('tabSignUp')}
            </button>
          </div>
        )}

        {mode === 'forgot-password' && (
          <>
            <h2 className="mb-1 text-base font-semibold text-ink">{t('forgotPasswordTitle')}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{t('forgotPasswordSubtitle')}</p>
          </>
        )}

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('email')}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-3 w-full rounded border border-border px-3 py-2 text-sm"
        />

        {mode !== 'forgot-password' && (
          <>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('password')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-1 w-full rounded border border-border px-3 py-2 text-sm"
            />
          </>
        )}

        {mode === 'sign-in' && (
          <div className="mb-4 text-end">
            <button
              type="button"
              onClick={() => {
                setMode('forgot-password');
                setError(null);
                setInfo(null);
              }}
              className="text-xs text-accent hover:underline"
            >
              {t('forgotPassword')}
            </button>
          </div>
        )}
        {mode === 'sign-up' && <div className="mb-4" />}

        {error && (
          <div className="mb-3 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        {info && (
          <div className="mb-3 rounded border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-success">
            {info}
          </div>
        )}

        {mode === 'forgot-password' ? (
          <>
            <button
              type="submit"
              disabled={!canSendReset}
              className="mb-3 w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
            >
              {busy ? t('sendingReset') : t('sendResetLink')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('sign-in');
                setError(null);
                setInfo(null);
              }}
              className="w-full rounded border border-border py-2 text-sm text-muted-foreground hover:bg-surface-2"
            >
              {t('backToSignIn')}
            </button>
          </>
        ) : (
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
          >
            {busy ? t('signInBusy') : mode === 'sign-in' ? t('tabSignIn') : t('tabSignUp')}
          </button>
        )}
      </form>
    </div>
  );
}
