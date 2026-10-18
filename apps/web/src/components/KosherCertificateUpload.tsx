import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Restaurant } from '@feedbook/types';
import { supabase } from '../lib/supabase';
import { Tooltip } from './Tooltip';
import { TrashIcon, CheckIcon, InfoIcon } from './Icons';
import { useI18n } from '../lib/i18n';

const EXPIRING_SOON_WINDOW_DAYS = 30;

// Whole calendar days until expiry, not a raw ms/86400000 division — that
// rounds based on the exact current time of day, so "expires tomorrow
// morning" could read as 0 or 1 depending on the minute you load the page.
// Comparing midnight-to-midnight UTC dates gives a stable day count that
// only changes once a day, matching what the displayed date itself means.
function daysUntil(dateStr: string): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const parts = dateStr.split('-').map(Number);
  const targetUtc = Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  return Math.round((targetUtc - todayUtc) / 86400000);
}

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

  const [expiryDate, setExpiryDate] = useState(restaurant.kosher_certificate_expires_at ?? '');
  const [expirySaved, setExpirySaved] = useState(false);

  // Re-sync only from a freshly-fetched restaurant (e.g. after a replace
  // upload elsewhere refreshes the parent) — same guard OverheadExpensesForm
  // uses, so this never clobbers a date the owner just typed.
  useEffect(() => {
    setExpiryDate(restaurant.kosher_certificate_expires_at ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant.kosher_certificate_expires_at]);

  async function handleExpiryChange(value: string) {
    setExpiryDate(value);
    setExpirySaved(false);
    const { error: saveError } = await supabase
      .from('restaurants')
      .update({ kosher_certificate_expires_at: value || null })
      .eq('id', restaurant.id);
    if (!saveError) {
      setExpirySaved(true);
      onUpdated();
    }
  }

  const daysToExpiry = expiryDate ? daysUntil(expiryDate) : null;
  const isExpired = daysToExpiry !== null && daysToExpiry < 0;
  const isExpiringSoon = daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= EXPIRING_SOON_WINDOW_DAYS;

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
      {/* justify-start puts the inner wrapper at the physical right under
          this app's RTL (confirmed against the Save/Back row earlier on
          this same screen, which needed justify-end for the opposite,
          physical-left placement — logical-property "end" is left in RTL,
          not right). The relative/absolute pair for the remove button
          lives on an inline-block inner wrapper, not this outer flex div —
          a flex div with no explicit width stretches to its parent's full
          width even with justify-start, so an absolutely-positioned child
          of *this* div would anchor to that full-width box's own corner,
          not the button's (reported: remove button stayed on the left
          while the tile itself correctly moved right). */}
      <div className="flex justify-start">
        <div className="relative inline-block">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadState === 'uploading'}
            aria-label={t('kosherYesUpload')}
            className={`group flex h-24 w-24 items-center justify-center overflow-hidden rounded border-2 border-dashed bg-surface transition-colors hover:border-accent disabled:opacity-50 ${
              required && !isCertified ? 'border-danger' : 'border-border'
            }`}
          >
            {uploadState === 'uploading' ? (
              <span className="text-xs text-muted-foreground">{t('kosherUploading')}</span>
            ) : isCertified && certificateUrl ? (
              isPdfUrl(certificateUrl) ? (
                <span className="text-sm font-semibold text-muted-foreground">PDF</span>
              ) : (
                <img src={certificateUrl} alt="" className="h-full w-full object-contain" />
              )
            ) : (
              // Plain "+" like the dish-photo add control elsewhere in this
              // app, rather than a cloud-upload icon + caption.
              <span className="text-3xl font-light leading-none text-muted-foreground group-hover:text-accent">+</span>
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
          <span>{t('kosherCertifiedLabel')}</span>
        </div>
      )}
      {required && !isCertified && <p className="mt-1 text-xs text-danger">{t('kosherRequiredHint')}</p>}

      {/* Real gap found 2026-10-18 (user request): nothing recorded when a
          certificate actually expires, so there was nothing to validate
          against or warn an owner about before it lapsed. Saved directly
          (a plain staff-scoped update, not the Edge Function — this is
          just metadata, not a file), separate from onUpdated's own
          upload/remove refresh, but still calling it so the parent's
          restaurant prop stays current. */}
      {isCertified && (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">{t('kosherExpiryLabel')}</label>
          <input
            type="date"
            value={expiryDate}
            onChange={(e) => void handleExpiryChange(e.target.value)}
            className={`w-40 rounded border px-2 py-1.5 text-sm ${isExpired ? 'border-danger' : isExpiringSoon ? 'border-warning' : 'border-border'}`}
          />
          {expirySaved && <span className="ms-2 text-xs text-success">{t('savedAsDraft')}</span>}
          {isExpired && (
            <p className="mt-1 flex items-start gap-1 text-xs font-medium text-danger">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t('kosherExpiredWarning')}</span>
            </p>
          )}
          {isExpiringSoon && !isExpired && (
            <p className="mt-1 flex items-start gap-1 text-xs font-medium text-warning">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t('kosherExpiringSoonWarning').replace('{days}', String(daysToExpiry))}</span>
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mt-2 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <p className="mb-4 mt-2 text-xs text-muted-foreground">{t('kosherDisclaimer')}</p>
    </>
  );
}
