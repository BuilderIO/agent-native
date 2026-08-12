import { appBasePath } from "@agent-native/core/client/api-path";
import { PromptComposer } from "@agent-native/core/client/composer";
import { useT } from "@agent-native/core/client/i18n";
import { IconCopy, IconSquarePlus, IconX } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { GoogleDocImportHint } from "@/components/editor/GoogleDocImportHint";
import {
  isInsidePortaledLayer,
  type UploadedFile,
} from "@/components/editor/PromptDialog";
import { addSlideAgentMessage } from "@/lib/agent-visible-message";

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
  if (files.length === 0) return "";
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
  agentSubmit: (message: string, context: string) => void;
  onDuplicateCurrent?: () => void;
  onAddEmpty?: () => void;
  /** "below" anchors under the trigger button; "right" sits beside a slide thumbnail. */
  placement?: "below" | "right";
  /** Id of a blank slide already inserted — the agent fills it in instead of
   *  inserting another one. Used when this popover follows a "New slide"
   *  click that already created the placeholder. */
  targetSlideId?: string;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [promptText, setPromptText] = useState("");
  const [googleDocContext, setGoogleDocContext] = useState("");

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (isInsidePortaledLayer(e.target)) return;
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
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

  const handleSubmit = useCallback(
    async (text: string, files: File[]) => {
      let uploaded: UploadedFile[] = [];
      if (files.length > 0) {
        try {
          const formData = new FormData();
          files.forEach((f) => formData.append("files", f));
          const res = await fetch(`${appBasePath()}/api/uploads`, {
            method: "POST",
            body: formData,
          });
          if (!res.ok) {
            // coercion-ok: the request already failed; an unparseable error
            // body just falls back to the generic upload-failed message.
            const data = await res.json().catch(() => null);
            throw new Error(data?.error || t("editorSidebar.uploadFailed"));
          }
          uploaded = (await res.json()) as UploadedFile[];
        } catch (error) {
          toast.error(t("editorSidebar.uploadFailed"), {
            description:
              error instanceof Error
                ? error.message
                : t("editorSidebar.uploadAttachedFileFailed"),
          });
          return;
        }
      }

      const trimmedText = text.trim();
      const googleDocSourceForContext =
        truncateSourceForContext(googleDocContext);
      const fileContext = describeUploadedFilesForAgent(uploaded, deckId);
      const context = targetSlideId
        ? [
            `Fill in slide ${activeSlideIndex + 1} of ${slideCount} (id: ${targetSlideId}) in deck "${deckTitle}" (id: ${deckId}).`,
            "This slide already exists as a blank placeholder that the user just inserted — update it with `update-slide`, do not call `add-slide` for it.",
            "The visible user message above contains the user's request and/or pasted source material for this slide. Treat pasted memo content as source material even if the user did not explicitly say they are pasting it.",
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

      agentSubmit(addSlideAgentMessage(trimmedText), context);
      onOpenChange(false);
    },
    [
      activeSlideId,
      activeSlideIndex,
      agentSubmit,
      deckId,
      deckTitle,
      googleDocContext,
      onOpenChange,
      slideCount,
      targetSlideId,
    ],
  );

  useEffect(() => {
    if (!open) {
      setPromptText("");
      setGoogleDocContext("");
    }
  }, [open]);

  if (!open || !anchorRef.current) return null;

  const rect = anchorRef.current.getBoundingClientRect();
  const panelWidth = Math.min(420, window.innerWidth - 24);
  const left =
    placement === "right"
      ? Math.min(rect.right + 8, window.innerWidth - panelWidth - 12)
      : Math.max(12, Math.min(rect.left, window.innerWidth - panelWidth - 12));
  const top =
    placement === "right"
      ? Math.max(12, Math.min(rect.top, window.innerHeight - 12))
      : rect.bottom + 8;

  return createPortal(
    <div
      ref={panelRef}
      className="fixed w-[min(420px,calc(100vw-24px))] rounded-xl border border-border bg-popover shadow-2xl shadow-black/60 z-[200] p-3"
      style={{
        top,
        left,
      }}
    >
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="text-sm font-medium text-foreground/90">
          {targetSlideId
            ? t("editorSidebar.describeThisSlide")
            : t("editorSidebar.addSlides")}
        </p>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label={t("editorSidebar.closeAddSlides")}
          className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground/70"
        >
          <IconX className="size-3.5" />
        </button>
      </div>
      {(onAddEmpty || (onDuplicateCurrent && slideCount > 0)) && (
        <>
          {onAddEmpty && (
            <button
              type="button"
              onClick={() => {
                onAddEmpty();
                onOpenChange(false);
              }}
              className="w-full mb-1 px-2.5 py-2 text-left text-sm rounded-md hover:bg-accent transition-colors flex items-center gap-2 text-foreground/90 cursor-pointer"
            >
              <IconSquarePlus className="w-4 h-4 text-muted-foreground" />
              <span>{t("editorSidebar.addEmptySlide")}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {t("editorSidebar.noAi")}
              </span>
            </button>
          )}
          {onDuplicateCurrent && slideCount > 0 && (
            <button
              type="button"
              onClick={() => {
                onDuplicateCurrent();
                onOpenChange(false);
              }}
              className="w-full mb-2 px-2.5 py-2 text-left text-sm rounded-md hover:bg-accent transition-colors flex items-center gap-2 text-foreground/90 cursor-pointer"
            >
              <IconCopy className="w-4 h-4 text-muted-foreground" />
              <span>{t("editorSidebar.duplicateCurrentSlide")}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {t("editorSidebar.noAi")}
              </span>
            </button>
          )}
          <div className="-mx-3 mb-2 h-px bg-border" />
        </>
      )}
      <PromptComposer
        autoFocus
        maxDocumentAttachmentBytes={MAX_REFERENCE_FILE_BYTES}
        documentAttachmentLimitLabel="Slides reference files"
        placeholder={t("editorSidebar.promptPlaceholder")}
        draftScope={`slides:add-slide:${deckId}`}
        onSubmit={handleSubmit}
        onTextChange={setPromptText}
      />
      <div className="-mx-1 mt-2">
        <GoogleDocImportHint
          promptText={promptText}
          onSourceContextChange={setGoogleDocContext}
        />
      </div>
    </div>,
    document.body,
  );
}
