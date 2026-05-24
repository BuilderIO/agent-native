import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconCopy,
  IconDownload,
  IconDots,
  IconFileText,
  IconMessageCircle,
  IconMusic,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { sendToAgentChat } from "@agent-native/core/client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { audioUploadErrorMessage, uploadAudioFile } from "../image-upload";
import type { ContentAudioOptions } from "./AudioNode";

type AudioSourceTab = "upload" | "link";
type ResizeDirection = "left" | "right";

interface AudioResizeState {
  direction: ResizeDirection;
  maxWidth: number;
  startWidth: number;
  startX: number;
}

const MIN_AUDIO_WIDTH = 260;
const AUDIO_TRANSCRIPT_PLACEHOLDER_LABEL = "Transcribing audio...";

function createTranscriptPlaceholder(label: string): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${label} ${id}`;
}

function normalizedAudioWidth(value: unknown): number | null {
  const width =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.round(width);
}

function clampAudioWidth(width: number, maxWidth: number): number {
  return Math.round(Math.min(Math.max(width, MIN_AUDIO_WIDTH), maxWidth));
}

function audioDownloadName(src: string): string {
  try {
    const pathname = new URL(src).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    if (name) return decodeURIComponent(name);
  } catch {}

  return "audio";
}

async function downloadAudio(src: string) {
  const filename = audioDownloadName(src);

  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error("Download failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success("Audio download started.");
  } catch {
    const anchor = document.createElement("a");
    anchor.href = src;
    anchor.download = filename;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    toast.info("Opened audio in a new tab.");
  }
}

async function copyAudio(src: string) {
  try {
    await navigator.clipboard.writeText(src);
    toast.success("Copied audio URL.");
  } catch {
    toast.error("Could not copy audio.");
  }
}

export function AudioBlock({
  node,
  editor,
  deleteNode,
  selected,
  updateAttributes,
  extension,
  getPos,
}: NodeViewProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [sourcePanelDismissed, setSourcePanelDismissed] = useState(false);
  const [sourceTab, setSourceTab] = useState<AudioSourceTab>("upload");
  const [audioUrl, setAudioUrl] = useState("");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emptyBlockRef = useRef<HTMLDivElement>(null);
  const lightboxAudioRef = useRef<HTMLAudioElement>(null);
  const mediaBlockRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<AudioResizeState | null>(null);
  const hoverHideTimeoutRef = useRef<number | null>(null);
  const isEditable = editor.isEditable;
  const src = node.attrs.src as string;
  const isUploading = Boolean(node.attrs.uploadId);
  const width = normalizedAudioWidth(node.attrs.width);
  const activeWidth = dragWidth ?? width;
  const controlsVisible = isEditable && (isHovered || selected);
  const options = extension.options as ContentAudioOptions;

  function clearHoverHideTimeout() {
    if (hoverHideTimeoutRef.current === null) return;
    window.clearTimeout(hoverHideTimeoutRef.current);
    hoverHideTimeoutRef.current = null;
  }

  function showAudioControls() {
    clearHoverHideTimeout();
    setIsHovered(true);
  }

  function hideAudioControlsSoon() {
    clearHoverHideTimeout();
    hoverHideTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(false);
      setMoreMenuOpen(false);
      hoverHideTimeoutRef.current = null;
    }, 450);
  }

  useEffect(() => {
    return clearHoverHideTimeout;
  }, []);

  useEffect(() => {
    if (!sourcePanelOpen && !selected) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        (emptyBlockRef.current?.contains(target) ||
          mediaBlockRef.current?.contains(target))
      ) {
        return;
      }
      setSourcePanelOpen(false);
      setSourcePanelDismissed(true);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [selected, sourcePanelOpen]);

  function handleComment() {
    if (!options.onAudioComment) return;
    const position = typeof getPos === "function" ? getPos() : undefined;
    const coords = editor.view.coordsAtPos(
      typeof position === "number" ? position : editor.state.selection.from,
    );
    const wrapper = editor.view.dom.closest(".visual-editor-wrapper");
    const scrollContainer = wrapper?.closest(".flex-1.min-h-0.overflow-auto");
    const containerTop = scrollContainer
      ? scrollContainer.getBoundingClientRect().top
      : 0;
    const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
    const offsetTop = coords.top - containerTop + scrollTop;
    options.onAudioComment("Audio", offsetTop);
  }

  function openReplacePanel() {
    setSourceTab("upload");
    setAudioUrl("");
    setSourcePanelDismissed(false);
    setSourcePanelOpen(true);
  }

  function handleLightboxOpenChange(open: boolean) {
    setLightboxOpen(open);
  }

  function openLightbox() {
    setSourcePanelOpen(false);
    setLightboxOpen(true);
  }

  function insertTranscriptPlaceholder() {
    if (!editor.schema.nodes.notionToggle) return null;
    const position = typeof getPos === "function" ? getPos() : null;
    if (typeof position !== "number") return null;
    const insertAt = position + node.nodeSize;
    const placeholderText = createTranscriptPlaceholder(
      AUDIO_TRANSCRIPT_PLACEHOLDER_LABEL,
    );

    const inserted = editor
      .chain()
      .focus()
      .insertContentAt(
        insertAt,
        `<details open><summary>Transcript</summary><p>${placeholderText}</p></details>`,
      )
      .setNodeSelection(insertAt)
      .scrollIntoView()
      .run();

    return inserted ? placeholderText : null;
  }

  function handleTranscribe() {
    const documentId = options.documentId;
    if (!documentId) {
      toast.error("Could not find the current document.");
      return;
    }

    const placeholderText = insertTranscriptPlaceholder();
    if (!placeholderText) {
      toast.error("Could not add a transcript block.");
      return;
    }
    setMoreMenuOpen(false);
    sendToAgentChat({
      message: "Transcribe this audio and add the transcript below it.",
      context: [
        "The user clicked Transcribe on an audio block in Content.",
        `Document ID: ${documentId}`,
        `Media type: audio`,
        `Media URL: ${src}`,
        `Transcript placeholder text: ${placeholderText}`,
        "Call the transcribe-media action now with documentId, mediaUrl, mediaType, and placeholderText. The Transcript toggle with this exact placeholder was just inserted directly below the audio block for this request; replace only that placeholder with the transcript. Do not skip the action because another transcript already exists elsewhere in the document.",
        "After the action succeeds, do not quote or paste the transcript in chat. Give one short confirmation that the Transcript toggle below the audio block was updated.",
      ].join("\n"),
      submit: true,
    });
    toast.success("Transcription started.");
  }

  function handleLightboxViewportPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const audio = lightboxAudioRef.current;
    if (!audio) return;

    const audioRect = audio.getBoundingClientRect();
    const rootFontSize = Number.parseFloat(
      window.getComputedStyle(document.documentElement).fontSize,
    );
    const closeBuffer = 4 * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
    const isFarOutsideAudio =
      event.clientX < audioRect.left - closeBuffer ||
      event.clientX > audioRect.right + closeBuffer ||
      event.clientY < audioRect.top - closeBuffer ||
      event.clientY > audioRect.bottom + closeBuffer;

    if (isFarOutsideAudio) {
      handleLightboxOpenChange(false);
    }
  }

  function audioResizeMaxWidth() {
    const wrapper = mediaBlockRef.current?.closest(".notion-editor");
    const maxWidth =
      wrapper?.getBoundingClientRect().width ??
      mediaBlockRef.current?.parentElement?.getBoundingClientRect().width ??
      mediaBlockRef.current?.getBoundingClientRect().width ??
      MIN_AUDIO_WIDTH;
    return Math.max(MIN_AUDIO_WIDTH, Math.floor(maxWidth));
  }

  function handleResizePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: ResizeDirection,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const rect = mediaBlockRef.current?.getBoundingClientRect();
    if (!rect) return;

    const maxWidth = audioResizeMaxWidth();
    resizeStateRef.current = {
      direction,
      maxWidth,
      startWidth: rect.width,
      startX: event.clientX,
    };
    setDragWidth(clampAudioWidth(rect.width, maxWidth));
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      const delta = event.clientX - resizeState.startX;
      const nextWidth =
        resizeState.direction === "right"
          ? resizeState.startWidth + delta
          : resizeState.startWidth - delta;
      setDragWidth(clampAudioWidth(nextWidth, resizeState.maxWidth));
    }

    function handlePointerUp() {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;

      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragWidth((currentWidth) => {
        if (currentWidth) {
          updateAttributes({ width: currentWidth });
        }
        return null;
      });
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [updateAttributes]);

  async function handleAudioFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const toastId = toast.loading("Uploading audio...");
    try {
      const nextSrc = await uploadAudioFile(file);
      updateAttributes({ src: nextSrc });
      setSourcePanelOpen(false);
      toast.success("Audio added", { id: toastId });
    } catch (error) {
      toast.error(audioUploadErrorMessage(error), { id: toastId });
    }
  }

  function handleEmbedLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSrc = audioUrl.trim();
    if (!nextSrc) return;

    try {
      const url = new URL(nextSrc);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Invalid protocol");
      }
    } catch {
      toast.error("Paste a valid audio URL.");
      return;
    }

    updateAttributes({ src: nextSrc });
    setAudioUrl("");
    setSourcePanelOpen(false);
  }

  function renderSourcePanel(replace = false) {
    return (
      <div
        className={`media-source-panel ${
          replace ? "media-source-panel--replace" : ""
        }`}
      >
        <div className="media-source-panel__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={sourceTab === "upload"}
            className="media-source-panel__tab"
            onClick={() => setSourceTab("upload")}
          >
            Upload
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceTab === "link"}
            className="media-source-panel__tab"
            onClick={() => setSourceTab("link")}
          >
            Link
          </button>
        </div>

        {sourceTab === "upload" ? (
          <div className="media-source-panel__body">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload file
            </Button>
          </div>
        ) : (
          <form className="media-source-panel__body" onSubmit={handleEmbedLink}>
            <Input
              autoFocus
              type="url"
              value={audioUrl}
              onChange={(event) => setAudioUrl(event.target.value)}
              placeholder="Paste the audio link..."
            />
            <Button type="submit" className="w-full">
              {replace ? "Replace audio" : "Embed audio"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Works with direct audio links from the web
            </p>
          </form>
        )}
      </div>
    );
  }

  if (!src) {
    const showSourcePanel =
      isEditable &&
      !isUploading &&
      !sourcePanelDismissed &&
      (selected || sourcePanelOpen);

    return (
      <NodeViewWrapper className="media-block-wrapper" data-drag-handle>
        <div
          ref={emptyBlockRef}
          className="media-empty-block"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <button
            type="button"
            className="media-empty-block__trigger"
            disabled={isUploading}
            aria-busy={isUploading}
            onClick={() => {
              if (!isEditable || isUploading) return;
              setSourcePanelDismissed(false);
              setSourcePanelOpen(true);
            }}
          >
            <IconMusic size={20} />
            <span>{isUploading ? "Uploading audio..." : "Add audio"}</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleAudioFilePicked}
          />

          {showSourcePanel ? renderSourcePanel() : null}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="media-block-wrapper" data-drag-handle>
      <div
        ref={mediaBlockRef}
        className={`media-block media-block--audio ${
          selected ? "media-block--selected" : ""
        }`}
        data-resized={activeWidth ? "true" : undefined}
        data-controls-visible={controlsVisible ? "true" : undefined}
        onMouseEnter={showAudioControls}
        onMouseLeave={hideAudioControlsSoon}
        style={activeWidth ? { width: `${activeWidth}px` } : undefined}
      >
        <audio
          src={src}
          className="media-block__content"
          controls
          preload="metadata"
          draggable={false}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openLightbox();
          }}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleAudioFilePicked}
        />

        {isEditable ? (
          <>
            <button
              type="button"
              className="media-block__resize-handle media-block__resize-handle--left"
              data-visible={controlsVisible ? "true" : undefined}
              aria-label="Resize audio from left"
              aria-hidden={!controlsVisible}
              tabIndex={controlsVisible ? 0 : -1}
              onPointerDown={(event) => handleResizePointerDown(event, "left")}
            />
            <button
              type="button"
              className="media-block__resize-handle media-block__resize-handle--right"
              data-visible={controlsVisible ? "true" : undefined}
              aria-label="Resize audio from right"
              aria-hidden={!controlsVisible}
              tabIndex={controlsVisible ? 0 : -1}
              onPointerDown={(event) => handleResizePointerDown(event, "right")}
            />

            <div
              className="media-block__toolbar"
              data-visible={controlsVisible ? "true" : undefined}
              aria-hidden={!controlsVisible}
              onMouseEnter={showAudioControls}
              onMouseLeave={hideAudioControlsSoon}
              onMouseDown={(event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest("[data-media-dropdown-trigger]")
                ) {
                  return;
                }
                event.preventDefault();
              }}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleComment}
                    className="media-block__toolbar-btn"
                    aria-label="Comment on audio"
                  >
                    <IconMessageCircle size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Comment</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={openLightbox}
                    className="media-block__toolbar-btn"
                    aria-label="Expand audio"
                  >
                    <IconArrowsMaximize size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Expand</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => void downloadAudio(src)}
                    className="media-block__toolbar-btn"
                    aria-label="Download audio"
                  >
                    <IconDownload size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Download</TooltipContent>
              </Tooltip>

              <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="media-block__toolbar-btn"
                    aria-label="More audio actions"
                    data-media-dropdown-trigger
                    title="More"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  >
                    <IconDots size={18} />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="media-block__dropdown-content"
                  sideOffset={8}
                  role="menu"
                >
                  <div className="media-block__dropdown-label">Audio</div>
                  <div className="media-block__dropdown-group">
                    <button
                      type="button"
                      className="media-block__dropdown-item"
                      role="menuitem"
                      onClick={handleTranscribe}
                    >
                      <span
                        className="media-block__dropdown-icon"
                        aria-hidden="true"
                      >
                        <IconFileText size={18} />
                      </span>
                      <span>Transcribe</span>
                    </button>
                    <button
                      type="button"
                      className="media-block__dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        openReplacePanel();
                      }}
                    >
                      <span
                        className="media-block__dropdown-icon"
                        aria-hidden="true"
                      >
                        <IconRefresh size={18} />
                      </span>
                      <span>Replace</span>
                    </button>
                    <button
                      type="button"
                      className="media-block__dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void copyAudio(src);
                      }}
                    >
                      <span
                        className="media-block__dropdown-icon"
                        aria-hidden="true"
                      >
                        <IconCopy size={18} />
                      </span>
                      <span>Copy audio</span>
                    </button>
                  </div>
                  <div
                    className="media-block__dropdown-separator"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="media-block__dropdown-item media-block__dropdown-item--danger"
                    role="menuitem"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      deleteNode();
                    }}
                  >
                    <span
                      className="media-block__dropdown-icon"
                      aria-hidden="true"
                    >
                      <IconTrash size={18} />
                    </span>
                    <span>Delete</span>
                  </button>
                </PopoverContent>
              </Popover>
            </div>
          </>
        ) : null}

        {isEditable && sourcePanelOpen ? renderSourcePanel(true) : null}

        <Dialog open={lightboxOpen} onOpenChange={handleLightboxOpenChange}>
          <DialogPortal>
            <DialogOverlay className="media-lightbox__overlay" />
            <DialogPrimitive.Content
              className="media-lightbox"
              aria-describedby={undefined}
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <DialogTitle className="sr-only">Audio preview</DialogTitle>
              <div
                className="media-lightbox__viewport"
                onPointerDown={handleLightboxViewportPointerDown}
              >
                <audio
                  ref={lightboxAudioRef}
                  src={src}
                  className="media-lightbox__audio"
                  controls
                  preload="metadata"
                />
              </div>

              <div className="media-lightbox__toolbar" aria-label="Audio view">
                <button
                  type="button"
                  className="media-lightbox__toolbar-btn"
                  aria-label="Download audio"
                  onClick={() => void downloadAudio(src)}
                >
                  <IconDownload size={17} />
                </button>
                <span className="media-lightbox__separator" aria-hidden />
                <button
                  type="button"
                  className="media-lightbox__toolbar-btn"
                  aria-label="Close audio preview"
                  onClick={() => handleLightboxOpenChange(false)}
                >
                  <IconArrowsMinimize size={17} />
                </button>
              </div>
            </DialogPrimitive.Content>
          </DialogPortal>
        </Dialog>
      </div>
    </NodeViewWrapper>
  );
}
