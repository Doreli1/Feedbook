import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Restaurant, RestaurantTable } from '@feedbook/types';
import { WizardShell } from '../components/WizardShell';
import { TrashIcon, PencilIcon, QrCodeIcon } from '../components/Icons';
import { TableQrModal } from '../components/TableQrModal';
import { Tooltip } from '../components/Tooltip';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

interface WizardProps {
  session: Session;
  restaurant: Restaurant;
  tables: RestaurantTable[];
  onRefresh: () => void;
  onBack: () => void;
  onNext: () => void;
  // Free step-bar navigation — nothing to flush here first: every added
  // table already saved on its own explicit action (quick-add, +/-, edit
  // save), same as menu's categories/dishes.
  onStepClick?: (step: number) => void;
}

type TableTypeKey = 'couple' | 'family' | 'family_extended' | 'high' | 'bar';

// Presets cover the shapes owners actually asked for (couple/family/extended
// family/high-bar-table seating), each with a sensible default capacity
// that's still fully editable per batch.
//
// "bar" is different from every other preset (2026-09-15 redesign): a
// restaurant's bar is no longer N individually-QR'd 1-seat stools — one
// shared QR represents the whole bar counter, any number of diners can join
// it (no capacity cap exists anywhere in join-session/add-participants), and
// each diner's order carries its own short-lived pickup ticket number
// instead (see place_order_transaction's bar_ticket_number). So there is
// only ever ONE bar row per restaurant (`singleton`, also enforced in the DB
// via one_bar_table_per_restaurant), it always gets the fixed identifier
// "בר" instead of participating in the numeric table sequence
// (`fixedNumber`), and its "capacity" is purely informational (how many
// stools physically exist) rather than a seating cap.
const TABLE_TYPE_PRESETS: { key: TableTypeKey; labelKey: TranslationKey; defaultCapacity: number; singleton?: boolean; fixedNumber?: string }[] = [
  { key: 'couple', labelKey: 'tableTypeCouple', defaultCapacity: 2 },
  { key: 'family', labelKey: 'tableTypeFamily', defaultCapacity: 4 },
  { key: 'family_extended', labelKey: 'tableTypeFamilyExtended', defaultCapacity: 6 },
  { key: 'high', labelKey: 'tableTypeHigh', defaultCapacity: 4 },
  { key: 'bar', labelKey: 'tableTypeBar', defaultCapacity: 8, singleton: true, fixedNumber: 'בר' },
];

interface TableGroup {
  key: string;
  type: TableTypeKey;
  capacity: number;
  smokingAllowed: boolean;
  isOutdoor: boolean;
  ids: string[];
}

// Preset-typed tables (table_type set) are shown as one grouped row per
// (type, capacity, smoking, indoor/outdoor) combination instead of one row
// per physical table — the whole point of the bulk quick-add flow is never
// having to look at 15 near-identical rows. Manually/custom-added tables
// (table_type null) stay listed individually further down, unchanged from
// the previous one-by-one form.
function groupPresetTables(tables: RestaurantTable[]): TableGroup[] {
  const groups = new Map<string, TableGroup>();
  for (const t of tables) {
    if (!t.table_type) continue;
    const key = `${t.table_type}|${t.capacity}|${t.smoking_allowed}|${t.is_outdoor}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(t.id);
    } else {
      groups.set(key, {
        key,
        type: t.table_type as TableTypeKey,
        capacity: t.capacity,
        smokingAllowed: t.smoking_allowed,
        isOutdoor: t.is_outdoor,
        ids: [t.id],
      });
    }
  }
  return Array.from(groups.values());
}

// A guest-facing table number must read as a plain number ("1", "2"...) —
// never the table's type baked into the string ("משפחתי 1") — since it's
// what a diner sees on the QR sheet and inside the app itself (the account
// tab's "שולחן" field just prints table_number as-is). The type stays
// visible in the admin UI as the group's own heading, kept separate from
// the number. Numbering is one running sequence across the WHOLE
// restaurant (every table, any type, quick-added or custom), not per type,
// so two different presets can never generate the same number and collide
// with the table's own unique (restaurant_id, table_number) constraint.
function nextTableNumbers(existing: RestaurantTable[], quantity: number): string[] {
  const usedNumbers = existing.map((t) => Number(t.table_number)).filter((n) => Number.isInteger(n) && n >= 0);
  const start = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
  return Array.from({ length: quantity }, (_, i) => String(start + i));
}

interface ContentProps {
  restaurant: Restaurant;
  tables: RestaurantTable[];
  onRefresh: () => void;
  // Only the wizard step needs a trailing continue/skip button here — the
  // Dashboard's own "שולחנות" tab (added 2026-09-14, see memory: table
  // management used to exist only inside the once-only onboarding wizard,
  // with no way back into it for an already-approved, operating restaurant)
  // renders this content with no footer at all.
  footer?: ReactNode;
  // Lets the wizard wrapper keep its own "unsaved draft" warning working
  // now that the draft state (open panels/forms) lives inside this
  // component instead of the wizard screen itself.
  onDirtyChange?: (dirty: boolean) => void;
}

// The actual table-management UI — extracted 2026-09-14 so it can be reused
// both inside the onboarding wizard (TableManagerForm below) and as a normal
// Dashboard tab for a restaurant that's already approved and operating.
export function TableManagerContent({ restaurant, tables, onRefresh, footer, onDirtyChange }: ContentProps) {
  const { t } = useI18n();
  const [openPreset, setOpenPreset] = useState<TableTypeKey | null>(null);
  const [quickQuantity, setQuickQuantity] = useState('1');
  const [quickCapacity, setQuickCapacity] = useState('');
  const [quickSmoking, setQuickSmoking] = useState(false);
  const [quickOutdoor, setQuickOutdoor] = useState(false);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [editCapacity, setEditCapacity] = useState('');
  const [editSmoking, setEditSmoking] = useState(false);
  const [editOutdoor, setEditOutdoor] = useState(false);
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [addingCustomTable, setAddingCustomTable] = useState(false);
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrTables, setQrTables] = useState<RestaurantTable[] | null>(null);

  const groups = groupPresetTables(tables);
  const customTables = tables.filter((table) => !table.table_type);
  const openPresetDef = TABLE_TYPE_PRESETS.find((p) => p.key === openPreset);

  function openQuickAdd(preset: (typeof TABLE_TYPE_PRESETS)[number]) {
    if (openPreset === preset.key) {
      setOpenPreset(null);
      return;
    }
    setOpenPreset(preset.key);
    setQuickQuantity('1');
    setQuickCapacity(String(preset.defaultCapacity));
    setQuickSmoking(false);
    setQuickOutdoor(false);
  }

  async function handleQuickAdd() {
    const preset = TABLE_TYPE_PRESETS.find((p) => p.key === openPreset);
    if (!preset) return;
    // Defensive re-check: the chip itself is disabled once a singleton
    // exists, but a stale panel left open across a refresh (another tab
    // creating it, say) shouldn't be able to insert a second one.
    if (preset.singleton && tables.some((table) => table.table_type === preset.key)) return;
    const quantity = preset.singleton ? 1 : Number(quickQuantity);
    const capacity = Number(quickCapacity);
    if (!Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(capacity) || capacity < 1) return;

    setError(null);
    setBusyKey('quick-add');
    const numbers = preset.fixedNumber ? [preset.fixedNumber] : nextTableNumbers(tables, quantity);
    const rows = numbers.map((table_number) => ({
      restaurant_id: restaurant.id,
      table_number,
      capacity,
      smoking_allowed: quickSmoking,
      is_outdoor: quickOutdoor,
      table_type: preset.key,
      qr_code_token: crypto.randomUUID(),
    }));
    const { error: insertError } = await supabase.from('tables').insert(rows);
    setBusyKey(null);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setOpenPreset(null);
    onRefresh();
  }

  // Shared by the +/- stepper buttons (delta of exactly 1) and the typed
  // quantity input (any delta) — grows a group by inserting new numbered
  // tables, or shrinks it by deleting the most-recently-added ones first.
  async function handleSetGroupQuantity(group: TableGroup, targetQuantity: number) {
    const preset = TABLE_TYPE_PRESETS.find((p) => p.key === group.type);
    if (preset?.singleton) return; // singleton types (the bar) have no +/- control to begin with

    const current = group.ids.length;
    const delta = targetQuantity - current;
    if (!Number.isInteger(targetQuantity) || targetQuantity < 1 || delta === 0) return;

    setError(null);
    setBusyKey(group.key);

    if (delta > 0) {
      if (!preset) {
        setBusyKey(null);
        return;
      }
      const numbers = nextTableNumbers(tables, delta);
      const capacity = group.capacity;
      const rows = numbers.map((table_number) => ({
        restaurant_id: restaurant.id,
        table_number,
        capacity,
        smoking_allowed: group.smokingAllowed,
        is_outdoor: group.isOutdoor,
        table_type: group.type,
        qr_code_token: crypto.randomUUID(),
      }));
      const { error: insertError } = await supabase.from('tables').insert(rows);
      setBusyKey(null);
      if (insertError) {
        setError(insertError.message);
        return;
      }
    } else {
      const groupTables = tables
        .filter((table) => table.table_type === group.type && table.capacity === group.capacity && table.smoking_allowed === group.smokingAllowed && table.is_outdoor === group.isOutdoor)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const idsToRemove = groupTables.slice(0, -delta).map((table) => table.id);
      const { error: deleteError } = await supabase.from('tables').delete().in('id', idsToRemove);
      setBusyKey(null);
      if (deleteError) {
        setError(deleteError.message);
        return;
      }
    }
    onRefresh();
  }

  function openGroupEdit(group: TableGroup) {
    setEditingGroupKey(group.key);
    setEditCapacity(String(group.capacity));
    setEditSmoking(group.smokingAllowed);
    setEditOutdoor(group.isOutdoor);
  }

  async function handleGroupEditSave(group: TableGroup) {
    const capacity = Number(editCapacity);
    if (!Number.isInteger(capacity) || capacity < 1) return;
    setError(null);
    setBusyKey(group.key);
    const { error: updateError } = await supabase
      .from('tables')
      .update({ capacity, smoking_allowed: editSmoking, is_outdoor: editOutdoor })
      .in('id', group.ids);
    setBusyKey(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEditingGroupKey(null);
    onRefresh();
  }

  async function handleDeleteGroup(group: TableGroup) {
    setError(null);
    setBusyKey(group.key);
    const { error: deleteError } = await supabase.from('tables').delete().in('id', group.ids);
    setBusyKey(null);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setConfirmingDeleteKey(null);
    onRefresh();
  }

  async function handleDeleteCustomTable(tableId: string) {
    setError(null);
    const { error: deleteError } = await supabase.from('tables').delete().eq('id', tableId);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    onRefresh();
  }

  // A real, lossy draft: the quick-add preset panel or the custom-table form
  // has typed-but-unsubmitted values (quantity/capacity/checkboxes), or an
  // existing group/table is mid-edit — none of that autosaves.
  const isDirty = openPreset !== null || addingCustomTable || editingGroupKey !== null || editingTableId !== null;

  useEffect(() => {
    onDirtyChange?.(isDirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  return (
    <>
      <div className="card p-8">
        <h1 className="mb-1 text-xl font-bold text-ink">{t('tableSetupTitle')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('tableStepSubtitle')}</p>

        {error && (
          <div className="mb-4 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <p className="mb-2 text-xs text-muted-foreground">{t('tableQuickAddHint')}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {TABLE_TYPE_PRESETS.map((preset) => {
            const alreadyExists = !!preset.singleton && tables.some((table) => table.table_type === preset.key);
            return (
              <Tooltip key={preset.key} content={alreadyExists ? t('tableBarAlreadyExists') : null}>
                <button
                  type="button"
                  onClick={() => !alreadyExists && openQuickAdd(preset)}
                  disabled={alreadyExists}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    alreadyExists
                      ? 'cursor-not-allowed border-border text-muted-foreground opacity-60'
                      : openPreset === preset.key
                        ? 'border-accent bg-accent text-white'
                        : 'border-border-strong text-ink hover:border-accent hover:text-accent'
                  }`}
                >
                  {t(preset.labelKey)} · {preset.defaultCapacity} {t('tableGroupSeats')}
                </button>
              </Tooltip>
            );
          })}
        </div>

        {openPreset && (
          <div className="mb-6 rounded border border-accent bg-accent-soft p-3">
            <div className="mb-2 flex flex-wrap items-end gap-2">
              {!openPresetDef?.singleton && (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('tableQuantityLabel')}</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={quickQuantity}
                    onChange={(e) => setQuickQuantity(e.target.value)}
                    className="w-20 rounded border border-border px-2 py-1.5 text-sm"
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  {openPresetDef?.singleton ? t('tableBarSeatCountLabel') : t('tableCapacityLabel')}
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={quickCapacity}
                  onChange={(e) => setQuickCapacity(e.target.value)}
                  className="w-20 rounded border border-border px-2 py-1.5 text-sm"
                />
              </div>
              <label className="flex items-center gap-1.5 pb-1.5 text-sm text-ink">
                <input type="checkbox" checked={quickSmoking} onChange={(e) => setQuickSmoking(e.target.checked)} className="h-4 w-4 rounded border-border" />
                {t('tableSmokingCheckbox')}
              </label>
              <label className="flex items-center gap-1.5 pb-1.5 text-sm text-ink">
                <input type="checkbox" checked={quickOutdoor} onChange={(e) => setQuickOutdoor(e.target.checked)} className="h-4 w-4 rounded border-border" />
                {t('tableOutdoorCheckbox')}
              </label>
            </div>
            <button
              type="button"
              onClick={() => void handleQuickAdd()}
              disabled={busyKey === 'quick-add'}
              className="rounded bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {t('tableQuickAddSubmit')}
            </button>
          </div>
        )}

        {groups.length > 0 && (
          <div className="mb-6 space-y-2">
            {groups.map((group) => {
              const preset = TABLE_TYPE_PRESETS.find((p) => p.key === group.type);
              const label = preset ? t(preset.labelKey) : group.type;
              const isEditing = editingGroupKey === group.key;
              const isConfirmingDelete = confirmingDeleteKey === group.key;
              const isBusy = busyKey === group.key;

              if (isEditing) {
                const editPreset = TABLE_TYPE_PRESETS.find((p) => p.key === group.type);
                const editCapacityValue = Number(editCapacity);
                const editCapacityInvalid = !Number.isInteger(editCapacityValue) || editCapacityValue < 1;
                return (
                  <div key={group.key} className="rounded border border-border bg-surface p-3">
                    <div className="mb-2 flex flex-wrap items-end gap-2">
                      <p className="w-full text-sm font-medium text-ink">
                        {editPreset?.singleton ? label : `${group.ids.length} ${t('tableGroupCountLabel')} · ${t('tableTypeLabel')}: ${label}`}
                      </p>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">
                          {editPreset?.singleton ? t('tableBarSeatCountLabel') : t('tableCapacityLabel')}
                        </label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={editCapacity}
                          onChange={(e) => setEditCapacity(e.target.value)}
                          className="w-20 rounded border border-border px-2 py-1.5 text-sm"
                        />
                      </div>
                      <label className="flex items-center gap-1.5 pb-1.5 text-sm text-ink">
                        <input type="checkbox" checked={editSmoking} onChange={(e) => setEditSmoking(e.target.checked)} className="h-4 w-4 rounded border-border" />
                        {t('tableSmokingCheckbox')}
                      </label>
                      <label className="flex items-center gap-1.5 pb-1.5 text-sm text-ink">
                        <input type="checkbox" checked={editOutdoor} onChange={(e) => setEditOutdoor(e.target.checked)} className="h-4 w-4 rounded border-border" />
                        {t('tableOutdoorCheckbox')}
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleGroupEditSave(group)}
                        disabled={isBusy || editCapacityInvalid}
                        className="rounded bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                      >
                        {t('tableGroupEditSave')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingGroupKey(null)}
                        className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2"
                      >
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                );
              }

              if (isConfirmingDelete) {
                return (
                  <div key={group.key} className="flex items-center gap-3 rounded border border-danger bg-danger-soft p-3">
                    <p className="min-w-0 flex-1 text-sm text-danger">{t('tableGroupDeleteConfirm')}</p>
                    <button
                      type="button"
                      onClick={() => void handleDeleteGroup(group)}
                      disabled={isBusy}
                      className="shrink-0 rounded bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                      {t('tableGroupDeleteConfirmButton')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteKey(null)}
                      className="shrink-0 rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2"
                    >
                      {t('tableGroupDeleteCancel')}
                    </button>
                  </div>
                );
              }

              return (
                <div key={group.key} className="flex items-center gap-3 rounded bg-surface-2 p-3">
                  <div className="min-w-0 flex-1">
                    {/* "N × type" reads ambiguously as if the number were a
                        per-table multiplier (e.g. "כפול 6" sounding like 6
                        seats on a couple table) — spelled out as two
                        explicitly-labeled facts instead: how many tables,
                        and what type they are. Capacity (seats per table)
                        stays on its own line below, already labeled. */}
                    <p className="truncate text-sm font-medium text-ink">
                      {preset?.singleton ? label : `${group.ids.length} ${t('tableGroupCountLabel')} · ${t('tableTypeLabel')}: ${label}`}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {group.capacity} {preset?.singleton ? t('tableBarSeatCountLabel') : t('tableGroupSeats')} ·{' '}
                      {group.smokingAllowed ? t('tableSmokingYes') : t('tableSmokingNo')} ·{' '}
                      {group.isOutdoor ? t('tableOutdoor') : t('tableIndoor')}
                    </p>
                    {/* The row above only shows the group's shared traits
                        (count/capacity/smoking/indoor) — the actual per-table
                        numbers (e.g. "משפחתי 1", "משפחתי 2"...) that a real
                        printed QR sheet needs to be told apart by are only
                        otherwise visible inside the QR modal itself, which
                        isn't discoverable enough on its own. A singleton (the
                        bar) has nothing to disambiguate — its one row's fixed
                        "בר" identifier is already the whole header above. */}
                    {!preset?.singleton &&
                      (() => {
                        const tableNumbersList = tables
                          .filter((table) => group.ids.includes(table.id))
                          .map((table) => table.table_number)
                          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                          .join(', ');
                        return (
                          // The wrapper needs `block w-full min-w-0` (not
                          // Tooltip's own default shrink-to-fit inline-flex)
                          // so the truncate below still clips against this
                          // row's real available width instead of the
                          // text's own natural (untruncated) width.
                          <Tooltip content={tableNumbersList} className="block w-full min-w-0">
                            <p className="mt-0.5 truncate text-xs text-ink-muted">
                              {t('tableGroupNumbersLabel')}: {tableNumbersList}
                            </p>
                          </Tooltip>
                        );
                      })()}
                  </div>
                  {!preset?.singleton && (
                    <div className="flex shrink-0 items-center gap-1 rounded border border-border">
                      <Tooltip content={t('tableGroupDecrement')}>
                        <button
                          type="button"
                          onClick={() => void handleSetGroupQuantity(group, group.ids.length - 1)}
                          disabled={isBusy || group.ids.length <= 1}
                          aria-label={t('tableGroupDecrement')}
                          className="px-2 py-1 text-sm text-muted-foreground hover:bg-surface disabled:opacity-50"
                        >
                          −
                        </button>
                      </Tooltip>
                      <Tooltip content={t('tableGroupQuantityLabel')}>
                        <input
                          key={group.key + group.ids.length}
                          type="number"
                          min="1"
                          step="1"
                          defaultValue={group.ids.length}
                          disabled={isBusy}
                          aria-label={t('tableGroupQuantityLabel')}
                          onBlur={(e) => void handleSetGroupQuantity(group, Number(e.target.value))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          className="w-10 rounded border-0 bg-transparent text-center text-xs text-ink [appearance:textfield] disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </Tooltip>
                      <Tooltip content={t('tableGroupIncrement')}>
                        <button
                          type="button"
                          onClick={() => void handleSetGroupQuantity(group, group.ids.length + 1)}
                          disabled={isBusy}
                          aria-label={t('tableGroupIncrement')}
                          className="px-2 py-1 text-sm text-muted-foreground hover:bg-surface disabled:opacity-50"
                        >
                          +
                        </button>
                      </Tooltip>
                    </div>
                  )}
                  <Tooltip content={t('showQr')}>
                    <button
                      type="button"
                      onClick={() => setQrTables(tables.filter((table) => group.ids.includes(table.id)))}
                      aria-label={t('showQr')}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent-soft hover:text-accent"
                    >
                      <QrCodeIcon className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                  <Tooltip content={t('editTable')}>
                    <button
                      type="button"
                      onClick={() => openGroupEdit(group)}
                      aria-label={t('editTable')}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent-soft hover:text-accent"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                  <Tooltip content={t('deleteTable')}>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteKey(group.key)}
                      aria-label={t('deleteTable')}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}

        <div className="mb-6 border-t border-border pt-4">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">{t('tableCustomSectionTitle')}</p>
          <div className="mb-2 space-y-2">
            {customTables.map((table) =>
              editingTableId === table.id ? (
                <TableForm
                  key={table.id}
                  table={table}
                  restaurantId={restaurant.id}
                  onDone={() => {
                    setEditingTableId(null);
                    onRefresh();
                  }}
                  onCancel={() => setEditingTableId(null)}
                />
              ) : (
                <TableRow
                  key={table.id}
                  table={table}
                  onShowQr={() => setQrTables([table])}
                  onEdit={() => setEditingTableId(table.id)}
                  onDelete={() => void handleDeleteCustomTable(table.id)}
                />
              ),
            )}
          </div>

          {addingCustomTable ? (
            <TableForm
              restaurantId={restaurant.id}
              onDone={() => {
                setAddingCustomTable(false);
                onRefresh();
              }}
              onCancel={() => setAddingCustomTable(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAddingCustomTable(true)}
              className="w-full rounded border border-dashed border-border-strong py-1.5 text-xs text-accent hover:bg-accent-soft"
            >
              {t('addCustomTable')}
            </button>
          )}
        </div>

        {footer}
      </div>
      {qrTables && <TableQrModal tables={qrTables} onClose={() => setQrTables(null)} />}
    </>
  );
}

// Thin onboarding-wizard wrapper around TableManagerContent — unchanged
// external signature/behavior for RegistrationWizard's existing usage.
export function TableManagerForm({ session, restaurant, tables, onRefresh, onBack, onNext, onStepClick }: WizardProps) {
  const { t } = useI18n();
  const [isDirty, setIsDirty] = useState(false);

  return (
    <WizardShell
      restaurantName={restaurant.name}
      restaurantAddress={restaurant.address ?? undefined}
      userEmail={session.user.email}
      onSignOut={() => void supabase.auth.signOut()}
      currentStep={3}
      activeSubStep="seating"
      isDirty={isDirty}
      onSubStepClick={(subStep) => {
        if (subStep === 'menu') onBack();
      }}
      onStepClick={onStepClick}
    >
      <TableManagerContent
        restaurant={restaurant}
        tables={tables}
        onRefresh={onRefresh}
        onDirtyChange={setIsDirty}
        footer={
          <button type="button" onClick={onNext} className="w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover">
            {tables.length > 0 ? t('continue') : t('tableSkip')}
          </button>
        }
      />
    </WizardShell>
  );
}

function TableRow({ table, onShowQr, onEdit, onDelete }: { table: RestaurantTable; onShowQr: () => void; onEdit: () => void; onDelete: () => void }) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-3 rounded bg-surface-2 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {t('tableNumberLabel')} {table.table_number}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t('tableCapacityLabel')}: {table.capacity} · {table.smoking_allowed ? t('tableSmokingYes') : t('tableSmokingNo')} ·{' '}
          {table.is_outdoor ? t('tableOutdoor') : t('tableIndoor')}
        </p>
      </div>
      <Tooltip content={t('showQr')}>
        <button
          type="button"
          onClick={onShowQr}
          aria-label={t('showQr')}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent-soft hover:text-accent"
        >
          <QrCodeIcon className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <Tooltip content={t('editTable')}>
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('editTable')}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent-soft hover:text-accent"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <Tooltip content={t('deleteTable')}>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('deleteTable')}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

function TableForm({
  table,
  restaurantId,
  onDone,
  onCancel,
}: {
  table?: RestaurantTable;
  restaurantId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [tableNumber, setTableNumber] = useState(table?.table_number ?? '');
  const [capacity, setCapacity] = useState(table ? String(table.capacity) : '');
  const [smokingAllowed, setSmokingAllowed] = useState(table?.smoking_allowed ?? false);
  const [isOutdoor, setIsOutdoor] = useState(table?.is_outdoor ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capacityValue = Number(capacity);
  const canSave = tableNumber.trim() !== '' && capacity.trim() !== '' && Number.isInteger(capacityValue) && capacityValue > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    const { error: saveError } = table
      ? await supabase
          .from('tables')
          .update({
            table_number: tableNumber.trim(),
            capacity: capacityValue,
            smoking_allowed: smokingAllowed,
            is_outdoor: isOutdoor,
          })
          .eq('id', table.id)
      : await supabase.from('tables').insert({
          restaurant_id: restaurantId,
          table_number: tableNumber.trim(),
          capacity: capacityValue,
          smoking_allowed: smokingAllowed,
          is_outdoor: isOutdoor,
          qr_code_token: crypto.randomUUID(),
        });
    setSaving(false);
    if (saveError) {
      setError(saveError.message);
      return;
    }
    onDone();
  }

  return (
    <div className="mb-4 rounded border border-border bg-surface p-3">
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <div className="mb-2 flex gap-2">
        <input
          type="text"
          value={tableNumber}
          onChange={(e) => setTableNumber(e.target.value)}
          placeholder={t('tableNumberPlaceholder')}
          className="flex-1 rounded border border-border px-2 py-1.5 text-sm"
        />
        <input
          type="number"
          min="1"
          step="1"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          placeholder={t('tableCapacityPlaceholder')}
          className="w-24 rounded border border-border px-2 py-1.5 text-sm"
        />
      </div>
      <label className="mb-2 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={smokingAllowed}
          onChange={(e) => setSmokingAllowed(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        {t('tableSmokingCheckbox')}
      </label>
      <label className="mb-3 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={isOutdoor}
          onChange={(e) => setIsOutdoor(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        {t('tableOutdoorCheckbox')}
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="flex-1 rounded bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {saving ? t('saving') : t('saveTable')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2"
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  );
}
