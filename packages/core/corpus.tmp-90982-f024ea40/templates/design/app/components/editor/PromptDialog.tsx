import {
  appBasePath,
  PromptComposer,
  useT,
  type PromptComposerSubmitOptions,
} from "@agent-native/core/client";
import {
  EmbeddedApp,
  type EmbeddedAppRef,
} from "@agent-native/core/embedding/react";
import {
  IconApps,
  IconPalette,
  IconPhoto,
  IconPlus,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export interface UploadedFile {
  path: string;
  originalName: string;
  filename: string;
  type: string;
  size: number;
  textContent?: string;
  textTruncated?: boolean;
  dataUrl?: string;
}

const DEFAULT_ASSETS_PICKER_URL = "https://assets.agent-native.com/picker";
const RAW_CHAT_IMAGE_ATTACHMENT_BYTES = 512 * 1024;
const MAX_TOTAL_CHAT_IMAGE_DATA_URL_BYTES = 3_000_000;
const DEFAULT_MAX_CHAT_IMAGE_DATA_URL_BYTES = 1_250_000;
const CHAT_IMAGE_ATTACHMENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const IMAGE_COMPRESSION_PASSES = [
  { maxDimension: 1400, jpegQuality: 0.76 },
  { maxDimension: 1024, jpegQuality: 0.7 },
  { maxDimension: 768, jpegQuality: 0.65 },
];

interface PickedAssetImagePayload {
  url?: unknown;
  previewUrl?: unknown;
  downloadUrl?: unknown;
  embedUrl?: unknown;
  altText?: unknown;
  title?: unknown;
  mimeType?: unknown;
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

function pickedAssetFilename(payload: unknown, url: string) {
  if (payload && typeof payload === "object") {
    const image = payload as PickedAssetImagePayload;
    const title = pickedAssetString(image.title);
    if (title) return title;
  }

  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name) : "assets-image";
  } catch {
    return "assets-image";
  }
}

function pickedAssetContext(payload: unknown, url: string) {
  const lines = [`Remote image URL: ${url}`];
  if (payload && typeof payload === "object") {
    const image = payload as PickedAssetImagePayload;
    const altText = pickedAssetString(image.altText);
    if (altText) lines.push(`Alt text: ${altText}`);
  }
  return lines.join("\n");
}

function dataUrlBytes(dataUrl: string): number {
  return new TextEncoder().encode(dataUrl).byteLength;
}

function readFileDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = url;
  });
}

async function compressImageAttachment(
  file: File,
  maxDimension: number,
  jpegQuality: number,
): Promise<string | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const ratio = Math.min(
      maxDimension / image.naturalWidth,
      maxDimension / image.naturalHeight,
      1,
    );
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", jpegQuality);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function readChatImageAttachment(
  file: File,
  maxDataUrlBytes = DEFAULT_MAX_CHAT_IMAGE_DATA_URL_BYTES,
): Promise<string | null> {
  if (!CHAT_IMAGE_ATTACHMENT_TYPES.has(file.type.toLowerCase())) return null;

  if (file.size <= RAW_CHAT_IMAGE_ATTACHMENT_BYTES) {
    const raw = await readFileDataUrl(file);
    if (raw && dataUrlBytes(raw) <= maxDataUrlBytes) return raw;
  }

  let fallback: string | null = null;
  for (const pass of IMAGE_COMPRESSION_PASSES) {
    const compressed = await compressImageAttachment(
      file,
      pass.maxDimension,
      pass.jpegQuality,
    );
    if (!compressed) continue;
    fallback = compressed;
    if (dataUrlBytes(compressed) <= maxDataUrlBytes) {
      return compressed;
    }
  }
  return fallback && dataUrlBytes(fallback) <= maxDataUrlBytes
    ? fallback
    : null;
}

interface AssetsPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  onReady: (payload: unknown, event: MessageEvent, ref: EmbeddedAppRef) => void;
  onMessage: (name: string, payload: unknown) => void;
}

function AssetsPickerDialog({
  open,
  onOpenChange,
  url,
  onReady,
  onMessage,
}: AssetsPickerDialogProps) {
  const t = useT();
  const [pickerReady, setPickerReady] = useState(false);

  useEffect(() => {
    if (open) setPickerReady(false);
  }, [open, url]);

  const handleReady = useCallback(
    (payload: unknown, event: MessageEvent, ref: EmbeddedAppRef) => {
      setPickerReady(true);
      onReady(payload, event, ref);
    },
    [onReady],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-assets-picker-dialog
        className="flex h-[min(86vh,760px)] w-[min(96vw,1040px)] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <div className="flex h-12 shrink-0 items-center border-b px-4">
          <DialogTitle className="text-base">
            {t("promptDialog.assetsTitle")}
          </DialogTitle>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
          {!pickerReady && <AssetsPickerSkeleton />}
          <EmbeddedApp
            url={url}
            title={t("promptDialog.assetsImagePicker")}
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

function AssetsPickerSkeleton() {
  const t = useT();
  return (
    <div
      className="absolute inset-0 flex flex-col gap-5 p-5"
      role="status"
      aria-label={t("promptDialog.loadingAssetsPicker")}
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

export type PromptCreationMode = "design" | "app";

interface PromptPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder?: string;
  onSkip?: () => void | Promise<void>;
  skipLabel?: string;
  onSubmit: (
    prompt: string,
    files: UploadedFile[],
    options: PromptComposerSubmitOptions,
  ) => void | Promise<void>;
  loading?: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  centered?: boolean;
  designSystems?: PromptDesignSystemOption[];
  designSystemsLoading?: boolean;
  selectedDesignSystemId?: string | null;
  onDesignSystemChange?: (id: string | null) => void;
  onCreateDesignSystem?: () => void;
  /**
   * "Design" (inline prototype, default) vs "Full app" (Builder Fusion cloud
   * container). Omit both this and `onCreationModeChange` to hide the mode
   * selector entirely — used when full-app building is flag-disabled, so the
   * popover renders pixel-identical to the design-only version.
   */
  creationMode?: PromptCreationMode;
  onCreationModeChange?: (mode: PromptCreationMode) => void;
  /**
   * Scopes the composer's localStorage draft key so an abandoned draft in
   * this popover never bleeds into a different popover instance (e.g. the
   * "generate design" and "tweak" popovers both mount unscoped composers
   * that would otherwise share the same global draft key). Defaults to a
   * scope derived from `title`, which is already distinct across the
   * current call sites; pass an explicit value (e.g. including a design id)
   * for finer isolation between instances that share the same title.
   */
  draftScope?: string;
}

export interface PromptDesignSystemOption {
  id: string;
  title: string;
  description?: string | null;
  isDefault?: boolean;
}

function isNestedPromptPopoverTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "[data-agent-native-composer-popover],[data-assets-picker-dialog],[data-agent-native-prompt-select]",
      ),
    )
  );
}

// While a nested Radix Select/Popover/Dropdown is open, Radix locks
// `pointer-events` on everything outside its own portalled content so only
// that content (and its trigger) remain interactive. That lockout is what
// lets the interaction happen at all, but it also means the pointer/focus
// event that reaches our `onInteractOutside` handler resolves its `target`
// to `<html>`/`document` instead of the element the user actually clicked —
// the real target sits under a `pointer-events: none` ancestor, so the
// browser reports the outermost still-hit-testable node. That target fails
// any `closest()` containment check, so the click looks "outside" the
// dialog and dismisses it even though the user never left the popover.
//
// Rather than pattern-match on the resolved (and unreliable) target, check
// whether any of our nested portalled surfaces are currently open in the
// DOM — they're stamped with the same data attributes whether or not the
// interact-outside target correctly resolved into them. If one is open,
// this is never a genuine outside click.
function hasOpenNestedPromptPopoverSurface() {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      '[data-agent-native-composer-popover][data-state="open"],' +
        "[data-assets-picker-dialog]," +
        '[data-agent-native-prompt-select][data-state="open"]',
    ),
  );
}

export default function PromptPopover({
  open,
  onOpenChange,
  title,
  placeholder,
  onSkip,
  skipLabel,
  onSubmit,
  loading = false,
  anchorRef,
  centered = false,
  designSystems = [],
  designSystemsLoading = false,
  selectedDesignSystemId,
  onDesignSystemChange,
  onCreateDesignSystem,
  creationMode,
  onCreationModeChange,
  draftScope,
}: PromptPopoverProps) {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [skipInFlight, setSkipInFlight] = useState(false);
  const skipInFlightRef = useRef(false);
  const [pickedAssets, setPickedAssets] = useState<UploadedFile[]>([]);
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  // Restores a typed prompt into the composer after a failed submit. The
  // composer optimistically clears its text as soon as onSubmit is invoked
  // (see TiptapComposer.submitComposer), so without this an upload failure or
  // a rejected onSubmit would silently erase what the user wrote. Left
  // `undefined` in the common case so the composer's normal mount behavior
  // (restore the last localStorage draft for this scope) still applies —
  // passing a defined `initialText` (even `""`) would short-circuit that.
  const [restoredPromptText, setRestoredPromptText] = useState<
    string | undefined
  >(undefined);
  const [restoredPromptKey, setRestoredPromptKey] = useState(0);
  const restorePromptText = useCallback((text: string) => {
    setRestoredPromptText(text);
    setRestoredPromptKey((key) => key + 1);
  }, []);
  useEffect(() => {
    if (open) return;
    skipInFlightRef.current = false;
    setSkipInFlight(false);
  }, [open]);
  // While the nested design-system Select is open, Radix disables pointer
  // events on everything else and the click that closes the Select also
  // moves focus back to its trigger. That focus-return is itself reported to
  // the popover's dismissable layer as a "focus outside" interaction — and it
  // fires *after* the Select has already unmounted its portalled content, so
  // by then there is nothing left in the DOM for `onInteractOutside` to
  // recognize as "still nested and open". Latch a short-lived flag the
  // instant the Select reports closing, and have the popover's
  // interact-outside guard also honor that flag so the popover survives the
  // Select's own close-triggered focus shuffle. See PromptDialog R87/R91.
  const justClosedNestedSelectRef = useRef(false);
  const clearJustClosedNestedSelectTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const markNestedSelectJustClosed = useCallback(() => {
    justClosedNestedSelectRef.current = true;
    if (clearJustClosedNestedSelectTimeoutRef.current != null) {
      clearTimeout(clearJustClosedNestedSelectTimeoutRef.current);
    }
    clearJustClosedNestedSelectTimeoutRef.current = setTimeout(() => {
      justClosedNestedSelectRef.current = false;
      clearJustClosedNestedSelectTimeoutRef.current = null;
    }, 300);
  }, []);
  useEffect(
    () => () => {
      if (clearJustClosedNestedSelectTimeoutRef.current != null) {
        clearTimeout(clearJustClosedNestedSelectTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (open) return;
    setAssetsPickerOpen(false);
    setPickedAssets([]);
    setSelectedUploadFiles([]);
    // Only sticks for the session immediately following a failed submit; a
    // fresh open after a real close should fall back to the composer's own
    // localStorage draft restore for this scope, not a stale failed prompt.
    setRestoredPromptText(undefined);
  }, [open]);

  const uploadFiles = useCallback(
    async (files: File[]): Promise<UploadedFile[]> => {
      if (files.length === 0) return [];
      setUploading(true);
      try {
        const formData = new FormData();
        files.forEach((f) => formData.append("files", f));
        const res = await fetch(`${appBasePath()}/api/uploads`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(
            typeof body?.error === "string"
              ? body.error
              : `Upload failed (${res.status})`,
          );
        }
        const uploaded = (await res.json()) as UploadedFile[];
        const imageFileCount =
          files.filter((file) =>
            CHAT_IMAGE_ATTACHMENT_TYPES.has(file.type.toLowerCase()),
          ).length || 1;
        const maxImageDataUrlBytes = Math.min(
          DEFAULT_MAX_CHAT_IMAGE_DATA_URL_BYTES,
          Math.floor(MAX_TOTAL_CHAT_IMAGE_DATA_URL_BYTES / imageFileCount),
        );
        const visualAttachments = await Promise.all(
          files.map((file) =>
            readChatImageAttachment(file, maxImageDataUrlBytes),
          ),
        );
        return uploaded.map((file, index) =>
          visualAttachments[index]
            ? { ...file, dataUrl: visualAttachments[index] }
            : file,
        );
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    async (
      text: string,
      files: File[],
      _references: unknown,
      options: PromptComposerSubmitOptions,
    ) => {
      let uploaded: UploadedFile[];
      try {
        uploaded = await uploadFiles([...files, ...selectedUploadFiles]);
      } catch (error) {
        restorePromptText(text);
        toast.error(
          error instanceof Error
            ? error.message
            : t("promptDialog.failedToUploadFile"),
        );
        return;
      }
      try {
        await onSubmit(text.trim(), [...uploaded, ...pickedAssets], options);
        setPickedAssets([]);
        setSelectedUploadFiles([]);
      } catch (error) {
        restorePromptText(text);
        toast.error(
          error instanceof Error
            ? error.message
            : t("promptDialog.failedToSubmitPrompt"),
        );
      }
    },
    [
      onSubmit,
      pickedAssets,
      restorePromptText,
      selectedUploadFiles,
      t,
      uploadFiles,
    ],
  );

  const handleAssetsPickerReady = useCallback(
    (_payload: unknown, _event: MessageEvent, ref: EmbeddedAppRef) => {
      ref.postMessage("configure", {});
    },
    [],
  );

  const handleAssetsPickerMessage = useCallback(
    (name: string, payload: unknown) => {
      if (name === "close") {
        setAssetsPickerOpen(false);
        return;
      }

      if (name !== "chooseImage" && name !== "chooseAsset") return;
      const url = pickedAssetImageSource(payload);
      if (!url) {
        toast.error(t("promptDialog.assetsNoImageUrl"));
        return;
      }

      const filename = pickedAssetFilename(payload, url);
      const mimeType =
        payload && typeof payload === "object"
          ? pickedAssetString((payload as PickedAssetImagePayload).mimeType)
          : null;
      setPickedAssets((current) => [
        ...current,
        {
          path: url,
          originalName: filename,
          filename,
          type: mimeType ?? "image/url",
          size: 0,
          textContent: pickedAssetContext(payload, url),
        },
      ]);
      setAssetsPickerOpen(false);
      toast.success(t("promptDialog.assetAdded"));
    },
    [t],
  );

  const removePickedAsset = useCallback((path: string) => {
    setPickedAssets((current) =>
      current.filter((asset) => asset.path !== path),
    );
  }, []);

  const removeSelectedUploadFile = useCallback((index: number) => {
    setSelectedUploadFiles((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
  }, []);

  const handlePopoverOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && assetsPickerOpen) return;
      onOpenChange(nextOpen);
    },
    [assetsPickerOpen, onOpenChange],
  );

  const hasLiveVirtualAnchor = !centered && Boolean(anchorRef?.current);
  // Radix keeps the closed popover mounted while the exit animation plays, but
  // callers may clear `anchorRef` as soon as they close it. Latch the anchor
  // mode from the last open render so the closing popover never swaps over to
  // the static fallback anchor mid-exit (which re-anchored the fading popover
  // to the top-left corner of the screen).
  const anchorModeWhileOpenRef = useRef(hasLiveVirtualAnchor);
  if (open) {
    anchorModeWhileOpenRef.current = hasLiveVirtualAnchor;
  }
  const hasVirtualAnchor = open
    ? hasLiveVirtualAnchor
    : anchorModeWhileOpenRef.current;

  // Stable virtual anchor that measures the live anchor element while it is
  // attached and falls back to the last good rect afterwards. The anchor
  // element can unmount on unrelated sidebar re-renders, and the ref can be
  // cleared during the exit animation; measuring a detached element returns a
  // zero rect, which used to reposition the popover to the viewport origin.
  const latestAnchorRef = useRef(anchorRef);
  latestAnchorRef.current = anchorRef;
  const lastAnchorRectRef = useRef<DOMRect | null>(null);
  const [virtualAnchorRef] = useState<
    React.RefObject<{ getBoundingClientRect: () => DOMRect }>
  >(() => ({
    current: {
      getBoundingClientRect: () => {
        const el = latestAnchorRef.current?.current;
        if (el?.isConnected) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0) {
            lastAnchorRectRef.current = rect;
            return rect;
          }
        }
        return (
          lastAnchorRectRef.current ??
          new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0)
        );
      },
    },
  }));

  return (
    <Popover open={open} onOpenChange={handlePopoverOpenChange}>
      {open && centered && (
        <div
          className="fixed inset-0 z-[199] bg-black/40"
          onClick={() => onOpenChange(false)}
        />
      )}
      {hasVirtualAnchor ? (
        <PopoverAnchor virtualRef={virtualAnchorRef} />
      ) : (
        <PopoverAnchor asChild>
          <span
            aria-hidden="true"
            className={
              centered
                ? "fixed left-1/2 top-1/2 size-px"
                : "fixed left-3 top-3 size-px"
            }
          />
        </PopoverAnchor>
      )}
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={12}
        collisionPadding={12}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (assetsPickerOpen) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (
            isNestedPromptPopoverTarget(event.target) ||
            hasOpenNestedPromptPopoverSurface() ||
            justClosedNestedSelectRef.current
          ) {
            event.preventDefault();
          }
        }}
        data-agent-native-prompt-popover
        className="z-[200] w-[min(420px,calc(100vw-24px))] rounded-xl border-border p-0 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2">
          <span className="text-sm font-medium text-foreground/90">
            {title}
          </span>
          {creationMode && onCreationModeChange ? (
            <CreationModeToggle
              mode={creationMode}
              onChange={onCreationModeChange}
              disabled={loading || uploading}
            />
          ) : null}
        </div>

        <div className="px-2 pb-2">
          <PromptComposer
            autoFocus
            attachmentsEnabled
            disabled={loading || uploading}
            placeholder={placeholder ?? t("home.describeBuild")}
            onSubmit={handleSubmit}
            draftScope={draftScope ?? title}
            initialText={restoredPromptText}
            initialTextKey={restoredPromptKey}
            attachButton={
              <PromptAttachmentMenu
                disabled={loading || uploading}
                onUploadFiles={(files) =>
                  setSelectedUploadFiles((current) => [...current, ...files])
                }
                onPickAsset={() => setAssetsPickerOpen(true)}
              />
            }
          />
        </div>

        {(onDesignSystemChange || onCreateDesignSystem) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3.5 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <IconPalette className="h-4 w-4 shrink-0 text-muted-foreground" />
              {designSystems.length > 0 ? (
                <Select
                  value={selectedDesignSystemId ?? "none"}
                  onValueChange={(value) =>
                    onDesignSystemChange?.(value === "none" ? null : value)
                  }
                  onOpenChange={(nextOpen) => {
                    if (!nextOpen) markNestedSelectJustClosed();
                  }}
                  disabled={designSystemsLoading}
                >
                  <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                    <SelectValue placeholder={t("promptDialog.designSystem")} />
                  </SelectTrigger>
                  <SelectContent data-agent-native-prompt-select>
                    <SelectItem value="none" className="text-xs">
                      {t("promptDialog.noDesignSystem")}
                    </SelectItem>
                    {designSystems.map((system) => (
                      <SelectItem
                        key={system.id}
                        value={system.id}
                        className="text-xs"
                      >
                        {system.title}
                        {system.isDefault ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {t("promptDialog.noDesignSystem")}
                </span>
              )}
            </div>
            {onCreateDesignSystem && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                onClick={onCreateDesignSystem}
              >
                <IconPlus className="h-3.5 w-3.5" />
                {t("promptDialog.newDesignSystem")}
              </Button>
            )}
          </div>
        )}

        {(selectedUploadFiles.length > 0 || pickedAssets.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3.5 py-2">
            {selectedUploadFiles.map((file, index) => (
              <span
                key={`${file.name}:${file.lastModified}:${file.size}:${index}`}
                className="inline-flex h-8 min-w-0 max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-muted/60 pl-2 pr-1 text-xs text-muted-foreground"
              >
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={t("promptDialog.removeAttachment", {
                    name: file.name,
                  })}
                  onClick={() => removeSelectedUploadFile(index)}
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {pickedAssets.map((asset) => (
              <span
                key={asset.path}
                className="inline-flex h-8 min-w-0 max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-muted/60 pl-2 pr-1 text-xs text-muted-foreground"
              >
                <span className="truncate">{asset.originalName}</span>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={t("promptDialog.removeAttachment", {
                    name: asset.originalName,
                  })}
                  onClick={() => removePickedAsset(asset.path)}
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {onSkip && (
          <div className="flex justify-end border-t border-border px-3.5 py-2">
            <button
              type="button"
              disabled={loading || skipInFlight}
              onClick={() => {
                if (loading || skipInFlightRef.current) return;
                skipInFlightRef.current = true;
                setSkipInFlight(true);
                void (async () => {
                  try {
                    await onSkip();
                    onOpenChange(false);
                  } catch {
                    // The caller owns error presentation. Keep the prompt open
                    // and usable so the user can retry or submit a prompt.
                    skipInFlightRef.current = false;
                    setSkipInFlight(false);
                  }
                })();
              }}
              className="cursor-pointer text-xs text-[#609FF8] hover:text-[#7AB2FA] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {skipLabel ?? t("promptDialog.skipPrompt")}
            </button>
          </div>
        )}

        <AssetsPickerDialog
          open={assetsPickerOpen}
          onOpenChange={setAssetsPickerOpen}
          url={assetsPickerUrl()}
          onReady={handleAssetsPickerReady}
          onMessage={handleAssetsPickerMessage}
        />
      </PopoverContent>
    </Popover>
  );
}

function PromptAttachmentMenu({
  disabled,
  onUploadFiles,
  onPickAsset,
}: {
  disabled?: boolean;
  onUploadFiles: (files: File[]) => void;
  onPickAsset: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          onUploadFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
          setOpen(false);
        }}
      />
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={t("promptDialog.addAttachment")}
        >
          <IconPlus className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        data-agent-native-composer-popover
        className="w-52 p-1"
      >
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-xs hover:bg-accent/50"
          onClick={() => inputRef.current?.click()}
        >
          <IconUpload className="h-3.5 w-3.5 text-muted-foreground" />
          <span>
            <span className="block font-medium text-foreground">
              {t("promptDialog.uploadFile")}
            </span>
            <span className="block text-[10px] text-muted-foreground">
              {t("promptDialog.uploadFileDescription")}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-xs hover:bg-accent/50"
          onClick={() => {
            setOpen(false);
            onPickAsset();
          }}
        >
          <IconPhoto className="h-3.5 w-3.5 text-muted-foreground" />
          <span>
            <span className="block font-medium text-foreground">
              {t("promptDialog.pickAsset")}
            </span>
            <span className="block text-[10px] text-muted-foreground">
              {t("promptDialog.pickAssetDescription")}
            </span>
          </span>
        </button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Compact segmented "Design" / "Full app" pill selector shown in the new-design
 * popover title row. Only rendered by the caller when full-app building is
 * flag-enabled (see FULL_APP_BUILDING_ENABLED in shared/full-app.ts) — when
 * absent the popover renders with no mode control at all.
 */
function CreationModeToggle({
  mode,
  onChange,
  disabled,
}: {
  mode: "design" | "app";
  onChange: (mode: "design" | "app") => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={
        "Design or full app" /* i18n-ignore compact new-design mode toggle, flag-gated */
      }
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-border bg-muted/40 p-0.5"
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === "design"}
        disabled={disabled}
        onClick={() => onChange("design")}
        className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 !text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          mode === "design"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground/80"
        }`}
      >
        <IconPalette className="h-3 w-3" />
        {"Design" /* i18n-ignore compact new-design mode toggle, flag-gated */}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === "app"}
        disabled={disabled}
        onClick={() => onChange("app")}
        className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 !text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          mode === "app"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground/80"
        }`}
      >
        <IconApps className="h-3 w-3" />
        {
          "Full app" /* i18n-ignore compact new-design mode toggle, flag-gated */
        }
      </button>
    </div>
  );
}
