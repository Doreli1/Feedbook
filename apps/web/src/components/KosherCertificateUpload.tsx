import { useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Restaurant } from '@feedbook/types';
import { Tooltip } from './Tooltip';
import { TrashIcon, UploadIcon } from './Icons';
import { useI18n } from '../lib/i18n';

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

  return (
    <>
      {isCertified ? (
        <div className="mb-3 flex items-center justify-between gap-2 rounded border border-success bg-success-soft px-3 py-3 text-sm text-success">
          {t('kosherCertified')}
          {/* Replacing a certificate previously required removing the old
              one first (the only action shown here was the trash button),
              which read as "no way to upload a new one" (reported gap,
              2026-10-18) — this re-uses the same upload endpoint, which
              already upserts and overwrites on a POST either way. */}
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip content={t('kosherReplace')}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadState === 'uploading'}
                aria-label={t('kosherReplace')}
                className="rounded p-1.5 text-success hover:bg-accent-soft hover:text-accent disabled:opacity-50"
              >
                <UploadIcon className="h-4 w-4" />
              </button>
            </Tooltip>
            <Tooltip content={t('kosherRemove')}>
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={uploadState === 'uploading'}
                aria-label={t('kosherRemove')}
                className="rounded p-1.5 text-success hover:bg-danger-soft hover:text-danger disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>
        </div>
      ) : (
        <div className="mb-3">
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">
            {t('kosherUploadLabel')}
            {required && <span className="text-danger"> *</span>}
          </label>
          {/* A real upload-field look (dashed dropzone + icon), not just a
              plain button — reported as reading like a leftover wizard
              yes/no answer rather than a file field once it moved into the
              Restaurant Details screen, where there's no question above it. */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadState === 'uploading'}
            className={`flex w-full flex-col items-center justify-center gap-1.5 rounded border-2 border-dashed py-6 text-sm transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent disabled:opacity-50 ${
              required ? 'border-danger text-danger' : 'border-border text-muted-foreground'
            }`}
          >
            <UploadIcon className="h-6 w-6" />
            <span className="font-medium">{uploadState === 'uploading' ? t('kosherUploading') : t('kosherYesUpload')}</span>
          </button>
          {required && <p className="mt-1 text-xs text-danger">{t('kosherRequiredHint')}</p>}
        </div>
      )}

      {/* Shared by both branches above — the certified branch's "replace"
          button also triggers this same hidden input. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        onChange={(e) => void handleFileChange(e)}
      />

      {error && (
        <div className="mb-3 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <p className="mb-4 text-xs text-muted-foreground">{t('kosherDisclaimer')}</p>
    </>
  );
}
