import { useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { WizardShell } from '../components/WizardShell';
import { Tooltip } from '../components/Tooltip';
import { TrashIcon } from '../components/Icons';
import { useI18n } from '../lib/i18n';
import type { Restaurant } from '@feedbook/types';

type UploadState = 'idle' | 'uploading' | 'error';

interface Props {
  session: Session;
  restaurant: Restaurant;
  onNext: () => void;
  onUpdated: () => void;
  // Free step-bar navigation — nothing to flush here first: upload/remove
  // both save immediately on click, there's no debounced draft in flight.
  onStepClick?: (step: number) => void;
}

// AFD §3.7.1 screen 3: "סטטוס כשרות (אופציונלי)" — self-declaration + upload,
// skippable. API Spec §5.1-5.2.
export function KosherStatusForm({ session, restaurant, onNext, onUpdated, onStepClick }: Props) {
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
    <WizardShell
      restaurantName={restaurant.name}
      restaurantAddress={restaurant.address ?? undefined}
      userEmail={session.user.email}
      onSignOut={() => void supabase.auth.signOut()}
      currentStep={2}
      onStepClick={onStepClick}
    >
      <div className="card p-8">
        <h1 className="mb-1 text-xl font-bold text-ink">{t('kosherStepTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('kosherStepSubtitle')}</p>

        <p className="mb-3 text-sm font-medium text-ink">{t('kosherQuestion')}</p>

        {isCertified ? (
          <div className="mb-4 flex items-center justify-between gap-2 rounded border border-success bg-success-soft px-3 py-3 text-sm text-success">
            {t('kosherCertified')}
            <Tooltip content={t('kosherRemove')}>
              <button
                onClick={() => void handleRemove()}
                disabled={uploadState === 'uploading'}
                aria-label={t('kosherRemove')}
                className="shrink-0 rounded p-1.5 text-success hover:bg-danger-soft hover:text-danger disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="mb-4">
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('kosherUploadLabel')}</label>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadState === 'uploading'}
              className="w-full rounded border border-border py-2 text-sm text-accent hover:bg-accent-soft disabled:text-muted-foreground"
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
          <div className="mb-3 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <p className="mb-6 text-xs text-muted-foreground">{t('kosherDisclaimer')}</p>

        <button onClick={onNext} className="w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover">
          {isCertified ? t('continue') : t('kosherSkip')}
        </button>
      </div>
    </WizardShell>
  );
}
