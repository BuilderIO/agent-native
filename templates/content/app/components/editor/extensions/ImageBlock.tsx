import { sendToAgentChat, useT } from "@agent-native/core/client";
import {
  EmbeddedApp,
  type EmbeddedAppRef,
} from "@agent-native/core/embedding/react";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import { Input } from "@agent-native/toolkit/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconCopy,
  IconDownload,
  IconDots,
  IconMessageCircle,
  IconMinus,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconWand,
  IconTrash,
  IconX,
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

import { imageUploadErrorMessage, uploadImageFile } from "../image-upload";
import type { ContentImageOptions } from "./ImageNode";

type ImageSourceTab = "upload" | "assets" | "link";
type ResizeDirection = "left" | "right";

interface ImageResizeState {
  direction: ResizeDirection;
  maxWidth: number;
  startWidth: number;
  startX: number;
}

const MIN_IMAGE_WIDTH = 160;
const MAX_AGENT_IMAGE_DIMENSION = 1600;
const ALT_TEXT_CONTEXT_WORD_LIMIT = 250;
const DEFAULT_ASSETS_PICKER_URL = "https://assets.agent-native.com/picker";

interface PickedAssetImagePayload {
  url?: unknown;
  previewUrl?: unknown;
  downloadUrl?: unknown;
  embedUrl?: unknown;
  altText?: unknown;
  title?: unknown;
}

function assetsPickerUrl() {
  return (
    import.meta.env.VITE_AGENT_NATIVE_ASSETS_PICKER_URL ||
    DEFAULT_ASSETS_PICKER_URL
  );
}

function pickedAssetString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function pickedAssetImageSource(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const image = payload as PickedAssetImagePayload;
  return (
    pickedAssetString(image.url) ??
    pickedAssetString(image.previewUrl) ??
    pickedAssetString(image.downloadUrl) ??
    pickedAssetString(image.embedUrl)
  );
}

function pickedAssetImageAlt(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const image = payload as PickedAssetImagePayload;
  return pickedAssetString(image.altText) ?? pickedAssetString(image.title);
}

interface AssetsPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  title: string;
  embeddedTitle: string;
  loadingLabel: string;
  onReady: (payload: unknown, event: MessageEvent, ref: EmbeddedAppRef) => void;
  onMessage: (name: string, payload: unknown) => void;
}

function AssetsPickerDialog({
  open,
  onOpenChange,
  url,
  title,
  embeddedTitle,
  loadingLabel,
  onReady,
  onMessage,
}: AssetsPickerDialogProps) {
  const [pickerReady, setPickerReady] = useState(false);

  useEffect(() => {
    if (open) setPickerReady(false);
  }, [open, url]);

  function handleReady(
    payload: unknown,
    event: MessageEvent,
    ref: EmbeddedAppRef,
  ) {
    setPickerReady(true);
    onReady(payload, event, ref);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(86vh,760px)] w-[min(96vw,1040px)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <div className="flex h-12 shrink-0 items-center border-b px-4">
          <DialogTitle className="text-base">{title}</DialogTitle>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
          {!pickerReady && <AssetsPickerSkeleton loadingLabel={loadingLabel} />}
          <EmbeddedApp
            url={url}
            title={embeddedTitle}
            className={`absolute inset-0 h-full w-full border-0 bg-background transition-opacity duration-150 ${
              pickerReady ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            onReady={handleReady}
            onMessage={onMessage}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssetsPickerSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div
      className="absolute inset-0 flex flex-col gap-5 p-5"
      role="status"
      aria-label={loadingLabel}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 flex-1 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex min-w-0 flex-col gap-2">
            <Skeleton className="aspect-square w-full rounded-lg" />
            <Skeleton className="h-3 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function normalizedImageWidth(value: unknown): number | null {
  const width =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(width) || width <= 0) return null;
  return Math.round(width);
}

function clampImageWidth(width: number, maxWidth: number): number {
  return Math.round(Math.min(Math.max(width, MIN_IMAGE_WIDTH), maxWidth));
}

function imageDownloadName(src: string, alt: string): string {
  const cleanAlt = alt.trim().replace(/[^a-z0-9._-]+/gi, "-");
  if (cleanAlt) return cleanAlt.toLowerCase();

  try {
    const pathname = new URL(src).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    if (name) return decodeURIComponent(name);
  } catch {}

  return "image";
}

async function downloadImage(
  src: string,
  alt: string,
  copy: {
    started: string;
    opened: string;
  },
) {
  const filename = imageDownloadName(src, alt);

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

async function blobToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Canvas unavailable");
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const pngBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!pngBlob) throw new Error("Image conversion failed");
  return pngBlob;
}

async function copyImage(
  src: string,
  copy: {
    copied: string;
    urlCopied: string;
    failed: string;
  },
) {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      throw new Error("Image clipboard unavailable");
    }

    const response = await fetch(src);
    if (!response.ok) throw new Error("Copy failed");
    const blob = await response.blob();
    const clipboardItem = ClipboardItem as typeof ClipboardItem & {
      supports?: (type: string) => boolean;
    };
    const originalType = blob.type || "image/png";
    const canCopyOriginalType =
      originalType.startsWith("image/") &&
      (!clipboardItem.supports || clipboardItem.supports(originalType));
    const imageBlob = canCopyOriginalType ? blob : await blobToPng(blob);
    const imageType = canCopyOriginalType ? originalType : "image/png";

    await navigator.clipboard.write([
      new ClipboardItem({ [imageType]: imageBlob }),
    ]);
    toast.success(copy.copied);
  } catch {
    try {
      await navigator.clipboard.writeText(src);
      toast.info(copy.urlCopied);
    } catch {
      toast.error(copy.failed);
    }
  }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read image"));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Image read failed"));
    reader.readAsDataURL(blob);
  });
}

async function imageBlobToAgentDataUrl(blob: Blob): Promise<string> {
  if (!blob.type.startsWith("image/")) {
    throw new Error("Unsupported image type");
  }

  if (typeof createImageBitmap !== "function") {
    return await blobToDataUrl(blob);
  }

  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(
    1,
    MAX_AGENT_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return await blobToDataUrl(blob);
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
  if (!dataUrl || dataUrl === "data:,") return await blobToDataUrl(blob);
  return dataUrl;
}

async function imageDataUrlForAgent(src: string): Promise<string | null> {
  if (src.startsWith("data:image/")) return src;

  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error("Image fetch failed");
    const blob = await response.blob();
    return await imageBlobToAgentDataUrl(blob);
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function takeLastWords(value: string, limit: number): string {
  const matches = Array.from(value.matchAll(/\S+/g));
  if (matches.length <= limit) return value.trim();

  const firstIncluded = matches[matches.length - limit];
  return value.slice(firstIncluded.index).trim();
}

function takeFirstWords(value: string, limit: number): string {
  const matches = Array.from(value.matchAll(/\S+/g));
  if (matches.length <= limit) return value.trim();

  const lastIncluded = matches[limit - 1];
  return value.slice(0, lastIncluded.index + lastIncluded[0].length).trim();
}

function imageOccurrenceIndex({
  editor,
  getPos,
  src,
}: {
  editor: NodeViewProps["editor"];
  getPos: NodeViewProps["getPos"];
  src: string;
}) {
  const currentPosition = typeof getPos === "function" ? getPos() : null;
  let occurrenceIndex = 0;
  let matchingIndex = 0;

  editor.state.doc.descendants((child, position) => {
    if (child.type.name !== "image" || child.attrs.src !== src) return;
    if (position === currentPosition) {
      occurrenceIndex = matchingIndex;
      return false;
    }
    matchingIndex += 1;
  });

  return occurrenceIndex;
}

function imageMarkdownCandidates(markdown: string, src: string) {
  const escapedSrc = escapeRegExp(src);
  const escapedHtmlSrc = escapeRegExp(escapeHtmlAttribute(src));
  const candidates: Array<{ index: number; text: string }> = [];
  const patterns = [
    new RegExp(
      `<img\\b[^>]*\\bsrc=["'](?:${escapedSrc}|${escapedHtmlSrc})["'][^>]*\\/?>`,
      "g",
    ),
    new RegExp(`!\\[[^\\]]*\\]\\(${escapedSrc}(?:\\s+"[^"]*")?\\)`, "g"),
  ];

  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      if (match.index === undefined) continue;
      candidates.push({ index: match.index, text: match[0] });
    }
  }

  return candidates.sort((a, b) => a.index - b.index);
}

function buildAltTextArticleContext({
  editor,
  getPos,
  src,
}: {
  editor: NodeViewProps["editor"];
  getPos: NodeViewProps["getPos"];
  src: string;
}): string | null {
  const markdownStorage = (editor.storage as any)?.markdown;
  const getMarkdown = markdownStorage?.getMarkdown;
  if (typeof getMarkdown !== "function") return null;

  const markdown = String(getMarkdown.call(markdownStorage) ?? "");
  if (!markdown.trim()) return null;

  const candidates = imageMarkdownCandidates(markdown, src);
  if (!candidates.length) return null;

  const occurrence = imageOccurrenceIndex({ editor, getPos, src });
  const image = candidates[Math.min(occurrence, candidates.length - 1)];
  const imageEnd = image.index + image.text.length;
  const before = takeLastWords(
    markdown.slice(0, image.index),
    ALT_TEXT_CONTEXT_WORD_LIMIT,
  );
  const after = takeFirstWords(
    markdown.slice(imageEnd),
    ALT_TEXT_CONTEXT_WORD_LIMIT,
  );

  return [
    before,
    "<!-- IMAGE TO DESCRIBE START -->", // i18n-ignore agent prompt marker
    image.text, // i18n-ignore user-authored markdown image text
    "<!-- IMAGE TO DESCRIBE END -->", // i18n-ignore agent prompt marker
    after,
  ]
    .filter((part) => part.trim())
    .join("\n\n");
}

export function ImageBlock({
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
  const [sourceTab, setSourceTab] = useState<ImageSourceTab>("upload");
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [altPopoverOpen, setAltPopoverOpen] = useState(false);
  const [altDraft, setAltDraft] = useState("");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxZoomed, setLightboxZoomed] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isGeneratingAlt, setIsGeneratingAlt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const altInputRef = useRef<HTMLInputElement>(null);
  const emptyBlockRef = useRef<HTMLDivElement>(null);
  const lightboxImageRef = useRef<HTMLImageElement>(null);
  const mediaBlockRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<ImageResizeState | null>(null);
  const isEditable = editor.isEditable;
  const src = node.attrs.src as string;
  const alt = (node.attrs.alt as string) || "";
  const isUploading = Boolean(node.attrs.uploadId);
  const width = normalizedImageWidth(node.attrs.width);
  const activeWidth = dragWidth ?? width;
  const controlsVisible = isEditable && (isHovered || selected);
  const options = extension.options as ContentImageOptions;

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
    if (!options.onImageComment) return;
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
    options.onImageComment(
      alt.trim()
        ? t("editor.media.imageCommentWithAlt", { alt: alt.trim() })
        : t("editor.media.image"),
      offsetTop,
    );
  }

  function openAltEditor() {
    setAltDraft(alt);
    setAltPopoverOpen(true);
  }

  function openReplacePanel() {
    setSourceTab("upload");
    setImageUrl("");
    setSourcePanelDismissed(false);
    setSourcePanelOpen(true);
  }

  function openAssetsPicker() {
    setAssetsPickerOpen(true);
    setSourcePanelOpen(false);
    setSourcePanelDismissed(true);
  }

  function handleLightboxOpenChange(open: boolean) {
    setLightboxOpen(open);
    if (!open) {
      setLightboxZoomed(false);
    }
  }

  function openLightbox() {
    setSourcePanelOpen(false);
    setLightboxZoomed(false);
    setLightboxOpen(true);
  }

  function handleLightboxViewportPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const image = lightboxImageRef.current;
    if (!image) return;

    const imageRect = image.getBoundingClientRect();
    const rootFontSize = Number.parseFloat(
      window.getComputedStyle(document.documentElement).fontSize,
    );
    const closeBuffer = 4 * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
    const isFarOutsideImage =
      event.clientX < imageRect.left - closeBuffer ||
      event.clientX > imageRect.right + closeBuffer || // i18n-ignore non-copy geometry expression
      event.clientY < imageRect.top - closeBuffer ||
      event.clientY > imageRect.bottom + closeBuffer;

    if (isFarOutsideImage) {
      handleLightboxOpenChange(false);
    }
  }

  function updateAltText(nextAlt: string) {
    setAltDraft(nextAlt);
    updateAttributes({ alt: nextAlt });
  }

  async function handleGenerateAltText() {
    const documentId = options.documentId;
    if (!documentId) {
      toast.error(t("editor.media.currentDocumentMissing"));
      return;
    }

    const toastId = toast.loading(t("editor.media.generatingAltText"));
    setIsGeneratingAlt(true);

    try {
      const imageDataUrl = await imageDataUrlForAgent(src);
      const imageOccurrence = imageOccurrenceIndex({ editor, getPos, src });
      const articleContext = buildAltTextArticleContext({
        editor,
        getPos,
        src,
      });
      sendToAgentChat({
        message: t("editor.media.generateAltTextPrompt"),
        context: [
          "The user clicked the alt text generator for an image block in Content.",
          `Document ID: ${documentId}`,
          `Image URL: ${src}`,
          `Image occurrence for this URL: ${imageOccurrence}`,
          `Current alt text: ${alt.trim() || "(empty)"}`,
          articleContext
            ? `Article context around this image, in markdown. The target image is marked with IMAGE TO DESCRIBE comments. Use up to this context to understand the image's purpose in the article, but do not invent details that are not visible in the image:\n\n${articleContext}`
            : "Article context could not be serialized from the editor.",
          imageDataUrl
            ? "The image contents are attached to this message."
            : "The browser could not attach the image contents, so use the image URL and surrounding document context.",
          "Generate concise, useful alt text for accessibility. Use the attached image as the source of truth and the article context only for disambiguation. Then call set-image-alt-text with documentId, imageUrl, altText, and imageOccurrence so the generated text is applied to this exact image. Keep the alt text factual and avoid phrases like 'image of' unless needed for clarity.",
          "After the action succeeds, do not repeat the alt text in chat. Give one short confirmation that the image alt text was updated.",
        ].join("\n"),
        images: imageDataUrl ? [imageDataUrl] : undefined,
        submit: true,
      });
      toast.success(t("editor.media.generatingAltText"), { id: toastId });
    } catch {
      toast.error(t("editor.media.altTextGenerationFailed"), {
        id: toastId,
      });
    } finally {
      setIsGeneratingAlt(false);
    }
  }

  useEffect(() => {
    if (!altPopoverOpen) return;
    window.setTimeout(() => altInputRef.current?.focus(), 0);
  }, [altPopoverOpen]);

  useEffect(() => {
    if (!altPopoverOpen) return;
    setAltDraft(alt);
  }, [alt, altPopoverOpen]);

  function imageResizeMaxWidth() {
    const wrapper = mediaBlockRef.current?.closest(".notion-editor");
    const maxWidth =
      wrapper?.getBoundingClientRect().width ??
      mediaBlockRef.current?.parentElement?.getBoundingClientRect().width ??
      mediaBlockRef.current?.getBoundingClientRect().width ??
      MIN_IMAGE_WIDTH;
    return Math.max(MIN_IMAGE_WIDTH, Math.floor(maxWidth));
  }

  function handleResizePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: ResizeDirection,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const rect = mediaBlockRef.current?.getBoundingClientRect();
    if (!rect) return;

    const maxWidth = imageResizeMaxWidth();
    resizeStateRef.current = {
      direction,
      maxWidth,
      startWidth: rect.width,
      startX: event.clientX,
    };
    setDragWidth(clampImageWidth(rect.width, maxWidth));
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
      setDragWidth(clampImageWidth(nextWidth, resizeState.maxWidth));
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

  async function handleImageFilePicked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const toastId = toast.loading(t("editor.media.uploadingImage"));
    try {
      const nextSrc = await uploadImageFile(file);
      updateAttributes({ src: nextSrc });
      setSourcePanelOpen(false);
      toast.success(t("editor.media.imageAdded"), { id: toastId });
    } catch (error) {
      toast.error(imageUploadErrorMessage(error), { id: toastId });
    }
  }

  function handleEmbedLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSrc = imageUrl.trim();
    if (!nextSrc) return;

    try {
      const url = new URL(nextSrc);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Invalid protocol");
      }
    } catch {
      toast.error(t("editor.media.pasteValidImageUrl"));
      return;
    }

    updateAttributes({ src: nextSrc, alt });
    setImageUrl("");
    setSourcePanelOpen(false);
  }

  function handleAssetsPickerReady(
    _payload: unknown,
    _event: MessageEvent,
    ref: EmbeddedAppRef,
  ) {
    ref.postMessage("configure", {
      prompt: alt.trim() || undefined,
      query: alt.trim() || undefined,
    });
  }

  function handleAssetsPickerMessage(name: string, payload: unknown) {
    if (name === "close") {
      setAssetsPickerOpen(false);
      return;
    }

    if (name !== "chooseImage") return;
    const nextSrc = pickedAssetImageSource(payload);
    if (!nextSrc) {
      toast.error(t("editor.media.assetsMissingImageUrl"));
      return;
    }

    updateAttributes({
      src: nextSrc,
      alt: pickedAssetImageAlt(payload) ?? alt,
    });
    setAssetsPickerOpen(false);
    toast.success(t("editor.media.imageAdded"));
  }

  function renderAssetsPickerDialog() {
    return (
      <AssetsPickerDialog
        open={assetsPickerOpen}
        onOpenChange={setAssetsPickerOpen}
        url={assetsPickerUrl()}
        title={t("editor.media.assets")}
        embeddedTitle={t("editor.media.assetsImagePicker")}
        loadingLabel={t("editor.media.loadingAssetsPicker")}
        onReady={handleAssetsPickerReady}
        onMessage={handleAssetsPickerMessage}
      />
    );
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
            aria-selected={sourceTab === "assets"}
            className="media-source-panel__tab"
            onClick={() => setSourceTab("assets")}
          >
            {t("editor.media.assets")}
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
        ) : sourceTab === "assets" ? (
          <div className="media-source-panel__body">
            <Button type="button" className="w-full" onClick={openAssetsPicker}>
              {t("editor.media.chooseFromAssets")}
            </Button>
          </div>
        ) : (
          <form className="media-source-panel__body" onSubmit={handleEmbedLink}>
            <Input
              autoFocus
              type="url"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              placeholder={t("editor.media.pasteImageLink")}
            />
            <Button type="submit" className="w-full">
              {replace
                ? t("editor.media.replaceImage")
                : t("editor.media.embedImage")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {t("editor.media.imageLinkHint")}
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
            <IconPhoto size={20} />
            <span>
              {isUploading
                ? t("editor.media.uploadingImage")
                : t("editor.media.addImage")}
            </span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleImageFilePicked}
          />

          {showSourcePanel ? renderSourcePanel() : null}
          {renderAssetsPickerDialog()}
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
        <img
          src={src}
          alt={alt || ""}
          className="media-block__content"
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
          accept="image/*"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={handleImageFilePicked}
        />

        {isEditable && (alt.trim() || altPopoverOpen) ? (
          <Popover open={altPopoverOpen} onOpenChange={setAltPopoverOpen}>
            <Tooltip delayDuration={350}>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="media-block__alt-badge"
                    aria-label={t("editor.media.viewAndEditAltText")}
                    onClick={() => setAltDraft(alt)}
                  >
                    ALT
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent className="media-block__alt-tooltip" side="top">
                {alt.trim() ? (
                  <span className="media-block__alt-tooltip-text">{alt}</span>
                ) : null}
                <span className="media-block__alt-tooltip-help">
                  {t("editor.media.clickToEditAltText")}
                </span>
              </TooltipContent>
            </Tooltip>
            <PopoverContent
              align="end"
              className="media-block__alt-popover"
              side="bottom"
              sideOffset={8}
            >
              <div className="media-block__alt-popover-copy">
                {t("editor.media.addAltTextDescription")}
              </div>
              <button
                type="button"
                className="media-block__alt-popover-close"
                aria-label={t("editor.media.closeAltTextEditor")}
                onClick={() => setAltPopoverOpen(false)}
              >
                <IconX size={20} />
              </button>
              <div className="media-block__alt-input-row">
                <Input
                  ref={altInputRef}
                  value={altDraft}
                  onChange={(event) => updateAltText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" || event.key === "Enter") {
                      event.preventDefault();
                      setAltPopoverOpen(false);
                    }
                  }}
                  placeholder={t("editor.media.describeThisImage")}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="media-block__alt-generate"
                      aria-label={t("editor.media.generateAltText")}
                      aria-busy={isGeneratingAlt}
                      disabled={isGeneratingAlt}
                      onClick={() => void handleGenerateAltText()}
                    >
                      <IconWand size={18} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("editor.media.generateAltText")}
                  </TooltipContent>
                </Tooltip>
              </div>
            </PopoverContent>
          </Popover>
        ) : null}

        {isEditable && (
          <>
            <button
              type="button"
              className="media-block__resize-handle media-block__resize-handle--left"
              data-visible={controlsVisible ? "true" : undefined}
              aria-label={t("editor.media.resizeImageFromLeft")}
              aria-hidden={!controlsVisible}
              tabIndex={controlsVisible ? 0 : -1}
              onPointerDown={(event) => handleResizePointerDown(event, "left")}
            />
            <button
              type="button"
              className="media-block__resize-handle media-block__resize-handle--right"
              data-visible={controlsVisible ? "true" : undefined}
              aria-label={t("editor.media.resizeImageFromRight")}
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
                    aria-label={t("editor.media.commentOnImage")}
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
                    aria-label={t("editor.media.expandImage")}
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
                      void downloadImage(src, alt, {
                        started: t("editor.media.imageDownloadStarted"),
                        opened: t("editor.media.openedImageInNewTab"),
                      })
                    }
                    className="media-block__toolbar-btn"
                    aria-label={t("editor.media.downloadImage")}
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
                    aria-label={t("editor.media.moreImageActions")}
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
                    {t("editor.media.image")}
                  </div>
                  <div className="media-block__dropdown-group">
                    <button
                      type="button"
                      className="media-block__dropdown-item"
                      role="menuitem"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        openAltEditor();
                      }}
                    >
                      <span
                        className="media-block__dropdown-icon media-block__dropdown-icon--text"
                        aria-hidden="true"
                      >
                        ALT
                      </span>
                      <span>{t("editor.media.altText")}</span>
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
                        void copyImage(src, {
                          copied: t("editor.media.imageCopied"),
                          urlCopied: t("editor.media.copiedImageUrl"),
                          failed: t("editor.media.couldNotCopyImage"),
                        });
                      }}
                    >
                      <span
                        className="media-block__dropdown-icon"
                        aria-hidden="true"
                      >
                        <IconCopy size={18} />
                      </span>
                      <span>{t("editor.media.copyImage")}</span>
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
        )}

        {!isEditable ? (
          <div
            className="media-block__toolbar"
            data-visible={isHovered ? "true" : undefined}
            aria-hidden={!isHovered}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={openLightbox}
                  className="media-block__toolbar-btn"
                  aria-label={t("editor.media.expandImage")}
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
                    void downloadImage(src, alt, {
                      started: t("editor.media.imageDownloadStarted"),
                      opened: t("editor.media.openedImageInNewTab"),
                    })
                  }
                  className="media-block__toolbar-btn"
                  aria-label={t("editor.media.downloadImage")}
                >
                  <IconDownload size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("editor.media.download")}</TooltipContent>
            </Tooltip>
          </div>
        ) : null}

        {isEditable && sourcePanelOpen ? renderSourcePanel(true) : null}
        {renderAssetsPickerDialog()}

        <Dialog open={lightboxOpen} onOpenChange={handleLightboxOpenChange}>
          <DialogPortal>
            <DialogOverlay className="media-lightbox__overlay" />
            <DialogPrimitive.Content
              className="media-lightbox"
              aria-describedby={undefined}
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <DialogTitle className="sr-only">
                {t("editor.media.imagePreview")}
              </DialogTitle>
              <div
                className="media-lightbox__viewport"
                onPointerDown={handleLightboxViewportPointerDown}
              >
                <button
                  type="button"
                  className="media-lightbox__image-button"
                  data-zoomed={lightboxZoomed ? "true" : undefined}
                  aria-label={
                    lightboxZoomed
                      ? t("editor.media.zoomImageOut")
                      : t("editor.media.zoomImageIn")
                  }
                  aria-pressed={lightboxZoomed}
                  onClick={() => setLightboxZoomed((zoomed) => !zoomed)}
                >
                  <img
                    ref={lightboxImageRef}
                    src={src}
                    alt={alt || ""}
                    className="media-lightbox__image"
                    draggable={false}
                  />
                </button>
              </div>

              <div
                className="media-lightbox__toolbar"
                aria-label={t("editor.media.imageView")}
              >
                <button
                  type="button"
                  className="media-lightbox__toolbar-btn"
                  aria-label={t("editor.media.zoomOut")}
                  disabled={!lightboxZoomed}
                  onClick={() => setLightboxZoomed(false)}
                >
                  <IconMinus size={17} />
                </button>
                <span className="media-lightbox__zoom-value">
                  {lightboxZoomed ? "150%" : "100%"}
                </span>
                <button
                  type="button"
                  className="media-lightbox__toolbar-btn"
                  aria-label={t("editor.media.zoomIn")}
                  disabled={lightboxZoomed}
                  onClick={() => setLightboxZoomed(true)}
                >
                  <IconPlus size={17} />
                </button>
                <span className="media-lightbox__separator" aria-hidden />
                <button
                  type="button"
                  className="media-lightbox__toolbar-btn"
                  aria-label={t("editor.media.downloadImage")}
                  onClick={() =>
                    void downloadImage(src, alt, {
                      started: t("editor.media.imageDownloadStarted"),
                      opened: t("editor.media.openedImageInNewTab"),
                    })
                  }
                >
                  <IconDownload size={17} />
                </button>
                <span className="media-lightbox__separator" aria-hidden />
                <button
                  type="button"
                  className="media-lightbox__toolbar-btn"
                  aria-label={t("editor.media.closeImagePreview")}
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
