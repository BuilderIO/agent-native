import { useId, useRef } from "react";

import { useConfirmDialogBehavior } from "@/components/ui/useConfirmDialogBehavior";

/**
 * "Archive" from the projects list. The copy and the button label come from the
 * source's move-to-archive confirmation dialog.
 */
export function ArchiveProjectDialog({
  pending,
  error,
  onCancel,
  onConfirm,
}: {
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
        <h2 id={`${id}-title`}>Confirm move to archive</h2>
        <p>Are you sure you want to move 1 project to archive?</p>
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
            Move to archive
          </button>
        </div>
      </div>
    </div>
  );
}
