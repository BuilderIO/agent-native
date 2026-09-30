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
import { cn } from "@/lib/utils";

interface SaveStatusIndicatorProps {
  saving: boolean;
  hasUnsavedChanges?: boolean;
  saveFailed?: boolean;
  offline?: boolean;
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
  onDownloadBackup,
  onImportBackup,
  contentConflict = false,
  onResolveContentConflict,
  className,
}: SaveStatusIndicatorProps) {
  const t = useT();
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [resolving, setResolving] = useState<"latest" | "draft" | null>(null);
  const showWarning = saveFailed || (offline && hasUnsavedChanges);

  const resolveConflict = async (resolution: "latest" | "draft") => {
    if (!onResolveContentConflict) return;
    setResolving(resolution);
    try {
      await onResolveContentConflict(resolution);
      setConflictDialogOpen(false);
    } catch {
      toast.error(t("raw.slideConflictResolutionFailed"));
    } finally {
      setResolving(null);
    }
  };

  if (showWarning) {
    const label = saveFailed ? t("settings.saveFailed") : t("raw.offline");
    const description = contentConflict
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
            contentConflict ? "conflict" : saveFailed ? "failed" : "offline"
          }
          title={description}
          className={cn(
            "flex min-w-0 items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive",
            className,
          )}
        >
          <IconCloudOff className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="hidden max-w-28 truncate lg:inline">{label}</span>
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
        {contentConflict && onResolveContentConflict && (
          <AlertDialog
            open={conflictDialogOpen}
            onOpenChange={(open) => !resolving && setConflictDialogOpen(open)}
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
                <AlertDialogCancel disabled={resolving !== null}>
                  {t("raw.slideConflictKeepEditing")}
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="outline"
                  disabled={resolving !== null}
                  onClick={() => void resolveConflict("latest")}
                >
                  {resolving === "latest" && (
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
                  disabled={resolving !== null}
                  onClick={() => void resolveConflict("draft")}
                >
                  {resolving === "draft" && (
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
