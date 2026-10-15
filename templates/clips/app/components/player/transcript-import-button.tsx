import { useT } from "@agent-native/core/client/i18n";
import {
  isTranscriptExistsError,
  MAX_TRANSCRIPT_IMPORT_CHARS,
  parseTranscriptImport,
  TRANSCRIPT_IMPORT_ACCEPT,
  type TranscriptImportError,
} from "@shared/transcript-import";
import { IconFileUpload, IconLoader2 } from "@tabler/icons-react";
import { useRef } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface TranscriptImportRequest {
  text: string;
  replace: boolean;
}

/** A picked file waiting on the user's answer to "Replace transcript?". */
export interface TranscriptReplacement {
  fileName: string;
  text: string;
}

export function TranscriptImportButton({
  variant,
  durationMs,
  hasReadyTranscript,
  isImporting,
  onImport,
  replacement,
  onReplacementChange,
}: {
  variant: "icon" | "button";
  durationMs?: number | null;
  hasReadyTranscript: boolean;
  isImporting: boolean;
  /** Rejects when the import fails; the caller reports the failure. */
  onImport: (request: TranscriptImportRequest) => Promise<unknown>;
  /**
   * Held by the caller: when a conflict refreshes the panel to its ready
   * state, a different button mounts while the question is still open.
   */
  replacement: TranscriptReplacement | null;
  onReplacementChange: (replacement: TranscriptReplacement | null) => void;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = t("transcriptImport.addFile");

  // aria-disabled, not disabled: a disabled button cannot take the focus the
  // replace dialog hands back while the import is still saving.
  function openPicker() {
    if (!isImporting) inputRef.current?.click();
  }

  function rejectFile(fileName: string, error: TranscriptImportError) {
    toast.error(t("transcriptImport.invalidFile", { fileName }), {
      description: describeImportError(error, t),
    });
  }

  async function submit(fileName: string, text: string, replace: boolean) {
    try {
      await onImport({ text, replace });
    } catch (error) {
      // A transcript became ready after this panel last loaded, so ask
      // before replacing it, as for one that was ready all along.
      if (!replace && isTranscriptExistsError(error)) {
        onReplacementChange({ fileName, text });
      }
    }
  }

  async function handleFile(file: File) {
    // UTF-8 spends at most four bytes on a character, so a larger file is
    // over the character cap without reading it into memory.
    if (file.size > MAX_TRANSCRIPT_IMPORT_CHARS * 4) {
      rejectFile(file.name, { code: "too-large", line: null });
      return;
    }
    const text = await file.text();
    const parsed = parseTranscriptImport(text, { durationMs });
    if (!parsed.ok) {
      rejectFile(file.name, parsed.error);
      return;
    }
    if (hasReadyTranscript) {
      onReplacementChange({ fileName: file.name, text });
      return;
    }
    await submit(file.name, text, false);
  }

  const icon = isImporting ? (
    <IconLoader2 className="size-4 animate-spin" />
  ) : (
    <IconFileUpload className="size-4" />
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={TRANSCRIPT_IMPORT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      {variant === "icon" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={triggerRef}
              variant="ghost"
              size="icon"
              aria-label={label}
              aria-disabled={isImporting}
              onClick={openPicker}
            >
              {icon}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : (
        <Button
          ref={triggerRef}
          size="sm"
          variant="outline"
          aria-disabled={isImporting}
          onClick={openPicker}
        >
          {icon}
          {label}
        </Button>
      )}
      <AlertDialog
        open={replacement !== null}
        onOpenChange={(open) => {
          if (!open) onReplacementChange(null);
        }}
      >
        <AlertDialogContent
          // The dialog opens from a file pick, not a trigger, so Radix has
          // nowhere to return focus and would drop it on the page body.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("transcriptImport.replaceTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("transcriptImport.replaceDescription", {
                fileName: replacement?.fileName ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (replacement) {
                  void submit(replacement.fileName, replacement.text, true);
                }
                onReplacementChange(null);
              }}
            >
              {t("transcriptImport.replace")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function describeImportError(
  error: TranscriptImportError,
  t: ReturnType<typeof useT>,
): string {
  const line = error.line ?? 1;
  switch (error.code) {
    case "empty":
      return t("transcriptImport.errorEmpty");
    case "too-large":
      return t("transcriptImport.errorTooLarge");
    case "missing-timing":
      return t("transcriptImport.errorMissingTiming", { line });
    case "bad-timing":
      return t("transcriptImport.errorBadTiming", { line });
    case "bad-range":
      return t("transcriptImport.errorBadRange", { line });
    case "missing-timestamp":
      return t("transcriptImport.errorMissingTimestamp", { line });
    case "out-of-order":
      return t("transcriptImport.errorOutOfOrder", { line });
    case "past-end":
      return t("transcriptImport.errorPastEnd", { line });
  }
}
