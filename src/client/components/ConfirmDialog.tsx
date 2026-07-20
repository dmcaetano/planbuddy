interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small blocking confirm dialog used for destructive/consequential friend actions (remove, block). */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="pb-modal-overlay" role="presentation" onClick={onCancel}>
      <div
        className="pb-modal card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pb-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="pb-confirm-title">{title}</h3>
        <p>{body}</p>
        <div className="pb-modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className={`btn ${danger ? "btn-danger-ghost" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
