import { useT } from "@agent-native/core/client/i18n";
import {
  IconCloudOff,
  IconDownload,
  IconRepeat,
  IconRefresh,
  IconUpload,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  useDeckContentConflicts,
  useDeckFieldConflicts,
  type DeckSaveError,
} from "@/context/DeckContext";
import { isDeckAccessLostStatus } from "@/lib/deck-access-lost";
import { cn } from "@/lib/utils";

import {
  ConflictReviewDialog,
  type ReviewableConflict,
} from "./ConflictReviewDialog";

interface SaveStatusIndicatorProps {
  saving: boolean;
  hasUnsavedChanges?: boolean;
  saveFailed?: boolean;
  saveError?: Pick<DeckSaveError, "status" | "errorCode" | "retryable">;
  offline?: boolean;
  /** The deck whose slide conflicts this indicator reviews. */
  deckId: string;
  onRetrySave?: () => Promise<void>;
  onReload?: () => void;
  onDownloadBackup?: () => void;
  onImportBackup?: () => void;
  className?: string;
}

export function SaveStatusIndicator({
  saving: _saving,
  hasUnsavedChanges = false,
  saveFailed = false,
  saveError,
  offline,
  deckId,
  onRetrySave,
  onReload,
  onDownloadBackup,
  onImportBackup,
  className,
}: SaveStatusIndicatorProps) {
  const t = useT();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [retryingSave, setRetryingSave] = useState(false);
  const contentConflict = useDeckContentConflicts(deckId).at(0);
  const fieldConflict = useDeckFieldConflicts(deckId).at(0);
  const conflict = Boolean(contentConflict || fieldConflict);
  const review: ReviewableConflict | undefined = contentConflict?.canResolve
    ? { kind: "content", conflict: contentConflict }
    : !contentConflict && fieldConflict
      ? { kind: "field", conflict: fieldConflict }
      : undefined;
  const showWarning = conflict || saveFailed || (offline && hasUnsavedChanges);

  const retrySave = async () => {
    if (!onRetrySave || retryingSave) return;
    setRetryingSave(true);
    try {
      await onRetrySave();
    } catch {
      toast.error(t("settings.saveFailed"));
    } finally {
      setRetryingSave(false);
    }
  };

  if (showWarning) {
    const plainErrorDetail =
      saveError?.errorCode === "deck_revision_conflict"
        ? t("editorToolbar.saveErrorDeckChanged")
        : saveError?.errorCode === "slide_content_conflict"
          ? t("editorToolbar.saveErrorSlidesChanged")
          : undefined;
    const errorDetail =
      plainErrorDetail ??
      (saveError?.errorCode
        ? `${saveError.status ? `${saveError.status} · ` : ""}${saveError.errorCode}`
        : saveError?.status
          ? `HTTP ${saveError.status}`
          : undefined);
    const accessLost =
      !conflict && saveFailed && isDeckAccessLostStatus(saveError?.status);
    const label = conflict
      ? t("editorToolbar.conflictStatus")
      : accessLost
        ? t("editorToolbar.accessLost")
        : saveFailed
          ? t("settings.saveFailed")
          : t("raw.offline");
    const description = conflict
      ? t("editorToolbar.conflictStatusDescription")
      : accessLost
        ? t("editorToolbar.accessLostDescription")
        : saveFailed
          ? t("raw.saveFailedDescription")
          : t("raw.saveReconnect");

    return (
      <>
        <div
          role="alert"
          aria-live="polite"
          aria-label={`${label}. ${description}${errorDetail ? `. ${errorDetail}` : ""}`}
          data-save-status={
            conflict
              ? "conflict"
              : accessLost
                ? "access-lost"
                : saveFailed
                  ? "failed"
                  : "offline"
          }
          data-save-error-status={saveError?.status}
          data-save-error-code={saveError?.errorCode}
          title={description}
          className={cn(
            "flex min-w-0 items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive",
            className,
          )}
        >
          <IconCloudOff className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden max-w-28 truncate lg:inline">{label}</span>
          {!conflict && saveFailed && errorDetail && (
            <span
              className={cn(
                "sr-only text-[10px] lg:not-sr-only lg:max-w-40 lg:truncate",
                !plainErrorDetail && "font-mono",
              )}
              title={errorDetail}
            >
              {errorDetail}
            </span>
          )}
          {!conflict && saveFailed && saveError?.retryable && onRetrySave && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-inherit hover:bg-destructive/10"
              disabled={retryingSave}
              onClick={() => void retrySave()}
              title={t("settings.retry")}
              aria-label={t("settings.retry")}
            >
              <IconRepeat className="size-3.5" aria-hidden="true" />
              <span className="hidden 2xl:inline">{t("settings.retry")}</span>
            </Button>
          )}
          {!conflict && saveFailed && onReload && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-inherit hover:bg-destructive/10"
              onClick={onReload}
              title={t("settings.reload")}
              aria-label={t("settings.reload")}
            >
              <IconRefresh className="size-3.5" aria-hidden="true" />
              <span className="hidden 2xl:inline">{t("settings.reload")}</span>
            </Button>
          )}
          {review && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-inherit hover:bg-destructive/10"
              onClick={() => setConflictOpen(true)}
              aria-label={t("editorToolbar.reviewConflict")}
            >
              {t("editorToolbar.reviewConflict")}
            </Button>
          )}
          {onDownloadBackup && !review && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-inherit hover:bg-destructive/10"
              onClick={onDownloadBackup}
              title={t("editorToolbar.downloadBackup")}
              aria-label={t("editorToolbar.downloadBackup")}
            >
              <IconDownload className="size-3.5" aria-hidden="true" />
              <span className="hidden 2xl:inline">
                {t("editorToolbar.downloadBackup")}
              </span>
            </Button>
          )}
          {!conflict && onImportBackup && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-inherit hover:bg-destructive/10"
              onClick={onImportBackup}
              title={t("editorToolbar.importBackup")}
              aria-label={t("editorToolbar.importBackup")}
            >
              <IconUpload className="size-3.5" aria-hidden="true" />
              <span className="hidden 2xl:inline">
                {t("editorToolbar.importBackup")}
              </span>
            </Button>
          )}
        </div>
        {review && (
          <ConflictReviewDialog
            deckId={deckId}
            review={review}
            open={conflictOpen}
            onOpenChange={setConflictOpen}
          />
        )}
      </>
    );
  }

  return null;
}
