import { useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseCsv, toCsv, downloadCsv } from '../lib/csv';
import { CloseIcon } from './Icons';
import { useI18n } from '../lib/i18n';
import type { TranslationKey } from '../lib/translations';

interface Props {
  restaurantId: string;
  existingSkus: Set<string>;
  onDone: () => void;
  onClose: () => void;
}

type RowField = 'name' | 'sku' | 'unit' | 'stock' | 'threshold' | 'unitCost' | 'supplier';
type RowStatus = 'valid' | 'error' | 'duplicateInFile' | 'duplicateExisting';

interface ParsedRow {
  rowNumber: number; // 1-based, matching what a spreadsheet shows (row 1 = header)
  name: string;
  sku: string;
  unit: string;
  quantityInStock: number;
  thresholdQuantity: number;
  unitCost: number | null;
  supplierInfo: string | null;
  status: RowStatus;
  statusMessageKey?: TranslationKey;
}

// Recognizes both this screen's own field labels (IngredientsScreen.tsx) and
// their English equivalents, lowercased+trimmed — a file built from the
// downloaded template always matches, and one from a colleague using the
// other language still parses instead of silently misreading columns.
const HEADER_ALIASES: Record<string, RowField> = {
  'שם': 'name',
  'שם חומר הגלם': 'name',
  name: 'name',
  'ingredient name': 'name',
  'מק"ט': 'sku',
  'מקט': 'sku',
  'מק"ט (קוד מזהה פנימי)': 'sku',
  sku: 'sku',
  'יחידת מידה': 'unit',
  'יחידה': 'unit',
  unit: 'unit',
  'unit of measure': 'unit',
  'כמות במלאי': 'stock',
  'כמות במלאי כרגע': 'stock',
  stock: 'stock',
  'quantity in stock': 'stock',
  'current quantity in stock': 'stock',
  'סף התראה': 'threshold',
  'סף התראה למלאי נמוך': 'threshold',
  threshold: 'threshold',
  'alert threshold': 'threshold',
  'low-stock alert threshold': 'threshold',
  'עלות ליחידה': 'unitCost',
  'unit cost': 'unitCost',
  'cost per unit': 'unitCost',
  'ספק': 'supplier',
  'פרטי ספק': 'supplier',
  supplier: 'supplier',
  'supplier info': 'supplier',
};

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase();
}

function parseFile(text: string, existingSkus: Set<string>): { rows: ParsedRow[]; headerError: TranslationKey | null } {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], headerError: 'ingredientImportEmptyFile' };

  const [headerRow, ...dataRows] = table;
  const fieldByColumn = (headerRow ?? []).map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null);
  if (!fieldByColumn.includes('name') || !fieldByColumn.includes('sku') || !fieldByColumn.includes('unit')) {
    return { rows: [], headerError: 'ingredientImportMissingColumns' };
  }

  function cell(cells: string[], field: RowField): string {
    const index = fieldByColumn.indexOf(field);
    return index === -1 ? '' : (cells[index] ?? '').trim();
  }

  const seenSkus = new Set<string>();
  const rows: ParsedRow[] = dataRows.map((cells, idx) => {
    const rowNumber = idx + 2; // header occupies row 1
    const name = cell(cells, 'name');
    const sku = cell(cells, 'sku');
    const unit = cell(cells, 'unit');
    const stockRaw = cell(cells, 'stock');
    const thresholdRaw = cell(cells, 'threshold');
    const unitCostRaw = cell(cells, 'unitCost');
    const supplierRaw = cell(cells, 'supplier');
    const supplierInfo = supplierRaw || null;

    if (!name || !sku || !unit) {
      return { rowNumber, name, sku, unit, quantityInStock: 0, thresholdQuantity: 0, unitCost: null, supplierInfo, status: 'error', statusMessageKey: 'ingredientImportMissingRequired' };
    }

    const quantityInStock = stockRaw === '' ? 0 : Number(stockRaw);
    const thresholdQuantity = thresholdRaw === '' ? 0 : Number(thresholdRaw);
    const unitCost = unitCostRaw === '' ? null : Number(unitCostRaw);
    const numbersValid =
      Number.isFinite(quantityInStock) &&
      quantityInStock >= 0 &&
      Number.isFinite(thresholdQuantity) &&
      thresholdQuantity >= 0 &&
      (unitCost === null || (Number.isFinite(unitCost) && unitCost >= 0));
    if (!numbersValid) {
      return { rowNumber, name, sku, unit, quantityInStock: 0, thresholdQuantity: 0, unitCost: null, supplierInfo, status: 'error', statusMessageKey: 'ingredientImportInvalidNumber' };
    }

    if (existingSkus.has(sku)) {
      return { rowNumber, name, sku, unit, quantityInStock, thresholdQuantity, unitCost, supplierInfo, status: 'duplicateExisting', statusMessageKey: 'ingredientImportSkuExists' };
    }
    if (seenSkus.has(sku)) {
      return { rowNumber, name, sku, unit, quantityInStock, thresholdQuantity, unitCost, supplierInfo, status: 'duplicateInFile', statusMessageKey: 'ingredientImportSkuDuplicateInFile' };
    }
    seenSkus.add(sku);
    return { rowNumber, name, sku, unit, quantityInStock, thresholdQuantity, unitCost, supplierInfo, status: 'valid' };
  });

  return { rows, headerError: null };
}

const STATUS_STYLES: Record<RowStatus, string> = {
  valid: 'bg-success-soft text-success',
  error: 'bg-danger-soft text-danger',
  duplicateInFile: 'bg-warning-soft text-warning',
  duplicateExisting: 'bg-warning-soft text-warning',
};

export function IngredientImportModal({ restaurantId, existingSkus, onDone, onClose }: Props) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [headerError, setHeaderError] = useState<TranslationKey | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  function handleDownloadTemplate() {
    const headers = [
      t('ingredientCsvHeaderName'),
      t('ingredientCsvHeaderSku'),
      t('ingredientCsvHeaderUnit'),
      t('ingredientCsvHeaderStock'),
      t('ingredientCsvHeaderThreshold'),
      t('ingredientCsvHeaderUnitCost'),
      t('ingredientCsvHeaderSupplier'),
    ];
    const exampleRow = [t('ingredientImportExampleName'), 'SKU-001', 'ק"ג', '10', '2', '15', t('ingredientImportExampleSupplier')];
    downloadCsv('ingredients-template.csv', toCsv([headers, exampleRow]));
  }

  async function handleFileSelected(file: File) {
    setImportedCount(null);
    setImportError(null);
    const text = await file.text();
    const { rows: parsedRows, headerError: err } = parseFile(text, existingSkus);
    setRows(err ? null : parsedRows);
    setHeaderError(err);
  }

  const validRows = rows?.filter((r) => r.status === 'valid') ?? [];

  async function handleImport() {
    if (validRows.length === 0) return;
    setImporting(true);
    setImportError(null);
    const { error } = await supabase.from('ingredients').insert(
      validRows.map((r) => ({
        restaurant_id: restaurantId,
        name: r.name,
        sku: r.sku,
        unit: r.unit,
        quantity_in_stock: r.quantityInStock,
        threshold_quantity: r.thresholdQuantity,
        unit_cost: r.unitCost,
        supplier_info: r.supplierInfo,
      })),
    );
    setImporting(false);
    if (error) {
      setImportError(error.message);
      return;
    }
    setImportedCount(validRows.length);
    onDone();
  }

  const errorCount = rows?.filter((r) => r.status === 'error').length ?? 0;
  const duplicateCount = rows?.filter((r) => r.status === 'duplicateInFile' || r.status === 'duplicateExisting').length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{t('ingredientImportTitle')}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-surface-2" aria-label={t('cancel')}>
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {importedCount !== null ? (
          <>
            <div className="mb-4 rounded border-l-4 border-success bg-success-soft px-3 py-2 text-sm text-success">
              {t('ingredientImportSuccess').replace('{count}', String(importedCount))}
            </div>
            <button type="button" onClick={onClose} className="w-full rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover">
              {t('ingredientImportCloseAfterSuccess')}
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{t('ingredientImportSubtitle')}</p>

            <div className="mb-4 flex flex-wrap gap-2">
              <button type="button" onClick={handleDownloadTemplate} className="rounded border border-border px-3 py-1.5 text-xs text-accent hover:bg-accent-soft">
                {t('ingredientImportDownloadTemplate')}
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent hover:text-white">
                {t('ingredientImportChooseFile')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileSelected(file);
                }}
              />
            </div>

            {headerError && <div className="mb-4 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{t(headerError)}</div>}
            {importError && <div className="mb-4 rounded border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{importError}</div>}

            {rows && rows.length > 0 && (
              <>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t('ingredientImportSummary')
                    .replace('{valid}', String(validRows.length))
                    .replace('{errors}', String(errorCount))
                    .replace('{duplicates}', String(duplicateCount))}
                </p>
                <div className="mb-4 max-h-64 space-y-1.5 overflow-y-auto rounded border border-border p-2">
                  {rows.map((row) => (
                    <div key={row.rowNumber} className="flex items-center gap-2 rounded bg-surface-2 px-2 py-1.5 text-xs">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[row.status]}`}>
                        {t(row.status === 'valid' ? 'ingredientImportRowValid' : (row.statusMessageKey ?? 'ingredientImportRowValid'))}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{t('ingredientImportRowNumber').replace('{row}', String(row.rowNumber))}</span>
                      <span className="min-w-0 flex-1 truncate text-ink">{row.name || row.sku || '—'}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={validRows.length === 0 || importing}
                className="flex-1 rounded bg-accent py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-border disabled:text-muted-foreground"
              >
                {importing ? t('saving') : t('ingredientImportSubmit').replace('{count}', String(validRows.length))}
              </button>
              <button type="button" onClick={onClose} className="rounded border border-border px-4 py-2 text-sm text-ink hover:bg-surface-2">
                {t('cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
