import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { RestaurantTable } from '@feedbook/types';
import { useI18n } from '../lib/i18n';
import { Tooltip } from './Tooltip';

// Closes the real gap found 2026-09-14: tables.qr_code_token was generated
// and stored on every table (TableManagerForm.tsx's own insert calls), but
// nothing ever rendered it as a scannable image — a restaurant manager had
// no way to actually get a QR code onto a physical table. Same deep-link
// format scan-qr.tsx already parses (`feedbook://table/<token>`), so a code
// generated here scans correctly in the real app immediately.
export function tableDeepLink(token: string): string {
  return `feedbook://table/${token}`;
}

interface TableQrEntry {
  tableNumber: string;
  qrDataUrl: string;
}

async function buildEntries(tables: RestaurantTable[]): Promise<TableQrEntry[]> {
  return Promise.all(
    tables.map(async (table) => ({
      tableNumber: table.table_number,
      qrDataUrl: await QRCode.toDataURL(tableDeepLink(table.qr_code_token), { width: 240, margin: 1, color: { dark: '#1B2430', light: '#FFFFFF' } }),
    })),
  );
}

export function TableQrModal({ tables, onClose }: { tables: RestaurantTable[]; onClose: () => void }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<TableQrEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void buildEntries(tables).then((result) => {
      if (!cancelled) setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [tables]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:static print:bg-transparent print:p-0">
      <div className="print-area max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface p-6 print:max-h-none print:w-auto print:max-w-none print:overflow-visible print:rounded-none print:p-0 print:shadow-none">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <div>
            <h2 className="text-lg font-bold text-ink">{t('qrModalTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('qrModalSubtitle')}</p>
          </div>
          <Tooltip content={t('cancel')}>
            <button type="button" onClick={onClose} className="rounded p-1.5 text-muted-foreground hover:bg-surface-2" aria-label={t('cancel')}>
              ✕
            </button>
          </Tooltip>
        </div>

        {entries === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground print:hidden">{t('loading')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 print:grid-cols-2 print:gap-6">
            {entries.map((entry) => (
              <div key={entry.tableNumber} className="flex flex-col items-center gap-2 rounded border border-border p-3 print:break-inside-avoid">
                <img src={entry.qrDataUrl} alt={entry.tableNumber} className="h-auto w-full max-w-[180px]" />
                <p className="text-sm font-semibold text-ink">{entry.tableNumber}</p>
              </div>
            ))}
          </div>
        )}

        {entries !== null && (
          <div className="mt-5 flex gap-2 print:hidden">
            <button type="button" onClick={() => window.print()} className="flex-1 rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover">
              {t('qrModalPrint')}
            </button>
            <button type="button" onClick={onClose} className="rounded border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-surface-2">
              {t('cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
