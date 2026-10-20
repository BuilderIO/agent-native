import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { RecoveryComparison } from "./RecoveryComparison";
import type {
  DocumentReconcileRecoveryState,
  ReconcileSaveBase,
} from "./useDocumentReconcileRecovery";

export function DocumentReconcileRecovery({
  state,
  server,
  canEdit,
  onKeepMine,
  onUseSaved,
  onSaveSeparately,
  onCopy,
  onClose,
}: {
  state: DocumentReconcileRecoveryState;
  server: ReconcileSaveBase;
  canEdit: boolean;
  onKeepMine: (base: ReconcileSaveBase) => Promise<boolean>;
  onUseSaved: (base: ReconcileSaveBase) => Promise<boolean>;
  onSaveSeparately: (base: ReconcileSaveBase) => Promise<boolean>;
  onCopy: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [reviewed, setReviewed] = useState<ReconcileSaveBase | null>(null);
  const stale =
    reviewed !== null &&
    (reviewed.updatedAt !== server.updatedAt ||
      reviewed.revision !== server.revision ||
      reviewed.title !== server.title ||
      reviewed.content !== server.content);
  const message = state.saving
    ? t("editor.reconcileSaving")
    : state.reason === "conflict"
      ? t("editor.reconcileConflict")
      : state.reason === "save-failed"
        ? t("editor.reconcileSaveFailed")
        : t("editor.reconcileFailed");

  async function finish(action: (base: ReconcileSaveBase) => Promise<boolean>) {
    if (!reviewed || stale || state.saving) return;
    if (await action(reviewed)) setReviewed(null);
  }

  return (
    <Dialog
      open={reviewed !== null}
      onOpenChange={(open) => {
        if (open) return;
        if (state.saving) return;
        setReviewed(null);
        onClose();
      }}
    >
      <div
        className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm"
        data-document-reconcile-conflict
      >
        <span className="me-auto min-w-0 flex-1 basis-56" role="status">
          {message}
        </span>
        <DialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            disabled={state.saving}
            onClick={() => setReviewed({ ...server })}
          >
            {t("editor.reconcileReview")}
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="flex h-[min(46rem,calc(100dvh-2rem))] max-w-[min(72rem,calc(100vw-2rem))] flex-col overflow-hidden p-0 sm:max-w-[min(72rem,calc(100vw-2rem))]">
        <DialogTitle className="sr-only">
          {t("editor.reconcileReview")}
        </DialogTitle>
        <RecoveryComparison
          mine={{ title: state.localTitle, content: state.localDraft }}
          saved={{
            title: reviewed?.title ?? server.title ?? "",
            content: reviewed?.content ?? "",
          }}
          busy={state.saving}
          keepMineDisabled={!canEdit || !reviewed?.updatedAt}
          failure={stale ? t("editor.reconcileReviewStale") : message}
          stale={stale}
          onRefresh={() => setReviewed({ ...server })}
          onKeepMine={() => void finish(onKeepMine)}
          onUseSaved={() => void finish(onUseSaved)}
          onSaveSeparately={() => void finish(onSaveSeparately)}
          onCopy={() => void onCopy()}
        />
      </DialogContent>
    </Dialog>
  );
}
