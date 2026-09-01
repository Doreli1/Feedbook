import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { FeedbookBrand } from '../components/FeedbookBrand';
import { LanguageToggle } from '../components/LanguageToggle';
import { useI18n } from '../lib/i18n';

// Shown after the user clicks a "forgot password" link from their email —
// useAuth() routes here on Supabase's PASSWORD_RECOVERY auth event.
export function SetNewPassword({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-md">
        <div dir="ltr" className="mb-3 flex items-start justify-between">
          <FeedbookBrand />
          <LanguageToggle />
        </div>
        <h1 className="mb-1 text-xl font-bold text-blue-900">{t('setNewPasswordTitle')}</h1>
        <p className="mb-6 text-sm text-gray-500">{t('setNewPasswordSubtitle')}</p>

        <label className="mb-1 block text-xs font-semibold text-gray-500">{t('newPassword')}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />

        <label className="mb-1 block text-xs font-semibold text-gray-500">{t('confirmPassword')}</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mb-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        {confirm.length > 0 && !passwordsMatch && (
          <p className="mb-3 text-xs text-red-600">{t('passwordsDontMatch')}</p>
        )}
        {(confirm.length === 0 || passwordsMatch) && <div className="mb-3" />}

        {error && (
          <div className="mb-3 rounded border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full rounded bg-blue-700 py-2 text-sm font-medium text-white disabled:bg-gray-300 disabled:text-gray-500"
        >
          {busy ? t('saving') : t('updatePassword')}
        </button>
      </form>
    </div>
  );
}
