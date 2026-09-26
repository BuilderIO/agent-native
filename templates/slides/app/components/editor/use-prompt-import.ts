import { actionErrorMessage } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { getOversizedDocumentAttachmentError } from "@agent-native/toolkit/composer/TiptapComposer";
import { useCallback, useMemo, useRef, useState } from "react";

import { MAX_REFERENCE_FILE_BYTES } from "../../../shared/upload-types";

export type PromptImportSource = "pdf" | "pptx" | "google-slides";
export type PromptImportSelection =
  | { kind: "pdf" | "pptx"; files: File[] }
  | { kind: "google-slides"; url: string };
export type PromptImportHandler = (
  selection: PromptImportSelection,
) => Promise<boolean | void> | boolean | void;
export type DeckFileKind = "pdf" | "pptx";

export const DECK_FILE_ACCEPT = {
  pdf: ".pdf,application/pdf",
  pptx: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function deckFileKind(file: File): DeckFileKind | null {
  const extension = /\.(pdf|pptx)$/i.exec(file.name)?.[1].toLowerCase();
  if (extension !== "pdf" && extension !== "pptx") return null;
  const mime = DECK_FILE_ACCEPT[extension].split(",")[1];
  return !file.type ||
    file.type === "application/octet-stream" ||
    file.type === mime
    ? extension
    : null;
}

export function usePromptImport({
  onImport,
  onSuccess,
  onError,
}: {
  onImport?: PromptImportHandler;
  onSuccess?: () => void;
  onError?: (message: string, cause?: unknown) => void;
}) {
  const t = useT();
  const [importingSource, setImportingSource] =
    useState<PromptImportSource | null>(null);
  const [error, setError] = useState<string>();
  const [retrySelection, setRetrySelection] = useState<PromptImportSelection>();
  const busy = useRef(false);
  const clear = useCallback(() => {
    if (busy.current) return;
    setError(undefined);
    setRetrySelection(undefined);
  }, []);
  const fail = useCallback(
    (message: string, cause?: unknown) => {
      setError(message);
      onError?.(message, cause);
      return false;
    },
    [onError],
  );

  const runImport = useCallback(
    async (selection: PromptImportSelection) => {
      if (busy.current || !onImport) return false;
      setError(undefined);
      setRetrySelection(undefined);
      if (selection.kind !== "google-slides") {
        const file = selection.files[0];
        if (
          selection.files.length !== 1 ||
          !file ||
          deckFileKind(file) !== selection.kind
        ) {
          return fail(
            t(
              `home.importMenu.invalid${selection.kind === "pdf" ? "Pdf" : "Pptx"}`,
            ),
          );
        }
        const sizeError = getOversizedDocumentAttachmentError(
          [{ name: file.name, contentType: file.type, file }],
          { maxBytes: MAX_REFERENCE_FILE_BYTES, translate: t },
        );
        if (sizeError) return fail(sizeError);
      }
      busy.current = true;
      setImportingSource(selection.kind);
      setRetrySelection(selection);
      try {
        if ((await onImport(selection)) === false) {
          return fail(t("home.importMenu.notStarted"));
        }
        setRetrySelection(undefined);
        onSuccess?.();
        return true;
      } catch (cause) {
        return fail(
          actionErrorMessage(cause) ??
            t("editorToolbar.importFailedDescription"),
          cause,
        );
      } finally {
        busy.current = false;
        setImportingSource(null);
      }
    },
    [onImport, onSuccess, fail, t],
  );

  const importFile = useCallback(
    async (file: File | undefined, scope?: DeckFileKind) => {
      if (!file || busy.current) return false;
      const kind = scope ?? deckFileKind(file);
      if (!kind) {
        setRetrySelection(undefined);
        return fail(t("home.importMenu.invalidFile"));
      }
      return runImport({ kind, files: [file] });
    },
    [fail, runImport, t],
  );

  return useMemo(
    () => ({
      importingSource,
      error,
      retrySelection,
      runImport,
      importFile,
      clear,
    }),
    [importingSource, error, retrySelection, runImport, importFile, clear],
  );
}
