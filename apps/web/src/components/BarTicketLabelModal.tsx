import { CloseIcon } from './Icons';
import { useI18n } from '../lib/i18n';

interface Props {
  ticketNumber: number;
  displayName: string | null;
  onClose: () => void;
}

// A pickup label for one bar order — printed and stuck next to the drink so
// the diner (never staff transcribing a number by hand) confirms the match
// at handoff against their own app screen. Reuses the exact same "print
// only this element" CSS pattern as TableQrModal's QR sheet (.print-area in
// index.css), just with a different card inside it.
export function BarTicketLabelModal({ ticketNumber, displayName, onClose }: Props) {
  const { t } = useI18n();
  const formattedNumber = String(ticketNumber).padStart(4, '0');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:static print:bg-transparent print:p-0">
      <div className="print-area w-full max-w-xs rounded-lg bg-surface p-6 print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <h2 className="text-sm font-semibold text-ink">{t('barTicketLabelTitle')}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-surface-2" aria-label={t('cancel')}>
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="rounded-lg border-2 border-dashed border-border-strong p-6 text-center">
          <p className="text-eyebrow">{t('barTicketNumberLabel')}</p>
          <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-ink">{formattedNumber}</p>
          {displayName && <p className="mt-3 text-lg font-medium text-ink">{displayName}</p>}
        </div>

        <div className="mt-4 flex gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            {t('qrModalPrint')}
          </button>
          <button type="button" onClick={onClose} className="rounded border border-border px-4 py-2 text-sm text-ink hover:bg-surface-2">
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
