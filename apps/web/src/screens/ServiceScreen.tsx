import { useEffect, useMemo, useState } from 'react';
import type { KitchenWaiterCall, WaiterCallStatus } from '../lib/useWaiterCalls';
import { BellIcon, CheckIcon } from '../components/Icons';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

interface Props {
  calls: KitchenWaiterCall[];
  onResolve: (id: string) => Promise<void>;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

// Minutes under an hour, hours once it crosses that line (2026-10-11, user
// request) — a history card can be many hours old, and "לפני 245 דק'" reads
// far worse than "לפני 4 שעות".
function formatElapsed(createdAt: string, t: (key: TranslationKey) => string): string {
  const totalMinutes = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (totalMinutes < 60) {
    return t('kitchenElapsedMinutes').replace('{minutes}', String(totalMinutes));
  }
  const hours = Math.floor(totalMinutes / 60);
  return t('serviceElapsedHours').replace('{hours}', String(hours));
}

function statusLabelKey(status: WaiterCallStatus): TranslationKey {
  return status === 'resolved' ? 'serviceCallStatusResolved' : 'serviceCallStatusOpen';
}

function statusPillClasses(status: WaiterCallStatus): string {
  return status === 'resolved' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger';
}

function borderClasses(status: WaiterCallStatus): string {
  return status === 'resolved' ? 'border-l-success' : 'border-l-danger';
}

// Status icon circle (per the mockup) — bell = needs attention, check = done.
// Only two states now (2026-10-11: direct open → resolved per PRD §5.1.4 /
// API Specification §10.2 — see useWaiterCalls.ts's own comment for why the
// mockup's middle "בטיפול" state was dropped).
function StatusIcon({ status }: { status: WaiterCallStatus }) {
  if (status === 'resolved') {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success-soft">
        <CheckIcon className="h-5 w-5 text-success" />
      </div>
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft">
      <BellIcon className="h-5 w-5 text-danger" />
    </div>
  );
}

function CallCard({ call, onResolve }: { call: KitchenWaiterCall; onResolve: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <div
      className={`flex items-center gap-4 rounded border-l-4 bg-surface-2 px-4 py-3 ${borderClasses(call.status)} ${call.status === 'resolved' ? 'opacity-60' : ''}`}
    >
      <StatusIcon status={call.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-bold text-ink">
            {t('kitchenTableLabel')} {call.tableNumber}
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${statusPillClasses(call.status)}`}>{t(statusLabelKey(call.status))}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {formatElapsed(call.createdAt, t)}
          {call.reason ? ` · ${call.reason}` : ''}
        </div>
      </div>
      {call.status === 'open' && (
        <button
          type="button"
          onClick={() => onResolve(call.id)}
          className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover"
        >
          {t('serviceCallResolveAction')}
        </button>
      )}
    </div>
  );
}

// Local (not UTC) YYYY-MM-DD — matches what <input type="date"> reads/writes,
// so comparing a call's resolved-day against the picked filter day lines up
// with the restaurant's own clock, not a UTC day boundary that could put a
// late-evening resolution in "tomorrow".
function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayDateKey(): string {
  return localDateKey(new Date().toISOString());
}

// אי-התאמות ושירות (2026-10-11) — real "קריאות שירות" tab, wired to the
// real waiter_calls table via useWaiterCalls (lifted out of KitchenScreen,
// which only ever showed open calls inline; this screen is the single place
// all service-call notifications now live). Split into an always-visible
// open-calls section and a resolved-calls history (2026-10-11 follow-up,
// user request). The history view always shows today's resolved calls only
// — it resets fresh at the start of each new work day and never keeps a
// browsable past-day archive (2026-10-11 clarification: a date picker had
// nothing real to filter between), with a table-number filter and
// page-size pagination for days with many records. "אי-התאמות" stays an
// honest placeholder: the
// non_conformances table exists in the schema but nothing anywhere creates a
// row in it yet — building real management for it is a separate, unscoped
// feature, not part of this request.
export function ServiceScreen({ calls, onResolve }: Props) {
  const { t } = useI18n();
  const [subTab, setSubTab] = useState<'calls' | 'nc'>('calls');
  // resolve-waiter-call can 403 for a non-waiter staff member (role='waiter'
  // only, per PRD §5.1.4) — the one action here that can meaningfully fail
  // in a way the staff member needs to see, unlike KitchenScreen's status
  // advances, so unlike that screen this gets a minimal inline error.
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [tableFilter, setTableFilter] = useState('');
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(10);
  const [page, setPage] = useState(0);

  const openCalls = useMemo(() => calls.filter((c) => c.status === 'open'), [calls]);
  // Always today only, no way to pick another date (2026-10-11, user
  // clarification: history is per work day and isn't kept into the next one
  // — a date filter had nothing real to filter between).
  const historyForDate = useMemo(() => {
    const today = todayDateKey();
    const needle = tableFilter.trim().toLowerCase();
    return calls.filter(
      (c) =>
        c.status === 'resolved' &&
        c.resolvedAt &&
        localDateKey(c.resolvedAt) === today &&
        (needle === '' || c.tableNumber.toLowerCase().includes(needle)),
    );
  }, [calls, tableFilter]);
  const pageCount = Math.max(1, Math.ceil(historyForDate.length / pageSize));
  const pagedHistory = historyForDate.slice(page * pageSize, page * pageSize + pageSize);

  // Changing the filter or page size restarts at page 1 — a stale page
  // index from the previous filter would otherwise silently show an empty
  // page past the new result count.
  useEffect(() => {
    setPage(0);
  }, [tableFilter, pageSize]);

  async function handleResolve(id: string) {
    setResolveError(null);
    try {
      await onResolve(id);
    } catch (err) {
      setResolveError(t('serviceCallResolveForbidden'));
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <h1 className="mb-1 text-lg font-bold text-ink">{t('serviceTitle')}</h1>
        <p className="mb-4 text-sm text-muted-foreground">{t('serviceSubtitle')}</p>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setSubTab('calls')}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              subTab === 'calls' ? 'border-accent bg-accent text-white' : 'border-border bg-white text-ink hover:bg-surface-2'
            }`}
          >
            {t('serviceCallsSubTab')} ({openCalls.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('nc')}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              subTab === 'nc' ? 'border-accent bg-accent text-white' : 'border-border bg-white text-ink hover:bg-surface-2'
            }`}
          >
            {t('nonConformancesSubTab')}
          </button>
        </div>

        {subTab === 'nc' && (
          <div className="rounded bg-surface-2 px-4 py-8 text-center">
            <p className="mb-1 text-sm font-semibold text-ink">{t('nonConformancesComingSoonTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('nonConformancesComingSoonMessage')}</p>
          </div>
        )}
      </div>

      {/* Open calls and history as two separate cards (2026-10-11, user
          request) — the screen's own background (not another white surface)
          now shows between them, and each card's own bottom border serves as
          the "separator line" at its bottom, reinforced with border-b-2
          border-border-strong just inside each card's own content for extra
          visual weight. */}
      {subTab === 'calls' && (
        <>
          {resolveError && <p className="rounded bg-danger-soft px-3 py-2 text-xs font-medium text-danger">{resolveError}</p>}

          <div className="card border-b-2 border-border-strong p-6">
            <h2 className="mb-4 text-xl font-bold text-ink">{t('serviceOpenCallsHeading')}</h2>
            {openCalls.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('kitchenWaiterCallsEmpty')}</p>
            ) : (
              <div className="space-y-2">
                {openCalls.map((call) => (
                  <CallCard key={call.id} call={call} onResolve={handleResolve} />
                ))}
              </div>
            )}
          </div>

          <div className="card border-b-2 border-border-strong p-6">
            <h2 className="text-xl font-bold text-ink">{t('serviceHistoryHeading')}</h2>
            <div className="mb-4 mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('serviceHistoryTableFilterLabel')}</span>
                <input
                  type="text"
                  value={tableFilter}
                  onChange={(e) => setTableFilter(e.target.value)}
                  placeholder={t('serviceHistoryTableFilterPlaceholder')}
                  className="rounded border border-border px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('serviceHistoryPageSizeLabel')}</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
                  className="rounded border border-border px-2 py-1.5 text-sm text-ink"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {historyForDate.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('serviceHistoryEmpty')}</p>
            ) : (
              <>
                <div className="space-y-2">
                  {pagedHistory.map((call) => (
                    <CallCard key={call.id} call={call} onResolve={handleResolve} />
                  ))}
                </div>
                {pageCount > 1 && (
                  <div className="mt-3 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      className="rounded border border-border px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
                    >
                      {t('serviceHistoryPrevPage')}
                    </button>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {t('serviceHistoryPageLabel')
                        .replace('{page}', String(page + 1))
                        .replace('{total}', String(pageCount))}
                    </span>
                    <button
                      type="button"
                      disabled={page >= pageCount - 1}
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                      className="rounded border border-border px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-40"
                    >
                      {t('serviceHistoryNextPage')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
