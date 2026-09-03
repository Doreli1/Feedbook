import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Restaurant, RestaurantTable } from '@feedbook/types';
import { WizardShell } from '../components/WizardShell';
import { TrashIcon, PencilIcon } from '../components/Icons';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

interface Props {
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
// family/high-bar-table/bar-stool seating), each with a sensible default
// capacity that's still fully editable per batch. Bar seating defaults to 1
// and is capped there — a bar "table" here is one stool, physically seating
// exactly one person, so nothing lets it drift to an unrealistic capacity
// (guards the exact mistake of e.g. typing 40 for a single bar seat).
const TABLE_TYPE_PRESETS: { key: TableTypeKey; labelKey: TranslationKey; defaultCapacity: number; maxCapacity?: number }[] = [
  { key: 'couple', labelKey: 'tableTypeCouple', defaultCapacity: 2 },
  { key: 'family', labelKey: 'tableTypeFamily', defaultCapacity: 4 },
  { key: 'family_extended', labelKey: 'tableTypeFamilyExtended', defaultCapacity: 6 },
  { key: 'high', labelKey: 'tableTypeHigh', defaultCapacity: 4 },
  { key: 'bar', labelKey: 'tableTypeBar', defaultCapacity: 1, maxCapacity: 1 },
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

// Continues numbering from whatever's already there for this type (e.g.
// adding 2 more "משפחתי" tables to an existing 5 yields "משפחתי 6"/"משפחתי
// 7"), so repeated quick-adds of the same type never collide with the
// table's own unique (restaurant_id, table_number) constraint.
function nextTableNumbers(existing: RestaurantTable[], type: TableTypeKey, label: string, quantity: number): string[] {
  const prefix = `${label} `;
  const usedNumbers = existing
    .filter((t) => t.table_type === type && t.table_number.startsWith(prefix))
    .map((t) => Number(t.table_number.slice(prefix.length)))
    .filter((n) => Number.isFinite(n));
  const start = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
  return Array.from({ length: quantity }, (_, i) => `${prefix}${start + i}`);
}

export function TableManagerForm({ restaurant, tables, onRefresh, onBack, onNext, onStepClick }: Props) {
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
    const quantity = Number(quickQuantity);
    // Locked types (bar seating) ignore whatever's in the capacity field —
    // the input for it isn't even rendered, see the JSX below.
    const capacity = preset?.maxCapacity ?? Number(quickCapacity);
    if (!preset || !Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(capacity) || capacity < 1) return;

    setError(null);
    setBusyKey('quick-add');
    const label = t(preset.labelKey);
    const numbers = nextTableNumbers(tables, preset.key, label, quantity);
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
    const current = group.ids.length;
    const delta = targetQuantity - current;
    if (!Number.isInteger(targetQuantity) || targetQuantity < 1 || delta === 0) return;

    setError(null);
    setBusyKey(group.key);

    if (delta > 0) {
      const preset = TABLE_TYPE_PRESETS.find((p) => p.key === group.type);
      if (!preset) {
        setBusyKey(null);
        return;
      }
      const numbers = nextTableNumbers(tables, group.type, t(preset.labelKey), delta);
      // Clamp to the type's own cap rather than trusting group.capacity —
      // a group whose capacity predates this cap (or slipped in before it
      // existed) must not have that bad value copied onto every new seat
      // added here; it re-locks to what the type actually allows.
      const capacity = preset.maxCapacity ?? group.capacity;
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
    const preset = TABLE_TYPE_PRESETS.find((p) => p.key === group.type);
    setEditingGroupKey(group.key);
    // A locked type forces the correct value here regardless of what's
    // actually stored — this is also how a pre-existing group saved before
    // this cap existed (e.g. capacity 40 on a bar group) gets silently
    // corrected back to 1 the moment it's opened for editing.
    setEditCapacity(String(preset?.maxCapacity ?? group.capacity));
    setEditSmoking(group.smokingAllowed);
    setEditOutdoor(group.isOutdoor);
  }

  async function handleGroupEditSave(group: TableGroup) {
    const capacity = Number(editCapacity);
    const preset = TABLE_TYPE_PRESETS.find((p) => p.key === group.type);
    if (!Number.isInteger(capacity) || capacity < 1) return;
    if (preset?.maxCapacity && capacity > preset.maxCapacity) return;
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

  return (
    <WizardShell
      restaurantName={restaurant.name}
      restaurantAddress={restaurant.address ?? undefined}
      currentStep={3}
      activeSubStep="seating"
      onSubStepClick={(subStep) => {
        if (subStep === 'menu') onBack();
      }}
      onStepClick={onStepClick}
    >
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
          {TABLE_TYPE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => openQuickAdd(preset)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                openPreset === preset.key
                  ? 'border-accent bg-accent text-white'
                  : 'border-border-strong text-ink hover:border-accent hover:text-accent'
              }`}
            >
              {t(preset.labelKey)} · {preset.defaultCapacity} {t('tableGroupSeats')}
            </button>
          ))}
        </div>

        {openPreset && (
          <div className="mb-6 rounded border border-accent bg-accent-soft p-3">
            <div className="mb-2 flex flex-wrap items-end gap-2">
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
              {openPresetDef?.maxCapacity ? (
                // Bar seating: one stool = one seat, not editable — prevents
                // the exact mistake of typing an oversized capacity for it.
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('tableCapacityLabel')}</label>
                  <p className="px-2 py-1.5 text-sm text-ink">{openPresetDef.maxCapacity} {t('tableGroupSeats')}</p>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">{t('tableCapacityLabel')}</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={quickCapacity}
                    onChange={(e) => setQuickCapacity(e.target.value)}
                    className="w-20 rounded border border-border px-2 py-1.5 text-sm"
                  />
                </div>
              )}
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
                const editCapacityExceedsMax = !!editPreset?.maxCapacity && editCapacityValue > editPreset.maxCapacity;
                const editCapacityInvalid = !Number.isInteger(editCapacityValue) || editCapacityValue < 1 || editCapacityExceedsMax;
                return (
                  <div key={group.key} className="rounded border border-border bg-surface p-3">
                    <div className="mb-2 flex flex-wrap items-end gap-2">
                      <p className="w-full text-sm font-medium text-ink">
                        {group.ids.length} × {label}
                      </p>
                      {editPreset?.maxCapacity ? (
                        // Same lock as quick-add: a bar seat's capacity isn't
                        // a choice, so there's nothing to type here — this
                        // group's own quantity field (on the row below, once
                        // editing closes) is where "how many bar seats" goes.
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">{t('tableCapacityLabel')}</label>
                          <p className="px-2 py-1.5 text-sm text-ink">{editPreset.maxCapacity} {t('tableGroupSeats')}</p>
                        </div>
                      ) : (
                        <div>
                          <label className="mb-1 block text-xs text-muted-foreground">{t('tableCapacityLabel')}</label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={editCapacity}
                            onChange={(e) => setEditCapacity(e.target.value)}
                            className="w-20 rounded border border-border px-2 py-1.5 text-sm"
                          />
                        </div>
                      )}
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
                    <p className="truncate text-sm font-medium text-ink">
                      {group.ids.length} × {label}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {group.capacity} {t('tableGroupSeats')} · {group.smokingAllowed ? t('tableSmokingYes') : t('tableSmokingNo')} ·{' '}
                      {group.isOutdoor ? t('tableOutdoor') : t('tableIndoor')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 rounded border border-border">
                    <button
                      type="button"
                      onClick={() => void handleSetGroupQuantity(group, group.ids.length - 1)}
                      disabled={isBusy || group.ids.length <= 1}
                      title={t('tableGroupDecrement')}
                      aria-label={t('tableGroupDecrement')}
                      className="px-2 py-1 text-sm text-muted-foreground hover:bg-surface disabled:opacity-50"
                    >
                      −
                    </button>
                    <input
                      key={group.key + group.ids.length}
                      type="number"
                      min="1"
                      step="1"
                      defaultValue={group.ids.length}
                      disabled={isBusy}
                      title={t('tableGroupQuantityLabel')}
                      aria-label={t('tableGroupQuantityLabel')}
                      onBlur={(e) => void handleSetGroupQuantity(group, Number(e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      className="w-10 rounded border-0 bg-transparent text-center text-xs text-ink [appearance:textfield] disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSetGroupQuantity(group, group.ids.length + 1)}
                      disabled={isBusy}
                      title={t('tableGroupIncrement')}
                      aria-label={t('tableGroupIncrement')}
                      className="px-2 py-1 text-sm text-muted-foreground hover:bg-surface disabled:opacity-50"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => openGroupEdit(group)}
                    title={t('editTable')}
                    aria-label={t('editTable')}
                    className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent-soft hover:text-accent"
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteKey(group.key)}
                    title={t('deleteTable')}
                    aria-label={t('deleteTable')}
                    className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
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

        <button
          type="button"
          onClick={onNext}
          className="w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          {tables.length > 0 ? t('continue') : t('tableSkip')}
        </button>
      </div>
    </WizardShell>
  );
}

function TableRow({ table, onEdit, onDelete }: { table: RestaurantTable; onEdit: () => void; onDelete: () => void }) {
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
      <button
        type="button"
        onClick={onEdit}
        title={t('editTable')}
        aria-label={t('editTable')}
        className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent-soft hover:text-accent"
      >
        <PencilIcon className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        title={t('deleteTable')}
        aria-label={t('deleteTable')}
        className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-danger-soft hover:text-danger"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
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
