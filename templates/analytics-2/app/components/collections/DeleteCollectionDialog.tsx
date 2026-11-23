import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useId, useRef, useState } from "react";

import { useConfirmDialogBehavior } from "@/components/ui/useConfirmDialogBehavior";

/**
 * Permanently delete a collection. The source's dialog states the same two
 * things: projects in the collection are not deleted, and this cannot be
 * undone.
 */
export function DeleteCollectionDialog({
  collectionId,
  collectionName,
  onClose,
  onDeleted,
}: {
  collectionId: string;
  collectionName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const id = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const cancel = () => {
    if (!pending) onClose();
  };
  useConfirmDialogBehavior({ onCancel: cancel, confirmRef });

  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await callAction("delete-collection", { collectionId });
      onDeleted();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("analytics.collections.deleteFailed"),
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <h2
          id={`${id}-title`}
          className="text-base font-semibold text-foreground"
        >
          {t("analytics.collections.deleteDialogTitle")}
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("analytics.collections.deleteDialogBody", {
            name: collectionName,
          })}
        </p>
        {error != null ? (
          <p
            className="mt-2 text-xs text-[color:var(--ws-danger)]"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-border px-3 py-1.5 text-sm"
            disabled={pending}
            onClick={cancel}
          >
            {t("collectionDialog.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="rounded bg-red-600 px-3 py-1.5 text-sm text-white"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void remove()}
          >
            {t("analytics.lists.deleteCollection")}
          </button>
        </div>
      </div>
    </div>
  );
}
