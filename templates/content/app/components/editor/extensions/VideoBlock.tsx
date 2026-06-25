import { sendToAgentChat, useT } from "@agent-native/core/client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconCopy,
  IconDownload,
  IconDots,
  IconFileText,
  IconMessageCircle,
  IconRefresh,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { uploadVideoFile, videoUploadErrorMessage } from "../image-upload";
import type { ContentVideoOptions } from "./VideoNode";

type VideoSourceTab = "upload" | "link";
type ResizeDirection = "left" | "right";

interface VideoResizeState {
  direction: ResizeDirection;
  maxWidth: number;
  startWidth: number;
  startX: number;
}

const MIN_VIDEO_WIDTH = 200;
function createTranscriptPlaceholder(label: string): string {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${label} ${id}`;
}

function normalizedVideoWidth(value: unknown): number | null {
  const width =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.round(width);
}

function clampVideoWidth(width: number, maxWidth: number): number {
  return Math.round(Math.min(Math.max(width, MIN_VIDEO_WIDTH), maxWidth));
}

function videoDownloadName(src: string): string {
  try {
    const pathname = new URL(src).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    if (name) return decodeURIComponent(name);
  } catch {}

  return "video";
}

async function downloadVideo(
  src: string,
  copy: {
    started: string;
    opened: string;
  },
) {
  const filename = videoDownloadName(src);

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
    toast.success(copy.started);
  } catch {
    const anchor = document.createElement("a");
    anchor.href = src;
    anchor.download = filename;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    toast.info(copy.opened);
  }
}

async function copyVideo(
  src: string,
  copy: {
    copied: string;
    failed: string;
  },
) {
  try {
    await navigator.clipboard.writeText(src);
    toast.success(copy.copied);
  } catch {
    toast.error(copy.failed);
  }
}

export function VideoBlock({
  node,
  editor,
  deleteNode,
  selected,
  updateAttributes,
  extension,
  getPos,
}: NodeViewProps) {
  const t = useT();
  const [isHovered, setIsHovered] = useState(false);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [sourcePanelDismissed, setSourcePanelDismissed] = useState(false);
  const [sourceTab, setSourceTab] = useState<VideoSourceTab>("upload");
  const [videoUrl, setVideoUrl] = useState("");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emptyBlockRef = useRef<HTMLDivElement>(null);
  const lightboxVideoRef = useRef<HTMLVideoElement>(null);
  const mediaBlockRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<VideoResizeState | null>(null);
  const isEditable = editor.isEditable;
  const src = node.attrs.src as string;
  const poster = (node.attrs.poster as string) || "";
  const isUploading = Boolean(node.attrs.uploadId);
  const width = normalizedVideoWidth(node.attrs.width);
  const activeWidth = dragWidth ?? width;
  const controlsVisible = isEditable && (isHovered || selected);
  const options = extension.options as ContentVideoOptions;

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
    if (!options.onVideoComment) return;
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
    options.onVideoComment(t("editor.media.video"), offsetTop);
  }

  function openReplacePanel() {
    setSourceTab("upload");
    setVideoUrl("");
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
      t("editor.media.transcribingVideo"),
    );

    const inserted = editor
      .chain()
      .focus()
      .insertContentAt(
        insertAt,
        `<details open><summary>${t("editor.media.transcript")}</summary><p>${placeholderText}</p></details>`,
      )
      .setNodeSelection(insertAt)
      .scrollIntoView()
      .run();

    return inserted ? placeholderText : null;
  }

  function handleTranscribe() {
    const documentId = options.documentId;
    if (!documentId) {
      toast.error(t("editor.media.currentDocumentMissing"));
      return;
    }

    const placeholderText = insertTranscriptPlaceholder();
    if (!placeholderText) {
      toast.error(t("editor.media.transcriptBlockFailed"));
      return;
    }
    setMoreMenuOpen(false);
    sendToAgentChat({
      message: t("editor.media.transcribeVideoPrompt"),
      context: [
        "The user clicked Transcribe on a video block in Content.",
        `Document ID: ${documentId}`,
        `Media type: video`,
        `Media URL: ${src}`,
        `Transcript placeholder text: ${placeholderText}`,
        "Call the transcribe-media action now with documentId, mediaUrl, mediaType, and placeholderText. The Transcript toggle with this exact placeholder was just inserted directly below the video block for this request; replace only that placeholder with the transcript. Do not skip the action because another transcript already exists elsewhere in the document.",
        "After the action succeeds, do not quote or paste the transcript in chat. Give one short confirmation that the Transcript toggle below the video block was updated.",
      ].join("\n"),
      submit: true,
    });
    toast.success(t("editor.media.transcriptionStarted"));
  }

  function handleLightboxViewportPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const video = lightboxVideoRef.current;
    if (!video) return;

    const videoRect = video.getBoundingClientRect();
    const rootFontSize = Number.parseFloat(
      window.getComputedStyle(document.documentElement).fontSize,
    );
    const closeBuffer = 4 * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
    const isFarOutsideVideo =
      event.clientX < videoRect.left - closeBuffer ||
      event.clientX > videoRect.right + closeBuffer || // i18n-ignore non-copy geometry expression
      event.clientY < videoRect.top - closeBuffer ||
      event.clientY > videoRect.bottom + closeBuffer;

    if (isFarOutsideVideo) {
      handleLightboxOpenChange(false);
    }
  }

  function videoResizeMaxWidth() {
    const wrapper = mediaBlockRef.current?.closest(".notion-editor");
    const maxWidth =
      wrapper?.getBoundingClientRect().width ??
      mediaBlockRef.current?.parentElement?.getBoundingClientRect().width ??
      mediaBlockRef.current?.getBoundingClientRect().width ??
      MIN_VIDEO_WIDTH;
    return Math.max(MIN_VIDEO_WIDTH, Math.floor(maxWidth));
  }

  function handleResizePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: ResizeDirection,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const rect = mediaBlockRef.current?.getBoundingClientRect();
    if (!rect) return;

    const maxWidth = videoResizeMaxWidth();
    resizeStateRef.current = {
      direction,
      maxWidth,
      startWidth: rect.width,
      startX: event.clientX,
    };
    setDragWidth(clampVideoWidth(rect.width, maxWidth));
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
      setDragWidth(clampVideoWidth(nextWidth, resizeState.maxWidth));
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

  async function handleVideoFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const toastId = toast.loading(t("editor.media.uploadingVideo"));
    try {
      const nextSrc = await uploadVideoFile(file);
      updateAttributes({ src: nextSrc });
      setSourcePanelOpen(false);
      toast.success(t("editor.media.videoAdded"), { id: toastId });
    } catch (error) {
      toast.error(videoUploadErrorMessage(error), { id: toastId });
    }
  }

  function handleEmbedLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSrc = videoUrl.trim();
    if (!nextSrc) return;

    try {
      const url = new URL(nextSrc);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Invalid protocol");
      }
    } catch {
      toast.error(t("editor.media.pasteValidVideoUrl"));
      return;
    }

    updateAttributes({ src: nextSrc });
    setVideoUrl("");
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
            {t("editor.media.upload")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceTab === "link"}
            className="media-source-panel__tab"
            onClick={() => setSourceTab("link")}
          >
            {t("editor.media.link")}
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
              {t("editor.media.uploadFile")}
            </Button>
          </div>
        ) : (
          <form className="media-source-panel__body" onSubmit={handleEmbedLink}>
            <Input
              autoFocus
              type="url"
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              placeholder={t("editor.media.pasteVideoLink")}
            />
            <Button type="submit" className="w-full">
              {replace
                ? t("editor.media.replaceVideo")
                : t("editor.media.embedVideo")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {t("editor.media.videoLinkHint")}
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
            <IconVideo size={20} />
            <span>
              {isUploading
                ? t("editor.media.uploadingVideo")
                : t("editor.media.addVideo")}
            </span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleVideoFilePicked}
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
        className={`media-block ${selected ? "media-block--selected" : ""}`}
        data-resized={activeWidth ? "true" : undefined}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          setMoreMenuOpen(false);
        }}
        style={activeWidth ? { width: `${activeWidth}px` } : undefined}
      >
        <video
          src={src}
          poster={poster || undefined}
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
          accept="video/*"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleVideoFilePicked}
        />

        {isEditable ? (
          <>
            <button
              type="button"
              className="media-block__resize-handle media-block__resize-handle--left"
              data-visible={controlsVisible ? "true" : undefined}
              aria-label={t("editor.media.resizeVideoFromLeft")}
              aria-hidden={!controlsVisible}
              tabIndex={controlsVisible ? 0 : -1}
              onPointerDown={(event) => handleResizePointerDown(event, "left")}
            />
            <button
              type="button"
              className="media-block__resize-handle media-block__resize-handle--right"
              data-visible={controlsVisible ? "true" : undefined}
              aria-label={t("editor.media.resizeVideoFromRight")}
              aria-hidden={!controlsVisible}
              tabIndex={controlsVisible ? 0 : -1}
              onPointerDown={(event) => handleResizePointerDown(event, "right")}
            />

            <div
              className="media-block__toolbar"
              data-visible={controlsVisible ? "true" : undefined}
              aria-hidden={!controlsVisible}
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
                    aria-label={t("editor.media.commentOnVideo")}
                  >
                    <IconMessageCircle size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("editor.comment")}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={openLightbox}
                    className="media-block__toolbar-btn"
                    aria-label={t("editor.media.expandVideo")}
                  >
                    <IconArrowsMaximize size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("editor.media.expand")}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() =>
                      void downloadVideo(src, {
                        started: t("editor.media.videoDownloadStarted"),
                        opened: t("editor.media.openedVideoInNewTab"),
                      })
                    }
                    className="media-block__toolbar-btn"
                    aria-label={t("editor.media.downloadVideo")}
                  >
                    <IconDownload size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("editor.media.download")}</TooltipContent>
              </Tooltip>

              <Popover open={moreMenuOpen} onOpenChange={setMoreMenuOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="media-block__toolbar-btn"
                    aria-label={t("editor.media.moreVideoActions")}
                    data-media-dropdown-trigger
                    title={t("editor.media.more")}
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
                  <div className="media-block__dropdown-label">
                    {t("editor.media.video")}
                  </div>
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
                      <span>{t("editor.media.transcribe")}</span>
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
                      <span>{t("editor.media.replace")}</span>
                    </button>
                    <button
                      type="button"
                      className="media-block__dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void copyVideo(src, {
                          copied: t("editor.media.copiedVideoUrl"),
                          failed: t("editor.media.couldNotCopyVideo"),
                        });
                      }}
                    >
                      <span
                        className="media-block__dropdown-icon"
                        aria-hidden="true"
                      >
                        <IconCopy size={18} />
                      </span>
                      <span>{t("editor.media.copyVideo")}</span>
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
                    <span>{t("editor.media.delete")}</span>
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
              <DialogTitle className="sr-only">
                {t("editor.media.videoPreview")}
              </DialogTitle>
              <div
                className="media-lightbox__viewport"
                onPointerDown={handleLightboxViewportPointerDown}
              >
                <video
                  ref={lightboxVideoRef}
                  src={src}
                  poster={poster || undefined}
                  className="media-lightbox__video"
                  controls
                  preload="metadata"
                />
              </div>

              <div
                className="media-lightbox__toolbar"
                aria-label={t("editor.media.videoView")}
              >
                <button
                  type="button"
                  className="media-lightbox__toolbar-btn"
                  aria-label={t("editor.media.downloadVideo")}
                  onClick={() =>
                    void downloadVideo(src, {
                      started: t("editor.media.videoDownloadStarted"),
                      opened: t("editor.media.openedVideoInNewTab"),
                    })
                  }
                >
                  <IconDownload size={17} />
                </button>
                <span className="media-lightbox__separator" aria-hidden />
                <button
                  type="button"
                  className="media-lightbox__toolbar-btn"
                  aria-label={t("editor.media.closeVideoPreview")}
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
