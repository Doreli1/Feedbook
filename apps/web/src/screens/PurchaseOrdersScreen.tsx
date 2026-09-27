import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Ingredient, PurchaseOrder } from '@feedbook/types';
import { useI18n } from '../lib/i18n';

interface Props {
  restaurantId: string;
  ingredients: Ingredient[];
  purchaseOrders: PurchaseOrder[];
  onRefresh: () => void;
}

const STATUS_STYLES: Record<PurchaseOrder['status'], string> = {
  pending: 'bg-warning-soft text-warning',
  received: 'bg-success-soft text-success',
  cancelled: 'bg-surface-2 text-ink-muted',
};

export function PurchaseOrdersScreen({ restaurantId, ingredients, purchaseOrders, onRefresh }: Props) {
  const { t } = useI18n();
  const [addingNew, setAddingNew] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleReceive(po: PurchaseOrder) {
    setReceivingId(po.id);
    setError(null);
    const { error: rpcError } = await supabase.rpc('receive_purchase_order', { p_po_id: po.id });
    setReceivingId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onRefresh();
  }

  const statusLabel: Record<PurchaseOrder['status'], string> = {
    pending: t('purchaseOrderStatusPending'),
    received: t('purchaseOrderStatusReceived'),
    cancelled: t('purchaseOrderStatusCancelled'),
  };

  return (
    <div className="card p-6">
      <h1 className="mb-1 text-lg font-bold text-ink">{t('purchaseOrdersTitle')}</h1>
      <p className="mb-5 text-sm text-muted-foreground">{t('purchaseOrdersSubtitle')}</p>

      {error && (
        <div className="mb-3 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div>
      )}

      <div className="space-y-2">
        {purchaseOrders.map((po) => {
          const ingredient = ingredients.find((i) => i.id === po.ingredient_id);
          return (
            <div key={po.id} className="flex items-center gap-3 rounded bg-surface-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{ingredient?.name ?? po.ingredient_id}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <span className="tabular-nums">{po.quantity_ordered}</span> {ingredient?.unit ?? ''} ·{' '}
                  {new Date(po.created_at).toLocaleDateString()}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[po.status]}`}>
                {statusLabel[po.status]}
              </span>
              {po.status === 'pending' && (
                <button
                  type="button"
                  onClick={() => void handleReceive(po)}
                  disabled={receivingId === po.id}
                  className="shrink-0 rounded bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent hover:text-white disabled:opacity-50"
                >
                  {receivingId === po.id ? t('receivingPurchaseOrder') : t('receivePurchaseOrder')}
                </button>
              )}
            </div>
          );
        })}
        {purchaseOrders.length === 0 && <p className="text-sm text-muted-foreground">{t('purchaseOrdersEmpty')}</p>}
      </div>

      {addingNew ? (
        <NewPurchaseOrderForm
          restaurantId={restaurantId}
          ingredients={ingredients}
          onDone={() => {
            setAddingNew(false);
            onRefresh();
          }}
          onCancel={() => setAddingNew(false)}
        />
      ) : (
        ingredients.length > 0 && (
          <button
            type="button"
            onClick={() => setAddingNew(true)}
            className="mt-3 w-full rounded border border-dashed border-border-strong py-2 text-sm text-accent hover:bg-accent-soft"
          >
            {t('addPurchaseOrder')}
          </button>
        )
      )}
    </div>
  );
}

function NewPurchaseOrderForm({
  restaurantId,
  ingredients,
  onDone,
  onCancel,
}: {
  restaurantId: string;
  ingredients: Ingredient[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? '');
  const [quantity, setQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quantityValue = Number(quantity);
  const canSave = ingredientId !== '' && quantity.trim() !== '' && !Number.isNaN(quantityValue) && quantityValue > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: staffRow } = await supabase.from('staff').select('id').eq('user_id', user?.id ?? '').eq('restaurant_id', restaurantId).single();
    if (!staffRow) {
      setSaving(false);
      setError(t('genericError'));
      return;
    }
    const { error: insertError } = await supabase.from('purchase_orders').insert({
      restaurant_id: restaurantId,
      ingredient_id: ingredientId,
      quantity_ordered: quantityValue,
      created_by: staffRow.id,
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    onDone();
  }

  return (
    <div className="mt-2 rounded border border-border bg-surface p-3">
      {error && <p className="mb-2 text-xs text-danger">{error}</p>}
      <div className="mb-3 flex gap-2">
        <select
          value={ingredientId}
          onChange={(e) => setIngredientId(e.target.value)}
          className="min-w-0 flex-[2] rounded border border-border px-2 py-1.5 text-sm"
        >
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.unit})
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder={t('purchaseOrderQuantityPlaceholder')}
          className="w-24 rounded border border-border px-2 py-1.5 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="flex-1 rounded bg-accent py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
        >
          {saving ? t('saving') : t('savePurchaseOrder')}
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
