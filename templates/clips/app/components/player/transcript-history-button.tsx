import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { IMPORTED_TRANSCRIPT_SOURCE } from "@shared/transcript-import";
import { IconHistory, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { relativeTime } from "./comments-panel";

/** A replaced transcript, as get-recording-player-data lists it to editors. */
export interface TranscriptVersion {
  id: string;
  replacedAt: string;
  source: string | null;
  preview: string;
}

export function TranscriptHistoryButton({
  variant,
  versions,
  restoringVersionId,
  onRestore,
}: {
  variant: "icon" | "button";
  versions: TranscriptVersion[];
  restoringVersionId: string | null;
  /** Resolves false when the restore failed; the caller reports why. */
  onRestore: (versionId: string) => Promise<boolean>;
}) {
  const t = useT();
  const formatters = useFormatters();
  const [open, setOpen] = useState(false);
  const label = t("transcriptHistory.title");

  const trigger =
    variant === "icon" ? (
      <Button variant="ghost" size="icon" aria-label={label}>
        <IconHistory className="h-4 w-4" />
      </Button>
    ) : (
      <Button size="sm" variant="outline">
        <IconHistory className="size-4" />
        {label}
      </Button>
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {variant === "icon" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      )}
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <ul className="max-h-80 space-y-0.5 overflow-y-auto p-1.5">
          {versions.map((version) => {
            const restoring = restoringVersionId === version.id;
            return (
              <li
                key={version.id}
                className="flex items-start gap-2 rounded-md px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm text-foreground">
                    {version.preview}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {version.source === IMPORTED_TRANSCRIPT_SOURCE
                      ? t("transcriptImport.imported")
                      : t("transcriptHistory.automatic")}
                    {" · "}
                    {relativeTime(
                      version.replacedAt,
                      formatters.formatRelativeTime,
                    )}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  aria-disabled={restoringVersionId !== null}
                  onClick={() => {
                    if (restoringVersionId !== null) return;
                    // Closed once the transcript it shows is the restored one.
                    void onRestore(version.id).then((restored) => {
                      if (restored) setOpen(false);
                    });
                  }}
                >
                  {restoring ? (
                    <IconLoader2 className="size-4 animate-spin" />
                  ) : null}
                  {t("transcriptHistory.restore")}
                </Button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
