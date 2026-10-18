import { useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Restaurant } from '@feedbook/types';
import { Tooltip } from './Tooltip';
import { TrashIcon, UploadIcon, CheckIcon } from './Icons';
import { useI18n } from '../lib/i18n';

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().endsWith('.pdf');
}

type UploadState = 'idle' | 'uploading' | 'error';

interface Props {
  session: Session;
  restaurant: Restaurant;
  // Parent refetches the restaurant (same convention as the logo/field
  // save elsewhere in this app) so isCertified/kosher_certificate_url, both
  // read straight off the restaurant prop here, pick up the change.
  onUpdated: () => void;
  // Set by RestaurantDetailsForm.tsx when its own "כשרות" toggle is on but
  // no certificate has been uploaded yet — marks the field as mandatory
  // (asterisk + hint) without blocking the rest of the screen's autosave,
  // which has no natural hook for a hard cross-field gate.
  required?: boolean;
}

// Extracted from the registration wizard's own KosherStatusForm.tsx
// (2026-10-18) so the same upload/remove flow (API Spec §5.1-5.2) can also
// live inside the post-approval Restaurant Details screen, not just the
// one-time onboarding step — a restaurant can newly become certified, or
// need to replace an expired certificate, long after onboarding.
export function KosherCertificateUpload({ session, restaurant, onUpdated, required = false }: Props) {
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

  const certificateUrl = restaurant.kosher_certificate_url;

  return (
    <>
      <label className="mb-1 block text-xs font-semibold text-muted-foreground">
        {t('kosherUploadLabel')}
        {required && <span className="text-danger"> *</span>}
      </label>
      {/* Same shape as the dish-photo upload tiles (MenuManager.tsx) — the
          file itself shown inside the tile, not a separate thumbnail next
          to a text button (2026-10-18, per explicit request). Clicking the
          tile always opens the file picker, whether replacing an existing
          certificate or uploading the first one; the corner remove button
          only appears once there's something to remove. */}
      <div className="relative">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadState === 'uploading'}
          className={`flex h-32 w-full items-center justify-center overflow-hidden rounded border-2 border-dashed transition-colors hover:border-accent disabled:opacity-50 ${
            required && !isCertified ? 'border-danger' : 'border-border'
          }`}
        >
          {uploadState === 'uploading' ? (
            <span className="text-sm text-muted-foreground">{t('kosherUploading')}</span>
          ) : isCertified && certificateUrl ? (
            isPdfUrl(certificateUrl) ? (
              <span className="text-sm font-semibold text-muted-foreground">PDF</span>
            ) : (
              <img src={certificateUrl} alt="" className="h-full w-full object-contain" />
            )
          ) : (
            <span className="flex flex-col items-center gap-1.5 text-sm text-muted-foreground hover:text-accent">
              <UploadIcon className="h-6 w-6" />
              <span className="font-medium">{t('kosherYesUpload')}</span>
            </span>
          )}
        </button>
        {isCertified && (
          <Tooltip content={t('kosherRemove')}>
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={uploadState === 'uploading'}
              aria-label={t('kosherRemove')}
              className="absolute -end-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white hover:opacity-90 disabled:opacity-50"
            >
              <TrashIcon className="h-3 w-3" />
            </button>
          </Tooltip>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        onChange={(e) => void handleFileChange(e)}
      />

      {/* Below the tile, decoupled from it — confirms the restaurant's
          actual kosher status rather than being the only way to tell. */}
      {isCertified && (
        <div className="mt-2 flex items-center gap-1.5 text-sm font-medium text-success">
          <CheckIcon className="h-4 w-4" />
          <span>{t('kosherCertified')}</span>
        </div>
      )}
      {required && !isCertified && <p className="mt-1 text-xs text-danger">{t('kosherRequiredHint')}</p>}

      {error && (
        <div className="mt-2 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <p className="mb-4 mt-2 text-xs text-muted-foreground">{t('kosherDisclaimer')}</p>
    </>
  );
}
