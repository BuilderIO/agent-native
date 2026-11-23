import { useId, useRef } from "react";

import { useConfirmDialogBehavior } from "@/components/ui/useConfirmDialogBehavior";

/**
 * Move to trash. Trashing a project is recoverable (the Trash view restores
 * it), so the confirmation states what happens and where it goes.
 */
export function TrashProjectDialog({
  projectTitle,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  projectTitle: string;
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
        <h2 id={`${id}-title`}>Move to trash</h2>
        <p>
          “{projectTitle}” will move to Trash. You can restore it from there.
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
            className="ws-projects-primary"
            disabled={pending}
            aria-busy={pending}
            onClick={onConfirm}
          >
            Move to trash
          </button>
        </div>
      </div>
    </div>
  );
}
