import { useT } from "@agent-native/core/client/i18n";
import {
  PromptComposer,
  useEagerFileUploads,
} from "@agent-native/toolkit/app/chat/composer/index";
import { FileStorageSetupPopover } from "@agent-native/toolkit/app/chat/FileStorageSetupPopover";
import { appStorageKey } from "@shared/app-storage";
import { IconCopy, IconSquarePlus, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { GoogleDocImportHint } from "@/components/editor/GoogleDocImportHint";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useSlideFileStorageStatus } from "@/hooks/use-slide-file-storage-status";
import { addSlideAgentMessage } from "@/lib/agent-visible-message";
import {
  NO_UPLOADED_FILES_CONTEXT,
  WEBSITE_STYLE_REFERENCE_DIRECTIVE,
} from "@/lib/create-deck-generation";
import { isStorageSetupRequiredError } from "@/lib/image-drop-to-agent";
import { isInsidePortaledLayer } from "@/lib/portaled-layer";
import {
  deleteUploadedPromptFile,
  formatPromptUploadFailure,
  isPromptUploadAuthRequiredError,
  isPromptUploadLimitError,
  isPromptUploadNetworkError,
  isPromptUploadStorageStatusError,
  uploadPromptFiles,
  type UploadedFile,
} from "@/lib/prompt-file-uploads";

import { MAX_REFERENCE_FILE_BYTES } from "../../../shared/upload-types";

const MAX_SOURCE_CONTEXT_CHARS = 60_000;

function truncateSourceForContext(prompt: string): {
  text: string;
  truncated: boolean;
} {
  if (prompt.length <= MAX_SOURCE_CONTEXT_CHARS) {
    return { text: prompt, truncated: false };
  }
  return {
    text: prompt.slice(0, MAX_SOURCE_CONTEXT_CHARS),
    truncated: true,
  };
}

function describeUploadedFilesForAgent(
  files: UploadedFile[],
  deckId: string,
): string {
  if (files.length === 0) {
    return ["", NO_UPLOADED_FILES_CONTEXT].join("\n");
  }
  const fileList = files
    .map(
      (f) =>
        `- ${f.originalName} (${f.type}, ${(f.size / 1024).toFixed(1)}KB) at path: ${f.path}${f.url ? `; embeddable URL: ${f.url}` : ""}`,
    )
    .join("\n");
  return [
    "",
    `The user uploaded ${files.length} file(s). These paths are real uploaded files; process them with import actions before using their contents:`,
    fileList,
    "",
    "File handling rules:",
    `- PPTX files: call \`import-pptx --filePath "<path>" --deckId ${deckId}\` when the user wants the deck/slides imported, or to extract slide source from a presentation.`,
    `- PDF and DOCX files: call \`import-file --filePath "<path>" --format auto --deckId ${deckId}\` and use the returned extracted text as source material. For a visual PDF whose original layout should be preserved, pass \`--importIntoDeck true\` instead of rebuilding the pages from extracted text.`,
    "- Text-like files: use the uploaded-text-file blocks already included in the prompt; do not call import-file for them.",
    '- Image files with an embeddable URL can be inserted directly into slide HTML as `<img src="...">` or used as visual references.',
    "- Image files without a URL are visual/reference assets only; do not claim to have processed a PPTX/PDF/DOCX unless the relevant import action succeeds.",
  ].join("\n");
}
export function AddSlidePopover({
  open,
  onOpenChange,
  anchorRef,
  deckId,
  deckTitle,
  activeSlideId,
  slideCount,
  activeSlideIndex,
  agentSubmit,
  onDuplicateCurrent,
  onAddEmpty,
  placement = "below",
  targetSlideId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  deckId: string;
  deckTitle: string;
  activeSlideId: string;
  slideCount: number;
  activeSlideIndex: number;
  agentSubmit: (message: string, context: string) => Promise<boolean>;
  onDuplicateCurrent?: () => void;
  onAddEmpty?: () => void;
  placement?: "below" | "right";
  targetSlideId?: string;
}) {
  const t = useT();
  const storageQuery = useSlideFileStorageStatus(open);
  const fileStorageConfigured =
    storageQuery.data?.configured === true && !storageQuery.isError;
  const panelRef = useRef<HTMLDivElement>(null);
  const virtualAnchor = useMemo(
    () => ({
      current: {
        get contextElement() {
          return anchorRef.current ?? document.body;
        },
        getBoundingClientRect: () =>
          anchorRef.current?.getBoundingClientRect() ??
          new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0),
      },
    }),
    [anchorRef],
  );
  const [promptText, setPromptText] = useState("");
  const [googleDocContext, setGoogleDocContext] = useState("");
  const [storagePromptOpen, setStoragePromptOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const handleRetainedFilesAbandoned = useCallback(
    (_files: readonly File[], discard: () => void) => {
      if (!submittingRef.current) discard();
    },
    [],
  );
  const uploadPromptFilesWithStorageMessage = useCallback(
    (files: File[]) =>
      uploadPromptFiles(files, t("home.referenceFileStorageUnavailable")),
    [t],
  );
  const {
    commitFiles,
    discardFiles,
    retainFiles,
    syncFiles,
    uploadFiles,
    uploading,
    reset: resetEagerUploads,
  } = useEagerFileUploads(uploadPromptFilesWithStorageMessage, {
    onDiscard: deleteUploadedPromptFile,
    onRetainedFilesAbandoned: handleRetainedFilesAbandoned,
  });

  useEffect(() => {
    if (fileStorageConfigured) setStoragePromptOpen(false);
  }, [fileStorageConfigured]);

  const handleSubmit = useCallback(
    async (text: string, files: File[]) => {
      if (files.length > 0 && !fileStorageConfigured) return;
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        let uploaded: UploadedFile[] = [];
        if (files.length > 0) {
          try {
            uploaded = await uploadFiles(files);
          } catch (error) {
            const storageSetupRequired = isStorageSetupRequiredError(error);
            if (storageSetupRequired) void storageQuery.refetch();
            toast.error(t("editorSidebar.uploadFailed"), {
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
                        : isPromptUploadStorageStatusError(error)
                          ? t("editorToolbar.importFailedDescription")
                          : error instanceof Error
                            ? error.message
                            : t("editorSidebar.uploadAttachedFileFailed"),
              ),
            });
            return;
          }
        }

        const googleDocSourceForContext =
          truncateSourceForContext(googleDocContext);
        const fileContext = describeUploadedFilesForAgent(uploaded, deckId);
        const context = targetSlideId
          ? [
              `Fill in slide ${activeSlideIndex + 1} of ${slideCount} (id: ${targetSlideId}) in deck "${deckTitle}" (id: ${deckId}).`,
              "This slide already exists as a blank placeholder that the user just inserted — update it with `update-slide`, do not call `add-slide` for it.",
              "The visible user message above contains the user's request and/or pasted source material for this slide. Treat pasted memo content as source material even if the user did not explicitly say they are pasting it.",
              `Before authoring this slide, call \`get-deck\` with id="${deckId}" and compact=true. Reuse its linked designSystem.agentContext and deckStyle; if it returns a designSystemId, call \`get-design-system\` with that id before generating. Do not fall back to generic styling.`,
              WEBSITE_STYLE_REFERENCE_DIRECTIVE,
              googleDocSourceForContext.text,
              googleDocSourceForContext.truncated
                ? `The pasted source was longer than ${MAX_SOURCE_CONTEXT_CHARS} characters, so only the first ${MAX_SOURCE_CONTEXT_CHARS} characters were included to keep the agent request reliable.`
                : "",
              fileContext,
              "",
              "Every slide is rendered into a fixed native canvas (default 16:9 is 960x540 CSS pixels). Keep the slide within the density limits in AGENTS.md; split dense source material across more slides instead of packing it tightly.",
              "If the user asked for more than one slide's worth of content, update this slide with the first one, then call `add-slide` for the rest, positioned starting right after this slide.",
            ].join("\n")
          : [
              `Add a new slide to deck "${deckTitle}" (id: ${deckId}).`,
              `Insert after slide ${activeSlideIndex + 1} of ${slideCount} (active slide id: ${activeSlideId}).`,
              "The visible user message above contains the user's request and/or pasted source material for the new slide(s). Treat pasted memo content as source material even if the user did not explicitly say they are pasting it.",
              `Before authoring these slides, call \`get-deck\` with id="${deckId}" and compact=true. Reuse its linked designSystem.agentContext and deckStyle; if it returns a designSystemId, call \`get-design-system\` with that id before generating. Do not fall back to generic styling.`,
              WEBSITE_STYLE_REFERENCE_DIRECTIVE,
              googleDocSourceForContext.text,
              googleDocSourceForContext.truncated
                ? `The pasted source was longer than ${MAX_SOURCE_CONTEXT_CHARS} characters, so only the first ${MAX_SOURCE_CONTEXT_CHARS} characters were included to keep the agent request reliable.`
                : "",
              fileContext,
              "",
              "Create the slide content and insert it at the correct position using `add-slide` with --deckId=" +
                deckId +
                ".",
              "Every slide is rendered into a fixed native canvas (default 16:9 is 960x540 CSS pixels). Keep each slide within the density limits in AGENTS.md; split dense source material across more slides instead of packing it tightly.",
              "If the user asked for multiple slides, call `add-slide` once per slide. Use positions starting at " +
                (activeSlideIndex + 1) +
                " so the new slides land after the active slide in order.",
              "For larger requests, keep adding slides sequentially: wait for each add-slide result, then call add-slide for the next slide. Start slide 1 immediately; do not wait to design the entire sequence before adding it.",
            ].join("\n");

        retainFiles(files);
        try {
          const started = await agentSubmit(
            addSlideAgentMessage(text),
            context,
          );
          if (!started) {
            discardFiles(files);
            return;
          }
          commitFiles(files);
          onOpenChange(false);
        } catch (error) {
          discardFiles(files);
          throw error;
        }
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [
      activeSlideId,
      activeSlideIndex,
      agentSubmit,
      commitFiles,
      discardFiles,
      deckId,
      deckTitle,
      fileStorageConfigured,
      googleDocContext,
      onOpenChange,
      slideCount,
      retainFiles,
      storageQuery.refetch,
      t,
      targetSlideId,
      uploadFiles,
    ],
  );
  const handleAttachmentsChange = useCallback(
    (files: File[]) => {
      if (!fileStorageConfigured) return;
      syncFiles(files);
      void uploadFiles(files).catch((error) => {
        const storageSetupRequired = isStorageSetupRequiredError(error);
        if (storageSetupRequired) void storageQuery.refetch();
        toast.error(t("editorSidebar.uploadFailed"), {
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
                    : isPromptUploadStorageStatusError(error)
                      ? t("editorToolbar.importFailedDescription")
                      : error instanceof Error
                        ? error.message
                        : t("editorSidebar.uploadAttachedFileFailed"),
          ),
        });
      });
    },
    [fileStorageConfigured, storageQuery.refetch, syncFiles, t, uploadFiles],
  );

  useEffect(() => {
    if (!open && !submitting) {
      setPromptText("");
      setGoogleDocContext("");
      resetEagerUploads();
    }
  }, [open, resetEagerUploads, submitting]);

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submittingRef.current) return;
        onOpenChange(nextOpen);
      }}
    >
      <PopoverAnchor virtualRef={virtualAnchor} />
      <PopoverContent
        ref={panelRef}
        data-add-slide-popover
        side={placement === "right" ? "right" : "bottom"}
        align="start"
        sideOffset={8}
        collisionPadding={12}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (submittingRef.current || isInsidePortaledLayer(event.target)) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (submittingRef.current) event.preventDefault();
        }}
        className="max-h-[calc(100dvh-24px)] w-[min(420px,calc(100vw-24px))] overflow-y-auto rounded-xl p-3 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="text-sm font-medium text-foreground/90">
            {targetSlideId
              ? t("editorSidebar.describeThisSlide")
              : t("editorSidebar.addSlides")}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onOpenChange(false)}
            aria-label={t("editorSidebar.closeAddSlides")}
            disabled={submitting}
            className="size-5 p-0 text-muted-foreground hover:text-foreground/70 active:scale-100 [&_svg]:size-3.5"
          >
            <IconX className="size-3.5" />
          </Button>
        </div>
        {(onAddEmpty || (onDuplicateCurrent && slideCount > 0)) && (
          <>
            {onAddEmpty && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onAddEmpty();
                  onOpenChange(false);
                }}
                disabled={submitting}
                className="mb-1 h-auto w-full cursor-pointer justify-start rounded-md px-2.5 py-2 text-left text-sm font-normal text-foreground/90 transition-colors active:scale-100"
              >
                <IconSquarePlus className="w-4 h-4 text-muted-foreground" />
                <span>{t("editorSidebar.addEmptySlide")}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {t("editorSidebar.noAi")}
                </span>
              </Button>
            )}
            {onDuplicateCurrent && slideCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  onDuplicateCurrent();
                  onOpenChange(false);
                }}
                disabled={submitting}
                className="mb-2 h-auto w-full cursor-pointer justify-start rounded-md px-2.5 py-2 text-left text-sm font-normal text-foreground/90 transition-colors active:scale-100"
              >
                <IconCopy className="w-4 h-4 text-muted-foreground" />
                <span>{t("editorSidebar.duplicateCurrentSlide")}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {t("editorSidebar.noAi")}
                </span>
              </Button>
            )}
            <div className="-mx-3 mb-2 h-px bg-border" />
          </>
        )}
        <PromptComposer
          autoFocus
          requireAgentEngine
          attachmentsEnabled={fileStorageConfigured}
          maxDocumentAttachmentBytes={MAX_REFERENCE_FILE_BYTES}
          documentAttachmentLimitLabel="Slides reference files"
          placeholder={t("editorSidebar.promptPlaceholder")}
          draftScope={appStorageKey(`add-slide:${deckId}`)}
          disabled={uploading || submitting}
          onSubmit={handleSubmit}
          onAttachmentsChange={handleAttachmentsChange}
          onAttachmentRequest={
            fileStorageConfigured ? undefined : () => setStoragePromptOpen(true)
          }
          onTextChange={setPromptText}
        />
        <FileStorageSetupPopover
          open={storagePromptOpen && !fileStorageConfigured}
          onOpenChange={setStoragePromptOpen}
          onConnected={() => void storageQuery.refetch()}
          anchorRef={panelRef}
          {...(!storageQuery.isSuccess || storageQuery.isError
            ? {
                status: "unavailable" as const,
                onRetry: () => void storageQuery.refetch(),
              }
            : { status: "missing" as const })}
        />
        <div className="-mx-1 mt-2">
          <GoogleDocImportHint
            promptText={promptText}
            onSourceContextChange={setGoogleDocContext}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
