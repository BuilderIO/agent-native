import { useT } from "@agent-native/core/client/i18n";
import {
  IconCloudOff,
  IconDownload,
  IconLoader2,
  IconUpload,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ConflictChoice = "keep-mine" | "use-latest";

interface SaveStatusIndicatorProps {
  saving: boolean;
  hasUnsavedChanges?: boolean;
  saveFailed?: boolean;
  offline?: boolean;
  conflict?: { slideNumber: number; canResolve: boolean };
  onResolveConflict?: (choice: ConflictChoice) => Promise<void>;
  onDownloadBackup?: () => void;
  onImportBackup?: () => void;
  contentConflict?: boolean;
  onResolveContentConflict?: (resolution: "latest" | "draft") => Promise<void>;
  className?: string;
}

export function SaveStatusIndicator({
  saving: _saving,
  hasUnsavedChanges = false,
  saveFailed = false,
  offline,
  conflict,
  onResolveConflict,
  onDownloadBackup,
  onImportBackup,
  contentConflict = false,
  onResolveContentConflict,
  className,
}: SaveStatusIndicatorProps) {
  const t = useT();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [resolvingTextConflict, setResolvingTextConflict] = useState(false);
  const [conflictError, setConflictError] = useState(false);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [resolvingContentConflict, setResolvingContentConflict] = useState<
    "latest" | "draft" | null
  >(null);
  const showWarning =
    Boolean(conflict) ||
    contentConflict ||
    saveFailed ||
    (offline && hasUnsavedChanges);

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

  const resolveContentConflict = async (resolution: "latest" | "draft") => {
    if (!onResolveContentConflict || resolvingContentConflict !== null) return;
    setResolvingContentConflict(resolution);
    try {
      await onResolveContentConflict(resolution);
      setConflictDialogOpen(false);
    } catch {
      toast.error(t("raw.slideConflictResolutionFailed"));
    } finally {
      setResolvingContentConflict(null);
    }
  };

  if (showWarning) {
    const label = conflict
      ? t("editorToolbar.conflictStatus")
      : contentConflict
        ? t("raw.slideConflictTitle")
        : saveFailed
          ? t("settings.saveFailed")
          : t("raw.offline");
    const description = conflict
      ? t("editorToolbar.conflictStatusDescription")
      : contentConflict
        ? t("raw.slideConflictDescription")
        : saveFailed
          ? t("raw.saveFailedDescription")
          : t("raw.saveReconnect");

    return (
      <>
        <div
          role="alert"
          aria-live="polite"
          data-save-status={
            conflict || contentConflict
              ? "conflict"
              : saveFailed
                ? "failed"
                : "offline"
          }
          title={description}
          className={cn(
            "flex min-w-0 items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive",
            className,
          )}
        >
          <IconCloudOff className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden max-w-28 truncate lg:inline">{label}</span>
          {conflict && (
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
          {contentConflict && onResolveContentConflict && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px] text-inherit hover:bg-destructive/10"
              onClick={() => setConflictDialogOpen(true)}
              title={t("raw.slideConflictReview")}
              aria-label={t("raw.slideConflictReview")}
            >
              {t("raw.slideConflictReview")}
            </Button>
          )}
          {onDownloadBackup && (
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
          {!contentConflict && onImportBackup && (
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
        {conflict && (
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
              {conflict.canResolve ? (
                <p className="text-sm text-muted-foreground">
                  {t("editorToolbar.conflictChoicesDescription")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("editorToolbar.conflictBackupDescription")}
                </p>
              )}
              {conflictError && (
                <p role="alert" className="text-sm text-destructive">
                  {t("editorToolbar.conflictResolveFailed")}
                </p>
              )}
              <DialogFooter>
                {!conflict.canResolve && onDownloadBackup && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onDownloadBackup}
                  >
                    {t("editorToolbar.downloadBackup")}
                  </Button>
                )}
                {conflict.canResolve && (
                  <>
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
                  </>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {contentConflict && onResolveContentConflict && (
          <AlertDialog
            open={conflictDialogOpen}
            onOpenChange={(open) =>
              resolvingContentConflict === null && setConflictDialogOpen(open)
            }
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("raw.slideConflictTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("raw.slideConflictDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={resolvingContentConflict !== null}>
                  {t("raw.slideConflictKeepEditing")}
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="outline"
                  disabled={resolvingContentConflict !== null}
                  onClick={() => void resolveContentConflict("latest")}
                >
                  {resolvingContentConflict === "latest" && (
                    <IconLoader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {t("raw.slideConflictUseLatest")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={resolvingContentConflict !== null}
                  onClick={() => void resolveContentConflict("draft")}
                >
                  {resolvingContentConflict === "draft" && (
                    <IconLoader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {t("raw.slideConflictKeepDraft")}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </>
    );
  }

  return null;
}
