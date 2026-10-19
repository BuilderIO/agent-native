import { useT } from "@agent-native/core/client/i18n";
import {
  PromptComposer,
  type ComposerDraftSnapshot,
  type PromptComposerSubmitOptions,
  type TiptapComposerHandle,
  useEagerFileUploads,
} from "@agent-native/toolkit/app/chat/composer/index";
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
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSlideFileStorageStatus } from "@/hooks/use-slide-file-storage-status";
import type { SlidesPromptSubmitOptions } from "@/lib/composer-context";
import { isStorageSetupRequiredError } from "@/lib/image-drop-to-agent";
import { createSlidesPromptAttachmentAdapter } from "@/lib/prompt-attachment-adapter";
import {
  deleteUploadedPromptFile,
  formatPromptUploadFailure,
  isPromptUploadAuthRequiredError,
  isPromptUploadLimitError,
  isPromptUploadNetworkError,
  isPromptUploadStorageStatusError,
  isPromptUploadUnsupportedFileTypeError,
  uploadPromptFiles,
  type UploadedFile,
} from "@/lib/prompt-file-uploads";

import { MAX_REFERENCE_FILE_BYTES } from "../../../shared/upload-types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { GoogleDocImportHint } from "./GoogleDocImportHint";
import { GoogleDriveConnectionCta } from "./GoogleDriveConnectionCta";
import type { useSlidesComposerContext } from "./SlidesComposerContext";
import { UploadStorageGate } from "./UploadStorageGate";
import {
  usePromptImport,
  type PromptImportSelection,
  type PromptImportSource,
} from "./use-prompt-import";

const slidesPromptAttachmentAdapter = createSlidesPromptAttachmentAdapter();

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
  /** Send the current draft, with its attachments, as if send were pressed. */
  submitDraft(): Promise<boolean>;
  /** The draft a send would take right now, to compare with one that was held back. */
  getDraftSnapshot(): ComposerDraftSnapshot | null;
}

interface PromptPopoverProps {
  open: boolean;
  active?: boolean;
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
  onBeforeSubmit?: (
    draft?: ComposerDraftSnapshot,
  ) => boolean | Promise<boolean>;
  loading?: boolean;
  disabled?: boolean;
  submissionDisabled?: boolean;
  showModelSelector?: boolean;
  modelStatusChecksEnabled?: boolean;
  requireAgentEngine?: boolean;
  showMissingApiKeySetup?: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  centered?: boolean;
  presentation?: "popover" | "inline";
  context?: ReturnType<typeof useSlidesComposerContext>;
  controllerRef?: React.Ref<PromptPopoverHandle>;
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
    options?: SlidesPromptSubmitOptions,
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
  active = true,
  onOpenChange,
  title,
  placeholder = "Describe what you want...",
  onSubmit,
  onBeforeSubmit,
  loading = false,
  disabled = false,
  submissionDisabled = false,
  showModelSelector,
  modelStatusChecksEnabled,
  requireAgentEngine,
  showMissingApiKeySetup,
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
  const storageQuery = useSlideFileStorageStatus(open && active);
  const fileStorageConfigured =
    storageQuery.data?.configured === true && !storageQuery.isError;
  const inline = presentation === "inline";
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [retainingAttachments, setRetainingAttachments] = useState(false);
  const retainingAttachmentsRef = useRef(false);
  const [promptText, setPromptText] = useState("");
  const [googleDocContext, setGoogleDocContext] = useState("");
  const [googleSlidesUrl, setGoogleSlidesUrl] = useState("");
  const [importMode, setImportMode] = useState<PromptImportSource | null>(null);
  const [storagePromptOpen, setStoragePromptOpen] = useState(false);
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

  const deleteUploadedFile = useCallback(deleteUploadedPromptFile, []);
  const uploadPromptFilesWithStorageMessage = useCallback(
    (files: File[]) =>
      uploadPromptFiles(files, t("home.referenceFileStorageUnavailable")),
    [t],
  );

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
  } = useEagerFileUploads(uploadPromptFilesWithStorageMessage, {
    onDiscard: deleteUploadedFile,
    onRetainedFilesAbandoned: handleRetainedFilesAbandoned,
  });

  const handleAttachmentsChange = useCallback(
    (files: File[]) => {
      if (!fileStorageConfigured) {
        if (files.length > 0) setStoragePromptOpen(true);
        return;
      }
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
        const storageSetupRequired = isStorageSetupRequiredError(error);
        if (storageSetupRequired) void storageQuery.refetch();
        toast.error(t("raw.uploadFailed"), {
          description: formatPromptUploadFailure(
            error,
            storageSetupRequired
              ? t("home.fileStorageSetupRequired")
              : isPromptUploadNetworkError(error)
                ? t("home.importMenu.networkFailed")
                : isPromptUploadAuthRequiredError(error)
                  ? t("home.importMenu.notStarted")
                  : isPromptUploadLimitError(error)
                    ? t("home.importMenu.uploadLimitExceeded")
                    : isPromptUploadUnsupportedFileTypeError(error)
                      ? t("home.importMenu.unsupportedFileType")
                      : isPromptUploadStorageStatusError(error)
                        ? t("editorToolbar.importFailedDescription")
                        : error instanceof Error
                          ? error.message
                          : t("raw.uploadAttachedFailed"),
          ),
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
      fileStorageConfigured,
      storageQuery.refetch,
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
      if (files.length > 0 && !fileStorageConfigured) {
        setStoragePromptOpen(true);
        return;
      }
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
        const storageSetupRequired = isStorageSetupRequiredError(error);
        if (storageSetupRequired) void storageQuery.refetch();
        toast.error(t("raw.uploadFailed"), {
          description: formatPromptUploadFailure(
            error,
            storageSetupRequired
              ? t("home.fileStorageSetupRequired")
              : isPromptUploadNetworkError(error)
                ? t("home.importMenu.networkFailed")
                : isPromptUploadAuthRequiredError(error)
                  ? t("home.importMenu.notStarted")
                  : isPromptUploadLimitError(error)
                    ? t("home.importMenu.uploadLimitExceeded")
                    : isPromptUploadUnsupportedFileTypeError(error)
                      ? t("home.importMenu.unsupportedFileType")
                      : isPromptUploadStorageStatusError(error)
                        ? t("editorToolbar.importFailedDescription")
                        : error instanceof Error
                          ? error.message
                          : t("raw.uploadAttachedFailed"),
          ),
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
      fileStorageConfigured,
      storageQuery.refetch,
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
      async submitDraft() {
        if (
          !open ||
          disabled ||
          submissionDisabled ||
          loading ||
          uploading ||
          submittingRef.current ||
          !composerRef.current?.submit
        )
          return false;
        return composerRef.current.submit();
      },
      getDraftSnapshot() {
        return composerRef.current?.getDraftSnapshot?.() ?? null;
      },
    }),
    [open, disabled, submissionDisabled, loading, uploading, promptText],
  );

  const { importingSource, runImport: runPromptImport } = usePromptImport({
    onImport,
    onSuccess: () => onOpenChange(false),
    onError: (description, cause) => {
      const storageSetupRequired = isStorageSetupRequiredError(cause);
      if (storageSetupRequired) void storageQuery.refetch();
      toast.error(t("raw.uploadFailed"), {
        description: storageSetupRequired
          ? t("home.fileStorageSetupRequired")
          : description,
      });
    },
  });
  const runImport = useCallback(
    (selection: PromptImportSelection) => {
      if (selection.kind !== "google-slides" && !fileStorageConfigured) {
        setStoragePromptOpen(true);
        return Promise.resolve(false);
      }
      return runPromptImport(selection);
    },
    [fileStorageConfigured, runPromptImport],
  );

  const handleFileImport = useCallback(
    (kind: "pdf" | "pptx", file: File | undefined) => {
      if (!file) return;
      if (!fileStorageConfigured) {
        setStoragePromptOpen(true);
        return;
      }
      setSelectedImportFile(file);
      void runImport({ kind, files: [file] });
    },
    [runImport],
  );

  const chooseImportMode = useCallback(
    (kind: PromptImportSource) => {
      if (kind !== "google-slides" && !fileStorageConfigured) {
        setStoragePromptOpen(true);
        return;
      }
      setImportMode(kind);
      setSelectedImportFile(null);
      setGoogleSlidesUrl("");
    },
    [fileStorageConfigured],
  );

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

  if (inline && !open) return null;

  const importEnabled = Boolean(onImport && importFromLabel);
  const normalizedImportFromLabel = importFromLabel
    ?.trim()
    .replace(/^or\s+/i, "")
    .toLowerCase();
  const importFromCopy = normalizedImportFromLabel
    ? t("home.importFromCopy", { source: normalizedImportFromLabel })
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
      <div
        ref={panelRef}
        className={inline ? "w-full" : undefined}
        role={inline ? "group" : undefined}
        aria-label={inline ? title : undefined}
      >
        {!inline && (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
        )}

        {importEnabled && (
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            aria-label={t("editorToolbar.importFile")}
            disabled={!fileStorageConfigured}
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
            disabled={!fileStorageConfigured}
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
                attachmentsEnabled={active && fileStorageConfigured}
                attachmentAdapter={slidesPromptAttachmentAdapter}
                showModelSelector={showModelSelector}
                modelStatusChecksEnabled={modelStatusChecksEnabled}
                requireAgentEngine={requireAgentEngine}
                showMissingApiKeySetup={showMissingApiKeySetup}
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
                submitting={submitting}
                placeholder={placeholder}
                onSubmit={handleSubmit}
                onBeforeSubmit={onBeforeSubmit}
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
                onAttachmentRequest={
                  fileStorageConfigured
                    ? undefined
                    : () => setStoragePromptOpen(true)
                }
              />
            </div>

            <UploadStorageGate
              configured={fileStorageConfigured}
              unavailable={!storageQuery.isSuccess}
              open={storagePromptOpen}
              onOpenChange={setStoragePromptOpen}
              onRetry={() => void storageQuery.refetch()}
              anchorRef={panelRef}
            />

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
                    size="xs"
                    disabled={loading || uploading || submitting}
                    onClick={() => chooseImportMode("pdf")}
                  >
                    <IconFileTypePdf className="size-3.5" />
                    PDF
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={loading || uploading || submitting}
                    onClick={() => chooseImportMode("google-slides")}
                  >
                    <IconBrandGoogle className="size-3.5" />
                    {t("home.googleSlidesImportLabel")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
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
                <Button
                  type="button"
                  variant="ghost-inset"
                  size="icon-sm"
                  onClick={returnToPrompt}
                  disabled={importingSource !== null}
                  className="-ms-1 shrink-0"
                  aria-label={t("home.backToPrompt")}
                >
                  <IconArrowLeft className="size-4" />
                </Button>
                <span className="text-sm font-medium text-foreground">
                  {t("home.importModeTitle", { source: importModeLabel })}
                </span>
              </div>

              <div className="flex flex-1 flex-col justify-center gap-3">
                {importMode === "google-slides" ? (
                  <>
                    <GoogleDriveConnectionCta />
                    <div className="flex gap-2">
                      <Input
                        size="sm"
                        autoFocus
                        type="url"
                        value={googleSlidesUrl}
                        placeholder={t("home.googleSlidesReferenceUrl")}
                        aria-label={t("home.googleSlidesReferenceUrl")}
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
                        className="shrink-0"
                        disabled={
                          !googleSlidesUrl.trim() ||
                          importingSource !== null ||
                          loading
                        }
                        onClick={handleGoogleSlidesImport}
                      >
                        {t("home.importMenu.import")}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {t("home.chooseImportFile", { source: importModeLabel })}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-center"
                      disabled={importingSource !== null || loading}
                      onClick={() => {
                        if (fileStorageConfigured)
                          importInputRef.current?.click();
                        else setStoragePromptOpen(true);
                      }}
                    >
                      <IconUpload className="size-4" />
                      {t("home.uploadImportFile", { source: importModeLabel })}
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

  return inline ? (
    popover
  ) : (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("comments.close")}>{popover}</DialogContent>
    </Dialog>
  );
}
