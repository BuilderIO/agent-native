import {
  PromptComposer,
  type PromptComposerSubmitOptions,
  type TiptapComposerHandle,
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
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import type { SlidesPromptSubmitOptions } from "@/lib/composer-context";
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
import type { useSlidesComposerContext } from "./SlidesComposerContext";
import {
  usePromptImport,
  type PromptImportSelection,
  type PromptImportSource,
} from "./use-prompt-import";

export type {
  PromptImportSelection,
  PromptImportSource,
} from "./use-prompt-import";

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

export interface PromptPopoverHandle {
  submitSource(
    prompt: string,
    files: File[],
    sourceContext?: string,
  ): Promise<boolean>;
}

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
    options?: SlidesPromptSubmitOptions,
  ) => void | PromptSubmitResult | Promise<PromptSubmitResult | void>;
  loading?: boolean;
  disabled?: boolean;
  submissionDisabled?: boolean;
  showModelSelector?: boolean;
  modelStatusChecksEnabled?: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  centered?: boolean;
  presentation?: "popover" | "inline";
  context?: ReturnType<typeof useSlidesComposerContext>;
  controllerRef?: React.Ref<PromptPopoverHandle>;
  draftScope?: string;
  initialText?: string;
  initialTextKey?: string | number;
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
  onSubmit,
  loading = false,
  disabled = false,
  submissionDisabled = false,
  showModelSelector,
  modelStatusChecksEnabled,
  anchorRef,
  centered = false,
  presentation = "popover",
  context,
  controllerRef,
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
  const inline = presentation === "inline";
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
  const activeAttachmentFilesRef = useRef<File[]>([]);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pptxInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<TiptapComposerHandle>(null);
  const sourceFilesRef = useRef<File[]>([]);
  const sourceContextRef = useRef<string | undefined>(undefined);
  const [modelSelection, setModelSelection] = useState<
    PromptModelSelection | undefined
  >(initialModelSelection);

  useEffect(() => {
    if (initialModelSelection) setModelSelection(initialModelSelection);
  }, [initialModelSelection]);

  useEffect(() => {
    if (inline && open && initialTextKey !== undefined) {
      composerRef.current?.focus();
    }
  }, [inline, open, initialTextKey]);

  const handleModelChange = useCallback((model: string, engine: string) => {
    setModelSelection((current) => ({ ...current, model, engine }));
  }, []);

  const handleEffortChange = useCallback(
    (effort: NonNullable<PromptModelSelection["effort"]>) => {
      setModelSelection((current) => ({ ...current, effort }));
    },
    [],
  );

  useEffect(() => {
    if (inline || !open || !panelRef.current) return;
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

  useEffect(() => {
    if (inline || !open) return;
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
  }, [inline, open, onOpenChange, anchorRef]);

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
      options?: SlidesPromptSubmitOptions,
    ) => {
      files = [...new Set([...files, ...sourceFilesRef.current])];
      if (sourceFilesRef.current.length) {
        options = {
          ...options,
          attachments: [
            ...(options?.attachments ?? []),
            ...sourceFilesRef.current.map((file) => ({
              name: file.name,
              contentType: file.type,
              file,
            })),
          ],
        };
      }
      const submittedContext =
        [googleDocContext, sourceContextRef.current]
          .filter(Boolean)
          .join("\n\n") || undefined;
      const preUploadChatAttachments = options?.attachments?.length
        ? await createPromptChatAttachments(options.attachments, [])
        : [];
      if (
        onBeforeUpload?.(
          text,
          files,
          submittedContext,
          preUploadChatAttachments,
          options,
        ) === false
      ) {
        return;
      }
      const resolved = context
        ? await context.beforeSend(options?.contextItems)
        : undefined;
      if (resolved)
        options = {
          ...options,
          contextItems: resolved.items,
          slidesContext: resolved.selection,
        };
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
            context: submittedContext,
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
      context,
      onBeforeUpload,
      onSubmit,
      retainFiles,
      uploadFiles,
      t,
    ],
  );

  useImperativeHandle(
    controllerRef,
    () => ({
      async submitSource(prompt, files, sourceContext) {
        if (
          !open ||
          disabled ||
          submissionDisabled ||
          loading ||
          uploading ||
          submittingRef.current ||
          !composerRef.current
        )
          return false;
        sourceFilesRef.current = files;
        sourceContextRef.current = sourceContext;
        try {
          return await composerRef.current.submitWithText(
            [promptText.trim(), prompt].filter(Boolean).join("\n\n"),
          );
        } finally {
          sourceFilesRef.current = [];
          sourceContextRef.current = undefined;
        }
      },
    }),
    [open, disabled, submissionDisabled, loading, uploading, promptText],
  );

  const { importingSource, runImport } = usePromptImport({
    onImport,
    onSuccess: () => onOpenChange(false),
    onError: (description) =>
      toast.error(t("raw.uploadFailed"), { description }),
  });

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
      {!inline && centered && (
        <div
          className="fixed inset-0 bg-black/40 z-[199]"
          onClick={() => onOpenChange(false)}
        />
      )}
      <div
        ref={panelRef}
        className={
          inline
            ? "w-full"
            : "fixed z-[200] w-[min(500px,calc(100vw-24px))] rounded-xl border border-border/80 bg-popover shadow-xl shadow-black/15"
        }
        role={inline ? "group" : "dialog"}
        aria-modal={inline ? undefined : true}
        aria-label={title}
        style={inline ? undefined : { top: 0, left: 0, visibility: "visible" }}
      >
        {!inline && (
          <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-3.5">
            <span className="text-sm font-medium text-foreground">{title}</span>
          </div>
        )}

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
            <div className={inline ? undefined : "px-2.5 pb-2.5"}>
              <PromptComposer
                {...context?.props}
                contextMenuItems={context?.props.contextMenuItems ?? []}
                composerRef={composerRef}
                autoFocus={!inline}
                layoutVariant={inline ? "hero" : undefined}
                className={
                  inline ? "slides-home-prompt-composer-area" : undefined
                }
                attachmentsEnabled
                showModelSelector={showModelSelector}
                modelStatusChecksEnabled={modelStatusChecksEnabled}
                submissionDisabled={submissionDisabled}
                maxDocumentAttachmentBytes={MAX_REFERENCE_FILE_BYTES}
                documentAttachmentLimitLabel="Slides reference files"
                disabled={
                  disabled ||
                  loading ||
                  uploading ||
                  submitting ||
                  Boolean(importMode)
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
              <div
                className={
                  inline
                    ? "px-1 pb-1 pt-2"
                    : "border-t border-border/60 px-4 pb-3 pt-2.5"
                }
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-muted-foreground">
                    {importFromCopy}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={
                      inline
                        ? undefined
                        : "h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                    }
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
                    className={
                      inline
                        ? undefined
                        : "h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                    }
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
                    className={
                      inline
                        ? undefined
                        : "h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                    }
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
            {context?.dialogs}

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

  return inline ? popover : createPortal(popover, document.body);
}
