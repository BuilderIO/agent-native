import { useT } from "@agent-native/core/client/i18n";
import {
  MAX_TRANSCRIPT_IMPORT_CHARS,
  parseTranscriptImport,
  TRANSCRIPT_IMPORT_ACCEPT,
  transcriptInTheWay,
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
  /** With replace: the import the user agreed to replace, or null. */
  replaceImportId?: string | null;
}

/** A picked file waiting on the user's answer to "Replace transcript?". */
export interface TranscriptReplacement {
  fileName: string;
  text: string;
  /** The transcript the question is about; null when it wasn't imported. */
  importId: string | null;
}

export function TranscriptImportButton({
  variant,
  durationMs,
  hasReadyTranscript,
  readyImportId,
  isImporting,
  onImport,
  replacement,
  onReplacementChange,
}: {
  variant: "icon" | "button";
  durationMs?: number | null;
  hasReadyTranscript: boolean;
  readyImportId: string | null;
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

  async function submit(
    file: { fileName: string; text: string },
    replacing: { importId: string | null } | null,
  ) {
    try {
      await onImport({
        text: file.text,
        replace: replacing !== null,
        ...(replacing ? { replaceImportId: replacing.importId } : {}),
      });
    } catch (error) {
      // A transcript became ready, or another replaced the one the user
      // agreed to, since this panel last loaded: ask about the one there now.
      const inTheWay = transcriptInTheWay(error);
      if (inTheWay) onReplacementChange({ ...file, ...inTheWay });
    }
  }

  async function handleFile(file: File) {
    // UTF-8 spends at most four bytes on a character, so a larger file is
    // over the character cap without reading it into memory.
    if (file.size > MAX_TRANSCRIPT_IMPORT_CHARS * 4) {
      rejectFile(file.name, { code: "too-large", line: null });
      return;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      // The file can be moved, or lose its permission, after it is picked.
      toast.error(t("transcriptImport.invalidFile", { fileName: file.name }));
      return;
    }
    let text: string;
    try {
      // file.text() would turn a legacy-encoded file's accents into U+FFFD
      // and store that as the transcript of record.
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      toast.error(t("transcriptImport.invalidFile", { fileName: file.name }), {
        description: t("transcriptImport.errorNotUtf8"),
      });
      return;
    }
    const parsed = parseTranscriptImport(text, { durationMs });
    if (!parsed.ok) {
      rejectFile(file.name, parsed.error);
      return;
    }
    if (hasReadyTranscript) {
      onReplacementChange({
        fileName: file.name,
        text,
        importId: readyImportId,
      });
      return;
    }
    await submit({ fileName: file.name, text }, null);
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
                  const { importId, ...file } = replacement;
                  void submit(file, { importId });
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
