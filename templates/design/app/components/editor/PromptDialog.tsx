import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
  EmbeddedApp,
  type EmbeddedAppRef,
} from "@agent-native/embedding/react";
import {
  appBasePath,
  PromptComposer,
  type PromptComposerSubmitOptions,
} from "@agent-native/core/client";
import {
  IconPalette,
  IconPhoto,
  IconPlus,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Popover,
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
const MAX_CHAT_IMAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const CHAT_IMAGE_ATTACHMENT_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

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

function readChatImageAttachment(file: File): Promise<string | null> {
  if (
    file.size > MAX_CHAT_IMAGE_ATTACHMENT_BYTES ||
    !CHAT_IMAGE_ATTACHMENT_TYPES.has(file.type.toLowerCase())
  ) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
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
          <DialogTitle className="text-base">Assets</DialogTitle>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
          {!pickerReady && <AssetsPickerSkeleton />}
          <EmbeddedApp
            url={url}
            title="Assets image picker"
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
  return (
    <div
      className="absolute inset-0 flex flex-col gap-5 p-5"
      role="status"
      aria-label="Loading Assets picker"
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
    options: PromptComposerSubmitOptions,
  ) => void;
  loading?: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  centered?: boolean;
  designSystems?: PromptDesignSystemOption[];
  designSystemsLoading?: boolean;
  selectedDesignSystemId?: string | null;
  onDesignSystemChange?: (id: string | null) => void;
  onCreateDesignSystem?: () => void;
}

export interface PromptDesignSystemOption {
  id: string;
  title: string;
  description?: string | null;
  isDefault?: boolean;
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
  designSystems = [],
  designSystemsLoading = false,
  selectedDesignSystemId,
  onDesignSystemChange,
  onCreateDesignSystem,
}: PromptPopoverProps) {
  const [uploading, setUploading] = useState(false);
  const [pickedAssets, setPickedAssets] = useState<UploadedFile[]>([]);
  const [selectedUploadFiles, setSelectedUploadFiles] = useState<File[]>([]);
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) return;
    setAssetsPickerOpen(false);
    setPickedAssets([]);
    setSelectedUploadFiles([]);
  }, [open]);

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
      const target = e.target as Element | null;
      if (target?.closest("[data-agent-native-composer-popover]")) return;
      if (target?.closest("[data-assets-picker-dialog]")) return;
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        (!anchorRef?.current || !anchorRef.current.contains(e.target as Node))
      ) {
        onOpenChange(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !assetsPickerOpen) onOpenChange(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [assetsPickerOpen, open, onOpenChange, anchorRef]);

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
        const visualAttachments = await Promise.all(
          files.map((file) => readChatImageAttachment(file)),
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
      try {
        const uploaded = await uploadFiles([...files, ...selectedUploadFiles]);
        onSubmit(text.trim(), [...uploaded, ...pickedAssets], options);
        setPickedAssets([]);
        setSelectedUploadFiles([]);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to upload file",
        );
      }
    },
    [onSubmit, pickedAssets, selectedUploadFiles, uploadFiles],
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

      if (name !== "chooseImage") return;
      const url = pickedAssetImageSource(payload);
      if (!url) {
        toast.error("Assets did not return an image URL.");
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
      toast.success("Asset added");
    },
    [],
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

  if (!open) return null;

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
        className="fixed z-[200] w-[min(420px,calc(100vw-24px))] rounded-xl border border-border bg-popover shadow-2xl shadow-black/60"
        style={{ top: 0, left: 0, visibility: "visible" }}
      >
        <div className="px-3.5 pt-3 pb-2">
          <span className="text-sm font-medium text-foreground/90">
            {title}
          </span>
        </div>

        <div className="px-2 pb-2">
          <PromptComposer
            autoFocus
            attachmentsEnabled
            disabled={loading || uploading}
            placeholder={placeholder}
            onSubmit={handleSubmit}
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
                  disabled={designSystemsLoading}
                >
                  <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                    <SelectValue placeholder="Design system" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">
                      No design system
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
                  No design system
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
                New
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
                  aria-label={`Remove ${file.name}`}
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
                  aria-label={`Remove ${asset.originalName}`}
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
              onClick={() => {
                onSkip();
                onOpenChange(false);
              }}
              className="cursor-pointer text-xs text-[#609FF8] hover:text-[#7AB2FA]"
            >
              {skipLabel}
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
      </div>
    </>
  );

  return createPortal(popover, document.body);
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
          aria-label="Add"
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
              Upload file
            </span>
            <span className="block text-[10px] text-muted-foreground">
              Images, PDFs, text/code
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
              Pick asset
            </span>
            <span className="block text-[10px] text-muted-foreground">
              Browse or generate images
            </span>
          </span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
