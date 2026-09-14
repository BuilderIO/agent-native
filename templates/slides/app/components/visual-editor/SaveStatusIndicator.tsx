import { useT } from "@agent-native/core/client/i18n";
import { IconCloudOff, IconDownload, IconUpload } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SaveStatusIndicatorProps {
  /**
   * True while a save is in flight or pending (debounced). Deliberately NOT
   * rendered: automatic saving is silent (Figma-style) — a "Saving…/Saved"
   * ticker is clutter. Only exceptional failure states get UI.
   */
  saving: boolean;
  /** True when the current deck has an unconfirmed local write. */
  hasUnsavedChanges?: boolean;
  /** True when the current deck exhausted its save retries. */
  saveFailed?: boolean;
  /** True when the browser is offline. */
  offline?: boolean;
  onDownloadBackup?: () => void;
  onImportBackup?: () => void;
  className?: string;
}

export function SaveStatusIndicator({
  saving: _saving,
  hasUnsavedChanges = false,
  saveFailed = false,
  offline,
  onDownloadBackup,
  onImportBackup,
  className,
}: SaveStatusIndicatorProps) {
  const t = useT();
  const showWarning = saveFailed || (offline && hasUnsavedChanges);

  // Only the actionable, exceptional state renders — silent otherwise.
  if (showWarning) {
    const label = saveFailed ? t("settings.saveFailed") : t("raw.offline");
    const description = saveFailed
      ? t("raw.saveFailedDescription")
      : t("raw.saveReconnect");
    return (
      <div
        role="alert"
        aria-live="polite"
        data-save-status={saveFailed ? "failed" : "offline"}
        title={description}
        className={cn(
          "flex min-w-0 items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-1 text-[11px] text-destructive",
          className,
        )}
      >
        <IconCloudOff className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden max-w-28 truncate lg:inline">{label}</span>
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
    );
  }

  return null;
}
