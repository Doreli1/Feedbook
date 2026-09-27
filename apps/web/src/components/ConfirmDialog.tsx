import { useEffect } from 'react';
import { CloseIcon } from './Icons';
import { useI18n } from '../lib/i18n';

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  // 'accent' for a neutral/expected transition (e.g. leaving a form step);
  // 'danger' for an action with a real consequence (e.g. signing out).
  confirmVariant?: 'accent' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

// Shared confirmation modal — dimmed backdrop + centered card, matching the
// pattern the user pointed at (Booking's own "before you leave" dialog):
// bold title, muted description, an outlined "stay" action and a solid
// "proceed" action. Reused for both the unsaved-changes leave-guard and the
// sign-out confirmation so the two read as one consistent interaction
// language rather than two different-looking popups.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmVariant = 'accent',
  onConfirm,
  onCancel,
}: Props) {
  const { dir } = useI18n();

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        dir={dir}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-surface p-6 shadow-lg"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 id="confirm-dialog-title" className="text-base font-bold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={cancelLabel}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-surface-2 hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">{description}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded px-4 py-2 text-sm font-medium text-white ${
              confirmVariant === 'danger' ? 'bg-danger hover:bg-danger/90' : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
