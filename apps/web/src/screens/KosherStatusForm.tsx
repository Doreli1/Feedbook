import { useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { WizardStepper } from '../components/WizardStepper';
import { AppHeader } from '../components/AppHeader';
import { useI18n } from '../lib/i18n';
import type { Restaurant } from '@feedbook/types';

type UploadState = 'idle' | 'uploading' | 'error';

interface Props {
  session: Session;
  restaurant: Restaurant;
  onNext: () => void;
  onUpdated: () => void;
}

// AFD §3.7.1 screen 3: "סטטוס כשרות (אופציונלי)" — self-declaration + upload,
// skippable. API Spec §5.1-5.2.
export function KosherStatusForm({ session, restaurant, onNext, onUpdated }: Props) {
  const { t } = useI18n();
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isCertified = restaurant.kosher_status === 'certified';

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const ALLOWED = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!ALLOWED.includes(file.type)) {
      setError(t('kosherUnsupportedType'));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError(t('kosherFileTooLarge'));
      return;
    }

    setUploadState('uploading');
    setError(null);

    const form = new FormData();
    form.append('file', file);
    form.append('restaurant_id', restaurant.id);

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-kashrut-certificate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Upload failed');
      setUploadState('error');
      return;
    }

    setUploadState('idle');
    onUpdated();
  }

  async function handleRemove() {
    setUploadState('uploading');
    setError(null);

    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-kashrut-certificate`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ restaurant_id: restaurant.id }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Remove failed');
      setUploadState('error');
      return;
    }

    setUploadState('idle');
    onUpdated();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <AppHeader restaurantName={restaurant.name} />
        <WizardStepper currentStep={2} />
        <h1 className="mb-1 text-xl font-bold text-blue-900">{t('kosherStepTitle')}</h1>
        <p className="mb-6 text-sm text-gray-500">{t('kosherStepSubtitle')}</p>

        <p className="mb-3 text-sm font-medium text-gray-800">{t('kosherQuestion')}</p>

        {isCertified ? (
          <div className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-3 text-sm text-green-700">
            {t('kosherCertified')}
            <button
              onClick={() => void handleRemove()}
              disabled={uploadState === 'uploading'}
              className="mt-2 block text-xs text-red-600 hover:underline"
            >
              {t('kosherRemove')}
            </button>
          </div>
        ) : (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-semibold text-gray-500">{t('kosherUploadLabel')}</label>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadState === 'uploading'}
              className="w-full rounded border border-gray-300 py-2 text-sm text-blue-700 hover:bg-blue-50 disabled:text-gray-400"
            >
              {uploadState === 'uploading' ? t('kosherUploading') : t('kosherYesUpload')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="hidden"
              onChange={(e) => void handleFileChange(e)}
            />
          </div>
        )}

        {error && (
          <div className="mb-3 rounded border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <p className="mb-6 text-xs text-gray-400">{t('kosherDisclaimer')}</p>

        <button
          onClick={onNext}
          className="mb-3 w-full rounded bg-blue-700 py-2 text-sm font-medium text-white"
        >
          {isCertified ? t('continue') : t('kosherSkip')}
        </button>

        <button
          onClick={() => void supabase.auth.signOut()}
          className="w-full rounded border border-red-300 py-2 text-sm text-red-600 hover:bg-red-50"
        >
          {t('signOut')}
        </button>
      </div>
    </div>
  );
}
