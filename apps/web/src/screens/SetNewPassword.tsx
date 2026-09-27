import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { FeedbookBrand } from '../components/FeedbookBrand';
import { LanguageToggle } from '../components/LanguageToggle';
import { EyeIcon, EyeOffIcon } from '../components/Icons';
import { useI18n } from '../lib/i18n';

// Shown after the user clicks a "forgot password" link from their email —
// useAuth() routes here on Supabase's PASSWORD_RECOVERY auth event.
export function SetNewPassword({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passwordsMatch = password.trim().length > 0 && password === confirm;
  const canSubmit = password.trim().length >= 6 && passwordsMatch && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onDone();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm p-8">
        <div dir="ltr" className="mb-3 flex items-start justify-between">
          <FeedbookBrand />
          <LanguageToggle />
        </div>
        <h1 className="mb-1 text-xl font-bold text-ink">{t('setNewPasswordTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('setNewPasswordSubtitle')}</p>

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('newPassword')}</label>
        <div className="relative mb-3">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-border px-3 py-2 pe-9 text-sm"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t('hidePassword') : t('showPassword')}
            className="absolute inset-y-0 end-0 flex w-9 items-center justify-center text-muted-foreground hover:text-ink"
          >
            {showPassword ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>

        <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('confirmPassword')}</label>
        <div className="relative mb-1">
          <input
            type={showConfirm ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded border border-border px-3 py-2 pe-9 text-sm"
          />
          <button
            type="button"
            onClick={() => setShowConfirm((v) => !v)}
            aria-label={showConfirm ? t('hidePassword') : t('showPassword')}
            className="absolute inset-y-0 end-0 flex w-9 items-center justify-center text-muted-foreground hover:text-ink"
          >
            {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </div>
        {confirm.length > 0 && !passwordsMatch && (
          <p className="mb-3 text-xs text-danger">{t('passwordsDontMatch')}</p>
        )}
        {(confirm.length === 0 || passwordsMatch) && <div className="mb-3" />}

        {error && (
          <div className="mb-3 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {busy ? t('saving') : t('updatePassword')}
        </button>
      </form>
    </div>
  );
}
