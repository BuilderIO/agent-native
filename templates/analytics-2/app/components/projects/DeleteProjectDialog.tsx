import { useId, useRef } from "react";

import { useConfirmDialogBehavior } from "@/components/ui/useConfirmDialogBehavior";

/**
 * "Permanently delete" from the Trash view. The copy and the button label come
 * from the source's hard-delete confirmation dialog, which states that the
 * action cannot be undone.
 */
export function DeleteProjectDialog({
  count = 1,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  count?: number;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  useConfirmDialogBehavior({ onCancel, confirmRef });
  return (
    <div className="ws-projects-import-backdrop" role="presentation">
      <div
        className="ws-projects-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <h2 id={`${id}-title`}>Confirm permanent deletion</h2>
        <p>
          Are you sure you want to permanently delete {count}{" "}
          {count === 1 ? "project" : "projects"}? This action cannot be undone.
        </p>
        {error != null ? (
          <p className="ws-field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ws-projects-import-actions">
          <button
            type="button"
            className="ws-projects-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="ws-projects-danger"
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            Permanently delete
          </button>
        </div>
      </div>
    </div>
  );
}
