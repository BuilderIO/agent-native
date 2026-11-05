import { useT } from "@agent-native/core/client/i18n";
import {
  PromptComposer,
  type ComposerDraftSnapshot,
  type PromptComposerSubmitOptions,
  type TiptapComposerHandle,
  useEagerFileUploads,
} from "@agent-native/toolkit/app/chat/composer/index";
import { IconLoader2 } from "@tabler/icons-react";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { useSlideFileStorageStatus } from "@/hooks/use-slide-file-storage-status";
import type { SlidesPromptSubmitOptions } from "@/lib/composer-context";
import { isStorageSetupRequiredError } from "@/lib/image-drop-to-agent";
import { isInsidePortaledLayer } from "@/lib/portaled-layer";
import { createSlidesPromptAttachmentAdapter } from "@/lib/prompt-attachment-adapter";
import {
  createPromptChatAttachments,
  type PromptChatAttachment,
} from "@/lib/prompt-chat-attachments";
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
import { GoogleDocImportHint } from "./GoogleDocImportHint";
import type { useSlidesComposerContext } from "./SlidesComposerContext";
import { UploadStorageGate } from "./UploadStorageGate";

const slidesPromptAttachmentAdapter = createSlidesPromptAttachmentAdapter();

export type { PromptImportSelection } from "./use-prompt-import";

export type { UploadedFile } from "@/lib/prompt-file-uploads";

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
  focus(): void;
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
  initialTextOverridesSavedDraft?: boolean;
  onPromptTextChange?: (text: string) => void;
  /** Row rendered inside the composer frame, above the editor. */
  composerHeaderSlot?: React.ReactNode;
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
  anchorRef,
  centered = false,
  presentation = "popover",
  context,
  controllerRef,
  draftScope,
  initialText,
  initialTextKey,
  initialTextOverridesSavedDraft = false,
  onPromptTextChange,
  composerHeaderSlot,
  initialModelSelection,
  onBeforeUpload,
  onRetainedAttachmentsAbandoned,
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
  const [storagePromptOpen, setStoragePromptOpen] = useState(false);
  const activeAttachmentFilesRef = useRef<File[]>([]);
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

  // Position the popover after render so we can measure its actual size
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

  // Close on outside click / escape
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
        ? await createPromptChatAttachments(
            options.attachments,
            [],
            t("agentChat.composer.attachmentTooLarge"), // i18n-key-ignore: shared Toolkit locale key.
          )
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
          t("agentChat.composer.attachmentTooLarge"), // i18n-key-ignore: shared Toolkit locale key.
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
      focus() {
        if (!open || !active || disabled || submissionDisabled) return;
        composerRef.current?.focus();
      },
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
    [
      open,
      active,
      disabled,
      submissionDisabled,
      loading,
      uploading,
      promptText,
    ],
  );

  useEffect(() => {
    if (!open) {
      setPromptText("");
      setGoogleDocContext("");
      if (!submitting && !retainingAttachmentsRef.current) {
        activeAttachmentFilesRef.current = [];
        setSubmitting(false);
        resetEagerUploads();
      }
    }
  }, [open, retainingAttachments, resetEagerUploads, submitting]);

  if (!open) return null;

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
        data-agentkit-composer-size={inline ? "large" : undefined}
        aria-label={title}
        style={inline ? undefined : { top: 0, left: 0, visibility: "visible" }}
      >
        {!inline && (
          <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-3.5">
            <span className="text-sm font-medium text-foreground">{title}</span>
          </div>
        )}

        <div className={inline ? undefined : "px-2.5 pb-2.5"}>
          <PromptComposer
            {...context?.props}
            contextMenuItems={context?.props.contextMenuItems ?? []}
            composerRef={composerRef}
            autoFocus={!inline || (active && open)}
            layoutVariant={inline ? "hero" : undefined}
            className={inline ? "slides-home-prompt-composer-area" : undefined}
            voiceEnabled
            voiceChatEnabled={false}
            attachmentsEnabled={active && fileStorageConfigured}
            attachmentAdapter={slidesPromptAttachmentAdapter}
            inlineTextAttachments={false}
            showModelSelector={showModelSelector}
            modelStatusChecksEnabled={modelStatusChecksEnabled}
            requireAgentEngine={requireAgentEngine}
            showMissingApiKeySetup={showMissingApiKeySetup}
            submissionDisabled={submissionDisabled}
            maxDocumentAttachmentBytes={MAX_REFERENCE_FILE_BYTES}
            documentAttachmentLimitLabel="Slides reference files"
            disabled={disabled || loading || uploading || submitting}
            submitting={submitting}
            placeholder={placeholder}
            onSubmit={handleSubmit}
            onBeforeSubmit={onBeforeSubmit}
            onAttachmentsChange={handleAttachmentsChange}
            onTextChange={(text) => {
              setPromptText(text);
              onPromptTextChange?.(text);
            }}
            headerSlot={composerHeaderSlot}
            draftScope={draftScope}
            initialText={initialText}
            initialTextKey={initialTextKey}
            initialTextOverridesSavedDraft={initialTextOverridesSavedDraft}
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

        {children}
        {context?.dialogs}

        <GoogleDocImportHint
          promptText={promptText}
          onSourceContextChange={setGoogleDocContext}
        />
      </div>
    </>
  );

  return inline ? popover : createPortal(popover, document.body);
}
