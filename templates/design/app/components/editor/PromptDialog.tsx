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
import { IconPhoto, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export interface UploadedFile {
  path: string;
  originalName: string;
  filename: string;
  type: string;
  size: number;
  textContent?: string;
  textTruncated?: boolean;
}

const DEFAULT_ASSETS_PICKER_URL = "https://assets.agent-native.com/picker";

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
}: PromptPopoverProps) {
  const [uploading, setUploading] = useState(false);
  const [pickedAssets, setPickedAssets] = useState<UploadedFile[]>([]);
  const [assetsPickerOpen, setAssetsPickerOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) return;
    setAssetsPickerOpen(false);
    setPickedAssets([]);
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
        return (await res.json()) as UploadedFile[];
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
        const uploaded = await uploadFiles(files);
        onSubmit(text.trim(), [...uploaded, ...pickedAssets], options);
        setPickedAssets([]);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to upload file",
        );
      }
    },
    [onSubmit, pickedAssets, uploadFiles],
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
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={loading || uploading}
            onClick={() => setAssetsPickerOpen(true)}
          >
            <IconPhoto className="h-4 w-4" />
            Assets
          </Button>
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

        <Dialog open={assetsPickerOpen} onOpenChange={setAssetsPickerOpen}>
          <DialogContent
            data-assets-picker-dialog
            className="flex h-[min(86vh,760px)] w-[min(96vw,1040px)] max-w-none flex-col gap-0 overflow-hidden p-0"
          >
            <div className="flex h-12 shrink-0 items-center border-b px-4">
              <DialogTitle className="text-base">Assets</DialogTitle>
            </div>
            <EmbeddedApp
              url={assetsPickerUrl()}
              title="Assets image picker"
              className="min-h-0 flex-1 border-0 bg-background"
              onReady={handleAssetsPickerReady}
              onMessage={handleAssetsPickerMessage}
            />
          </DialogContent>
        </Dialog>
      </div>
    </>
  );

  return createPortal(popover, document.body);
}
