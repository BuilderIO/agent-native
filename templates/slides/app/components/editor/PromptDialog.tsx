import {
  PromptComposer,
  type PromptComposerSubmitOptions,
  useEagerFileUploads,
} from "@agent-native/core/client/composer";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconBrandGoogle,
  IconFileTypePdf,
  IconLoader2,
  IconPresentation,
  IconUpload,
} from "@tabler/icons-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { isInsidePortaledLayer } from "@/lib/portaled-layer";
import {
  deleteUploadedPromptFile,
  uploadPromptFiles,
  type UploadedFile,
} from "@/lib/prompt-file-uploads";

import { MAX_REFERENCE_FILE_BYTES } from "../../../shared/upload-types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { GoogleDocImportHint } from "./GoogleDocImportHint";
import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";

export type { UploadedFile } from "@/lib/prompt-file-uploads";

export interface PromptChatAttachment {
  type: "file";
  name: string;
  contentType?: string;
  displayOnly: true;
  text?: string;
}
export async function createPromptChatAttachments(
  attachments: ReadonlyArray<unknown> | undefined,
  uploaded: UploadedFile[],
): Promise<PromptChatAttachment[]> {
  const result: PromptChatAttachment[] = [];
  let uploadedIndex = 0;

  for (const raw of attachments ?? []) {
    const attachment = raw as {
      name?: unknown;
      contentType?: unknown;
      file?: File;
    };
    const name =
      typeof attachment.name === "string"
        ? attachment.name
        : attachment.file?.name;
    if (!name) continue;

    if (name.startsWith("pasted-text-")) {
      let text: string | undefined;
      try {
        text = await attachment.file?.text();
      } catch {
        text = undefined;
      }
      result.push({
        type: "file",
        name,
        contentType:
          typeof attachment.contentType === "string"
            ? attachment.contentType
            : "text/plain",
        displayOnly: true,
        ...(text !== undefined ? { text } : {}),
      });
      continue;
    }

    const uploadedFile = uploaded[uploadedIndex++];
    const isImage =
      uploadedFile?.type.startsWith("image/") ||
      Boolean(attachment.file?.type.startsWith("image/"));
    if (uploadedFile && isImage && (uploadedFile.url || uploadedFile.dataUrl)) {
      continue;
    }
    result.push({
      type: "file",
      name: uploadedFile?.originalName ?? name,
      contentType:
        uploadedFile?.type ??
        (typeof attachment.contentType === "string"
          ? attachment.contentType
          : undefined),
      displayOnly: true,
    });
  }

  return result;
}

export type PromptImportSource = "pdf" | "pptx" | "google-slides";

export type PromptImportSelection =
  | { kind: "pdf" | "pptx"; files: File[] }
  | { kind: "google-slides"; url: string };

export interface PromptAttachmentActions {
  commit: () => void;
  discard: () => void;
  attachments: ReadonlyArray<PromptChatAttachment>;
  context?: string;
}

export type PromptSubmitResult = "commit" | "retain" | "discard";

type PromptModelSelection = Pick<
  PromptComposerSubmitOptions,
  "model" | "engine" | "effort"
>;

interface PromptPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder?: string;
  onSkip?: () => void;
  skipLabel?: string;
  onSubmit: (
    prompt: string,
    files: UploadedFile[],
    attachments: PromptAttachmentActions,
    options?: PromptComposerSubmitOptions,
  ) => void | PromptSubmitResult | Promise<PromptSubmitResult | void>;
  loading?: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  centered?: boolean;
  /** Forwarded to PromptComposer/TipTap for draft persistence in localStorage. */
  draftScope?: string;
  initialText?: string;
  initialTextKey?: string | number;
  /** Restore a model choice when a prompt is replayed after auth or setup recovery. */
  initialModelSelection?: PromptModelSelection;
  onBeforeUpload?: (
    prompt: string,
    files: File[],
    context?: string,
    attachments?: ReadonlyArray<PromptChatAttachment>,
    options?: PromptComposerSubmitOptions,
  ) => boolean | void;
  onRetainedAttachmentsAbandoned?: () => void;
  onImport?: (
    selection: PromptImportSelection,
  ) => Promise<boolean | void> | boolean | void;
  importFromLabel?: string;
  importingLabel?: string;
  children?: React.ReactNode;
}

export default function PromptPopover({
  open,
  onOpenChange,
  title,
  placeholder = "Describe what you want...",
  onSkip,
  skipLabel = "Skip prompt",
  onSubmit,
  loading = false,
  anchorRef,
  centered = false,
  draftScope,
  initialText,
  initialTextKey,
  initialModelSelection,
  onBeforeUpload,
  onRetainedAttachmentsAbandoned,
  onImport,
  importFromLabel,
  importingLabel = "Importing...",
  children,
}: PromptPopoverProps) {
  const t = useT();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [retainingAttachments, setRetainingAttachments] = useState(false);
  const retainingAttachmentsRef = useRef(false);
  const [promptText, setPromptText] = useState("");
  const [googleDocContext, setGoogleDocContext] = useState("");
  const [googleSlidesUrl, setGoogleSlidesUrl] = useState("");
  const [importMode, setImportMode] = useState<PromptImportSource | null>(null);
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(
    null,
  );
  const [importingSource, setImportingSource] =
    useState<PromptImportSource | null>(null);
  const activeAttachmentFilesRef = useRef<File[]>([]);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pptxInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [modelSelection, setModelSelection] = useState<
    PromptModelSelection | undefined
  >(initialModelSelection);

  useEffect(() => {
    if (initialModelSelection) setModelSelection(initialModelSelection);
  }, [initialModelSelection]);

  const handleModelChange = useCallback((model: string, engine: string) => {
    setModelSelection((current) => ({ ...current, model, engine }));
  }, []);

  const handleEffortChange = useCallback(
    (effort: NonNullable<PromptModelSelection["effort"]>) => {
      setModelSelection((current) => ({ ...current, effort }));
    },
    [],
  );

  // Position the popover after render so we can measure its actual size
  useEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const MARGIN = 12;

    if (centered || !anchorRef?.current) {
      panel.style.top = "50%";
      panel.style.left = "50%";
      panel.style.transform = "translate(-50%, -50%)";
      return;
    }

    const anchor = anchorRef.current.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = anchor.bottom + MARGIN;
    if (top + panelRect.height > vh - MARGIN) {
      top = Math.max(MARGIN, anchor.top - panelRect.height - MARGIN);
    }

    const anchorCenterX = anchor.left + anchor.width / 2;
    let left = anchorCenterX - panelRect.width / 2;
    if (left + panelRect.width > vw - MARGIN) {
      left = vw - panelRect.width - MARGIN;
    }
    if (left < MARGIN) left = MARGIN;

    panel.style.top = top + "px";
    panel.style.left = left + "px";
    panel.style.right = "auto";
    panel.style.transform = "none";
  });

  // Close on outside click / escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (isInsidePortaledLayer(e.target)) return;
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        (!anchorRef?.current || !anchorRef.current.contains(e.target as Node))
      ) {
        onOpenChange(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onOpenChange, anchorRef]);

  const deleteUploadedFile = useCallback(deleteUploadedPromptFile, []);

  const handleRetainedFilesAbandoned = useCallback(
    (_files: readonly File[], discard: () => void) => {
      if (retainingAttachmentsRef.current) {
        if (onRetainedAttachmentsAbandoned) {
          onRetainedAttachmentsAbandoned();
        } else {
          discard();
        }
        return;
      }
      if (!submittingRef.current) discard();
    },
    [onRetainedAttachmentsAbandoned],
  );

  const {
    commitFiles,
    discardFiles,
    retainFiles,
    uploadFiles,
    uploading,
    reset: resetEagerUploads,
    syncFiles,
  } = useEagerFileUploads(uploadPromptFiles, {
    onDiscard: deleteUploadedFile,
    onRetainedFilesAbandoned: handleRetainedFilesAbandoned,
  });

  const handleAttachmentsChange = useCallback(
    (files: File[]) => {
      if (files.length === 0 && retainingAttachmentsRef.current) return;
      activeAttachmentFilesRef.current = files;
      syncFiles(files);
      if (files.length === 0) return;
      if (
        onBeforeUpload?.(
          promptText,
          files,
          googleDocContext || undefined,
          undefined,
          modelSelection,
        ) === false
      )
        return;
      const uploadBatch = files;
      void uploadFiles(uploadBatch).catch((error) => {
        if (
          !uploadBatch.some((file) =>
            activeAttachmentFilesRef.current.includes(file),
          )
        )
          return;
        toast.error(t("raw.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("raw.uploadAttachedFailed"),
        });
      });
    },
    [
      googleDocContext,
      modelSelection,
      onBeforeUpload,
      promptText,
      syncFiles,
      t,
      uploadFiles,
    ],
  );

  const handleSubmit = useCallback(
    async (
      text: string,
      files: File[],
      _references: unknown[],
      options?: PromptComposerSubmitOptions,
    ) => {
      const preUploadChatAttachments = options?.attachments?.length
        ? await createPromptChatAttachments(options.attachments, [])
        : [];
      if (
        onBeforeUpload?.(
          text,
          files,
          googleDocContext || undefined,
          preUploadChatAttachments,
          options,
        ) === false
      ) {
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const uploaded = await uploadFiles(files);
        const chatAttachments = await createPromptChatAttachments(
          options?.attachments,
          uploaded,
        );
        retainFiles(files);
        const result = await onSubmit(
          text,
          uploaded,
          {
            commit: () => {
              commitFiles(files);
              retainingAttachmentsRef.current = false;
              setRetainingAttachments(false);
            },
            discard: () => {
              discardFiles(files);
              retainingAttachmentsRef.current = false;
              setRetainingAttachments(false);
            },
            attachments: chatAttachments,
            context: googleDocContext || undefined,
          },
          options,
        );
        if (result === "retain") {
          retainingAttachmentsRef.current = true;
          setRetainingAttachments(true);
        } else if (result === "discard") {
          discardFiles(files);
          retainingAttachmentsRef.current = false;
        } else {
          commitFiles(files);
          retainingAttachmentsRef.current = false;
        }
        setSubmitting(false);
        submittingRef.current = false;
      } catch (error) {
        discardFiles(files);
        setSubmitting(false);
        submittingRef.current = false;
        toast.error(t("raw.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("raw.uploadAttachedFailed"),
        });
        throw error;
      }
    },
    [
      commitFiles,
      discardFiles,
      googleDocContext,
      onBeforeUpload,
      onSubmit,
      retainFiles,
      uploadFiles,
      t,
    ],
  );

  const runImport = useCallback(
    async (selection: PromptImportSelection) => {
      if (!onImport) return;
      setImportingSource(selection.kind);
      try {
        const shouldClose = await onImport(selection);
        if (shouldClose !== false) onOpenChange(false);
      } catch (error) {
        toast.error(t("raw.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("raw.uploadAttachedFailed"),
        });
      } finally {
        setImportingSource(null);
      }
    },
    [onImport, onOpenChange, t],
  );

  const handleFileImport = useCallback(
    (kind: "pdf" | "pptx", file: File | undefined) => {
      if (!file) return;
      setSelectedImportFile(file);
      void runImport({ kind, files: [file] });
    },
    [runImport],
  );

  const chooseImportMode = useCallback((kind: PromptImportSource) => {
    setImportMode(kind);
    setSelectedImportFile(null);
    setGoogleSlidesUrl("");
  }, []);

  const returnToPrompt = useCallback(() => {
    if (importingSource) return;
    setImportMode(null);
    setSelectedImportFile(null);
    setGoogleSlidesUrl("");
  }, [importingSource]);

  const handleGoogleSlidesImport = useCallback(() => {
    const url = googleSlidesUrl.trim();
    if (!url) return;
    void runImport({ kind: "google-slides", url });
  }, [googleSlidesUrl, runImport]);

  useEffect(() => {
    if (!open) {
      setPromptText("");
      setGoogleDocContext("");
      setGoogleSlidesUrl("");
      setImportMode(null);
      setSelectedImportFile(null);
      setImportingSource(null);
      if (!submitting && !retainingAttachmentsRef.current) {
        activeAttachmentFilesRef.current = [];
        setSubmitting(false);
        resetEagerUploads();
      }
    }
  }, [open, retainingAttachments, resetEagerUploads, submitting]);

  if (!open) return null;

  const importEnabled = Boolean(onImport && importFromLabel);
  const normalizedImportFromLabel = importFromLabel
    ?.trim()
    .replace(/^or\s+/i, "")
    .toLowerCase();
  const importFromCopy = normalizedImportFromLabel
    ? `Or ${normalizedImportFromLabel}`
    : "";
  const importModeLabel =
    importMode === "google-slides"
      ? t("home.googleSlidesReferenceTitle")
      : importMode === "pdf"
        ? "PDF"
        : "PPT";
  const importInputRef = importMode === "pdf" ? pdfInputRef : pptxInputRef;

  const popover = (
    <>
      {centered && (
        <div
          className="fixed inset-0 bg-black/40 z-[199]"
          onClick={() => onOpenChange(false)}
        />
      )}
      <div
        ref={panelRef}
        className="fixed z-[200] w-[min(500px,calc(100vw-24px))] rounded-xl border border-border/80 bg-popover shadow-xl shadow-black/15"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ top: 0, left: 0, visibility: "visible" }}
      >
        <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-3.5">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {onSkip && !importMode && !submitting && (
            <button
              type="button"
              onClick={() => {
                onSkip();
                onOpenChange(false);
              }}
              className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {skipLabel}
            </button>
          )}
        </div>

        {importEnabled && (
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            aria-label={t("editorToolbar.importFile")}
            onChange={(event) => {
              handleFileImport("pdf", event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        )}
        {importEnabled && (
          <input
            ref={pptxInputRef}
            type="file"
            accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="sr-only"
            aria-label={t("editorToolbar.importFile")}
            onChange={(event) => {
              handleFileImport("pptx", event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        )}

        <div className={importEnabled ? "grid" : undefined}>
          <div
            className={[
              importEnabled ? "col-start-1 row-start-1" : "",
              importMode ? "invisible pointer-events-none" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-hidden={importMode ? true : undefined}
          >
            <div className="px-2.5 pb-2.5">
              <PromptComposer
                autoFocus
                attachmentsEnabled
                maxDocumentAttachmentBytes={MAX_REFERENCE_FILE_BYTES}
                documentAttachmentLimitLabel="Slides reference files"
                disabled={
                  loading || uploading || submitting || Boolean(importMode)
                }
                placeholder={placeholder}
                onSubmit={handleSubmit}
                onAttachmentsChange={handleAttachmentsChange}
                onTextChange={setPromptText}
                draftScope={draftScope}
                initialText={initialText}
                initialTextKey={initialTextKey}
                selectedModel={
                  initialModelSelection ? modelSelection?.model : undefined
                }
                selectedEngine={
                  initialModelSelection ? modelSelection?.engine : undefined
                }
                selectedEffort={
                  initialModelSelection ? modelSelection?.effort : undefined
                }
                onModelChange={
                  initialModelSelection ? handleModelChange : undefined
                }
                onEffortChange={
                  initialModelSelection ? handleEffortChange : undefined
                }
                onModelSelectionChange={setModelSelection}
              />
            </div>

            {uploading && (
              <div
                className="flex items-center gap-2 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                <IconLoader2 className="size-3.5 animate-spin" />
                <span>{t("raw.uploading")}</span>
              </div>
            )}

            {importEnabled && (
              <div className="border-t border-border/60 px-4 pb-3 pt-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-muted-foreground">
                    {importFromCopy}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                    disabled={loading || uploading || submitting}
                    onClick={() => chooseImportMode("pdf")}
                  >
                    <IconFileTypePdf className="size-3.5" />
                    PDF
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                    disabled={loading || uploading || submitting}
                    onClick={() => chooseImportMode("google-slides")}
                  >
                    <IconBrandGoogle className="size-3.5" />
                    {t("home.googleSlidesImportLabel")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                    disabled={loading || uploading || submitting}
                    onClick={() => chooseImportMode("pptx")}
                  >
                    <IconPresentation className="size-3.5" />
                    PPT
                  </Button>
                </div>
              </div>
            )}

            {children}

            <GoogleDocImportHint
              promptText={promptText}
              onSourceContextChange={setGoogleDocContext}
            />
          </div>

          {importEnabled && importMode && (
            <div className="col-start-1 row-start-1 flex min-h-full flex-col px-4 pb-4 pt-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={returnToPrompt}
                  disabled={importingSource !== null}
                  className="-ms-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  aria-label={
                    "Back to prompt" /* i18n-ignore -- local import-flow control label */
                  }
                >
                  <IconArrowLeft className="size-4" />
                </button>
                <span className="text-sm font-medium text-foreground">
                  Import {importModeLabel}
                </span>
              </div>

              <div className="flex flex-1 flex-col justify-center gap-3">
                {importMode === "google-slides" ? (
                  <>
                    <GoogleDriveConnectionCta />
                    <div className="flex gap-2">
                      <Input
                        autoFocus
                        type="url"
                        value={googleSlidesUrl}
                        placeholder={t("home.googleSlidesReferenceUrl")}
                        aria-label={t("home.googleSlidesReferenceUrl")}
                        className="h-8 text-xs"
                        disabled={importingSource !== null || loading}
                        onChange={(event) =>
                          setGoogleSlidesUrl(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleGoogleSlidesImport();
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 shrink-0 px-3 text-xs"
                        disabled={
                          !googleSlidesUrl.trim() ||
                          importingSource !== null ||
                          loading
                        }
                        onClick={handleGoogleSlidesImport}
                      >
                        Import
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Choose a {importModeLabel} file to open it as a deck.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-center gap-2"
                      disabled={importingSource !== null || loading}
                      onClick={() => importInputRef.current?.click()}
                    >
                      <IconUpload className="size-4" />
                      Upload {importModeLabel}
                    </Button>
                    {selectedImportFile && (
                      <p className="truncate text-center text-xs text-muted-foreground">
                        {selectedImportFile.name}
                      </p>
                    )}
                  </>
                )}
              </div>

              {importingSource && (
                <div
                  className="flex items-center justify-center gap-2 text-xs text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  <IconLoader2 className="size-3.5 animate-spin" />
                  <span>{importingLabel}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(popover, document.body);
}
