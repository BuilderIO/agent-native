import { useT } from "@agent-native/core/client/i18n";
import { IconCloudOff, IconDownload, IconUpload } from "@tabler/icons-react";
import { useState } from "react";

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
  className,
}: SaveStatusIndicatorProps) {
  const t = useT();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [conflictError, setConflictError] = useState(false);
  const showWarning =
    Boolean(conflict) || saveFailed || (offline && hasUnsavedChanges);

  if (showWarning) {
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
    const resolveConflict = async (choice: ConflictChoice) => {
      if (!onResolveConflict || !conflict?.canResolve || resolving) return;
      setResolving(true);
      setConflictError(false);
      try {
        await onResolveConflict(choice);
        setConflictOpen(false);
      } catch {
        setConflictError(true);
      } finally {
        setResolving(false);
      }
    };
    return (
      <>
        <div
          role="alert"
          aria-live="polite"
          data-save-status={
            conflict ? "conflict" : saveFailed ? "failed" : "offline"
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
          {onImportBackup && (
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
            onOpenChange={(open) => !resolving && setConflictOpen(open)}
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
                      disabled={resolving}
                      onClick={() => void resolveConflict("use-latest")}
                    >
                      {t("editorToolbar.conflictUseLatest")}
                    </Button>
                    <Button
                      type="button"
                      disabled={resolving}
                      onClick={() => void resolveConflict("keep-mine")}
                    >
                      {t("editorToolbar.conflictKeepMine")}
                    </Button>
                  </>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </>
    );
  }

  return null;
}
