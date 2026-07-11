import { appBasePath, sendToAgentChat, useT } from "@agent-native/core/client";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  buildImageDropAgentPayload,
  readFileAsDataUrl,
  type HostedImageUploadResult,
} from "@/lib/image-drop-to-agent";
import { parseUploadResponse } from "@/lib/upload-response";

const POPOVER_WIDTH = 360;
const POPOVER_MARGIN = 12;

interface ImageDropPromptPopoverProps {
  open: boolean;
  file: File | null;
  /** Drop position in viewport coordinates. */
  position: { x: number; y: number } | null;
  /** Optional deck/slide context to include in the agent prompt. */
  contextHint?: string;
  onClose: () => void;
}

/**
 * Popover shown after a user drops an image somewhere on the slides editor
 * that doesn't have a clear target (i.e. not on an image placeholder or
 * existing `<img>`). The popover previews the image, lets the user describe
 * what to do with it, and hands the task off to the agent chat.
 *
 * Prefers a hosted CDN URL via `/api/assets/upload` when a file-upload
 * provider (Builder.io / S3 / …) is configured. When nothing is configured,
 * falls back to an inline data-URL attachment so the drop still reaches the
 * agent instead of toasting a 503.
 *
 * Why this exists: dropping image files onto an unclear target previously did
 * one of two unhelpful things — opened the file in a new browser tab (when the
 * drop landed outside the slide canvas) or silently inserted the image into
 * the first placeholder (when the user wanted something else). This popover
 * makes the intent explicit and routes the work through the agent so the user
 * can phrase the ask in plain language.
 */
export default function ImageDropPromptPopover({
  open,
  file,
  position,
  contextHint,
  onClose,
}: ImageDropPromptPopoverProps) {
  const t = useT();
  const [prompt, setPrompt] = useState("");
  const [uploading, setUploading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const previewUrl = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!open) {
      setPrompt("");
      setUploading(false);
      return;
    }
    const id = window.setTimeout(() => textareaRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Position relative to drop point, clamped within the viewport.
  const computedPosition = useMemo(() => {
    if (!position) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const width = POPOVER_WIDTH;
    const height = 320;
    let left = position.x - width / 2;
    let top = position.y + POPOVER_MARGIN;
    if (left < POPOVER_MARGIN) left = POPOVER_MARGIN;
    if (left + width > vw - POPOVER_MARGIN) left = vw - width - POPOVER_MARGIN;
    if (top + height > vh - POPOVER_MARGIN) {
      // Flip above the drop point if there isn't room below.
      top = Math.max(POPOVER_MARGIN, position.y - height - POPOVER_MARGIN);
    }
    return { top: `${top}px`, left: `${left}px`, transform: "none" };
  }, [position]);

  if (!open || !file) return null;

  const handleSubmit = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      // Prefer the hosted provider chain. When none is configured the route
      // returns 503 — fall back to an inline data URL so the agent still gets
      // the image (chat already accepts `images` data URLs).
      const res = await fetch(`${appBasePath()}/api/assets/upload`, {
        method: "POST",
        body: form,
      });
      const data = await parseUploadResponse<{
        url?: string;
        error?: string;
      }>(res, t("raw.imageUploadGenericError"));
      const upload: HostedImageUploadResult = {
        ok: res.ok && !!data.url,
        status: res.status,
        url: data.url,
        error: data.error,
      };

      let dataUrl: string | undefined;
      if (!upload.ok) {
        dataUrl = await readFileAsDataUrl(file);
      }

      const payload = buildImageDropAgentPayload({
        intent: prompt,
        contextHint,
        filename: file.name,
        upload,
        dataUrl,
      });

      if (payload.kind === "hosted") {
        sendToAgentChat({
          message: payload.message,
          submit: true,
          referenceImagePaths: payload.referenceImagePaths,
        });
      } else {
        sendToAgentChat({
          message: payload.message,
          submit: true,
          images: payload.images,
        });
      }

      onClose();
      toast.success(t("raw.sentToAgent"), {
        description: file.name,
      });
    } catch (err) {
      toast.error(t("raw.imageUploadFailed"), {
        description:
          err instanceof Error ? err.message : t("raw.imageUploadGenericError"),
      });
    } finally {
      setUploading(false);
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("raw.imagePromptTitle")}
      className="fixed z-[210] rounded-xl border border-border bg-popover shadow-2xl shadow-black/60"
      style={{ width: POPOVER_WIDTH, ...computedPosition }}
    >
      <div className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-2">
        <span className="text-sm font-medium text-foreground/90">
          {t("raw.imagePromptTitle")}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>

      {previewUrl && (
        <div className="px-3 pb-2">
          <div className="overflow-hidden rounded-md border border-border bg-muted/40">
            <img
              src={previewUrl}
              alt={file.name}
              className="block max-h-40 w-full object-contain"
            />
          </div>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {file.name}
          </p>
        </div>
      )}

      <div className="px-3 pb-3">
        <Textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (
              (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ||
              (e.key === "Enter" && !e.shiftKey)
            ) {
              e.preventDefault();
              if (!uploading) void handleSubmit();
            }
          }}
          placeholder={t("raw.imagePromptPlaceholder")}
          rows={3}
          disabled={uploading}
          className="resize-none text-sm"
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={uploading}
          >
            {uploading ? (
              <span className="inline-flex items-center gap-1.5">
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                {t("raw.uploading")}
              </span>
            ) : (
              t("raw.sendToAgent")
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
