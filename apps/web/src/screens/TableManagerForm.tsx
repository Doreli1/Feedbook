import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Restaurant, RestaurantTable } from '@feedbook/types';
import { WizardShell } from '../components/WizardShell';
import { TrashIcon, PencilIcon } from '../components/Icons';
import { useI18n } from '../lib/i18n';

interface Props {
  restaurant: Restaurant;
  tables: RestaurantTable[];
  onRefresh: () => void;
  onBack: () => void;
  onNext: () => void;
}

// PRD §5.1.3 / Backend Schema §4.1 "tables" — virtual map, seating capacity,
// and a smoking/non-smoking flag per table, plus a QR token generated here
// (no DB default — Backend Schema §4.1 "qr_code_token ... NOT NULL UNIQUE").
// Direct client CRUD, same as menu_categories/dishes: tables already has
// staff-scoped RLS (row_level_security migration), so no Edge Function is
// needed for straightforward single-table writes (API Spec §0.1). No
// minimum table count is defined anywhere in the PRD/AFD (unlike the menu's
// documented >=1-category/>=1-dish requirement), so this step is entirely
// optional/skippable.
export function TableManagerForm({ restaurant, tables, onRefresh, onBack, onNext }: Props) {
  const { t } = useI18n();
  const [addingTable, setAddingTable] = useState(false);
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(tableId: string) {
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
    >
      <div className="card p-8">
        <h1 className="mb-1 text-xl font-bold text-ink">{t('stepRestaurantSetup')}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{t('tableStepSubtitle')}</p>

        {error && (
          <div className="mb-4 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="mb-4 space-y-2">
          {tables.map((table) =>
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
                onDelete={() => void handleDelete(table.id)}
              />
            ),
          )}
        </div>

        {addingTable ? (
          <TableForm
            restaurantId={restaurant.id}
            onDone={() => {
              setAddingTable(false);
              onRefresh();
            }}
            onCancel={() => setAddingTable(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingTable(true)}
            className="mb-6 w-full rounded border border-dashed border-border-strong py-1.5 text-xs text-accent hover:bg-accent-soft"
          >
            {t('addTable')}
          </button>
        )}

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
          {t('tableCapacityLabel')}: {table.capacity} · {table.smoking_allowed ? t('tableSmokingYes') : t('tableSmokingNo')}
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
          .update({ table_number: tableNumber.trim(), capacity: capacityValue, smoking_allowed: smokingAllowed })
          .eq('id', table.id)
      : await supabase.from('tables').insert({
          restaurant_id: restaurantId,
          table_number: tableNumber.trim(),
          capacity: capacityValue,
          smoking_allowed: smokingAllowed,
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
      <label className="mb-3 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={smokingAllowed}
          onChange={(e) => setSmokingAllowed(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        {t('tableSmokingCheckbox')}
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
