import { useT } from "@agent-native/core/client/i18n";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { useConfirmDialogBehavior } from "@/components/ui/useConfirmDialogBehavior";

export function RemoveFromCollectionDialog({
  onClose,
  onConfirm,
  count = 1,
  silent = false,
}: {
  onClose: () => void;
  onConfirm: () => Promise<void>;
  count?: number;
  silent?: boolean;
}) {
  const t = useT();
  const id = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const cancel = () => {
    if (!pending) onClose();
  };
  useConfirmDialogBehavior({ onCancel: cancel, confirmRef });

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await onConfirm();
      if (!silent) {
        toast.success(
          t("analytics.lists.removedFromCollectionToast", {
            noun: t("analytics.lists.projectTitleNoun"),
          }),
        );
      }
      onClose();
    } catch {
      toast.error(
        t("analytics.lists.removeFromCollectionFailed", {
          noun: t("analytics.lists.projectNoun"),
        }),
      );
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="ws-projects-import-backdrop" role="presentation">
      <div
        className="ws-projects-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <h2 id={`${id}-title`}>
          {t("analytics.lists.confirmRemoveFromCollectionTitle")}
        </h2>
        <p>
          {t("analytics.lists.confirmRemoveFromCollectionBody", {
            count,
            noun: t(
              count === 1
                ? "analytics.lists.projectNoun"
                : "analytics.lists.projectsNoun",
            ),
          })}
        </p>
        <div className="ws-projects-import-actions">
          <button
            type="button"
            className="ws-projects-secondary"
            disabled={pending}
            onClick={cancel}
          >
            {t("analytics.lists.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="ws-projects-primary"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void confirm()}
          >
            {t("analytics.lists.confirmRemoveFromCollectionButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
