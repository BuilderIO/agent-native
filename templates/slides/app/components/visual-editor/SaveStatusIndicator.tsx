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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeckSaveError } from "@/context/DeckContext";
import { cn } from "@/lib/utils";

export type ConflictChoice = "keep-mine" | "use-latest";

interface SaveStatusIndicatorProps {
  saving: boolean;
  hasUnsavedChanges?: boolean;
  saveFailed?: boolean;
  saveError?: Pick<DeckSaveError, "status" | "errorCode" | "retryable">;
  offline?: boolean;
  conflict?: { slideNumber: number; canResolve: boolean };
  onResolveConflict?: (choice: ConflictChoice) => Promise<void>;
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
  conflict,
  onResolveConflict,
  onRetrySave,
  onReload,
  onDownloadBackup,
  onImportBackup,
  className,
}: SaveStatusIndicatorProps) {
  const t = useT();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [resolvingTextConflict, setResolvingTextConflict] = useState(false);
  const [conflictError, setConflictError] = useState(false);
  const [retryingSave, setRetryingSave] = useState(false);
  const showWarning =
    Boolean(conflict) || saveFailed || (offline && hasUnsavedChanges);

  const resolveTextConflict = async (choice: ConflictChoice) => {
    if (!onResolveConflict || !conflict?.canResolve || resolvingTextConflict)
      return;
    setResolvingTextConflict(true);
    setConflictError(false);
    try {
      await onResolveConflict(choice);
      setConflictOpen(false);
    } catch {
      setConflictError(true);
    } finally {
      setResolvingTextConflict(false);
    }
  };

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
    const errorDetail = saveError?.errorCode
      ? `${saveError.status ? `${saveError.status} · ` : ""}${saveError.errorCode}`
      : saveError?.status
        ? `HTTP ${saveError.status}`
        : undefined;
    const label = conflict
      ? t("editorToolbar.conflictStatus")
      : saveFailed
        ? t("settings.saveFailed")
        : t("raw.offline");
    const description = conflict
      ? t("editorToolbar.conflictStatusDescription")
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
            conflict ? "conflict" : saveFailed ? "failed" : "offline"
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
          {saveFailed && errorDetail && (
            <span
              className="sr-only font-mono text-[10px] lg:not-sr-only lg:max-w-40 lg:truncate"
              title={errorDetail}
            >
              {errorDetail}
            </span>
          )}
          {saveFailed && saveError?.retryable && onRetrySave && (
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
          {saveFailed && onReload && (
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
          {conflict?.canResolve && onResolveConflict && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[11px] text-inherit hover:bg-destructive/10"
              onClick={() => {
                setConflictError(false);
                setConflictOpen(true);
              }}
              aria-label={t("editorToolbar.reviewConflict")}
            >
              {t("editorToolbar.reviewConflict")}
            </Button>
          )}
          {onDownloadBackup &&
            (!conflict?.canResolve || !onResolveConflict) && (
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
        {conflict?.canResolve && onResolveConflict && (
          <Dialog
            open={conflictOpen}
            onOpenChange={(open) =>
              !resolvingTextConflict && setConflictOpen(open)
            }
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {t("editorToolbar.conflictTitle", {
                    number: conflict.slideNumber,
                  })}
                </DialogTitle>
                <DialogDescription>
                  {t("editorToolbar.conflictDescription")}
                </DialogDescription>
              </DialogHeader>
              {conflictError && (
                <p role="alert" className="text-sm text-destructive">
                  {t("editorToolbar.conflictResolveFailed")}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={resolvingTextConflict}
                  onClick={() => void resolveTextConflict("use-latest")}
                >
                  {t("editorToolbar.conflictUseLatest")}
                </Button>
                <Button
                  type="button"
                  disabled={resolvingTextConflict}
                  onClick={() => void resolveTextConflict("keep-mine")}
                >
                  {t("editorToolbar.conflictKeepMine")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </>
    );
  }

  return null;
}
