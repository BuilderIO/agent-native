import { appBasePath, sendToAgentChat, useT } from "@agent-native/core/client";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

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
 * what to do with it, and hands the task off to the agent chat with the image
 * uploaded to Builder.io as a reference URL.
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
      // Use the slides assets endpoint (which routes through the framework's
      // uploadFile() provider chain first, then falls back to local disk in
      // dev). Goes via Builder.io when configured; works without it in dev.
      const res = await fetch(`${appBasePath()}/api/assets/upload`, {
        method: "POST",
        body: form,
      });
      const data = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.url) {
        throw new Error(
          data?.error ||
            "Image upload failed. Connect Builder.io from the agent composer model menu, or register a custom provider via registerFileUploadProvider().",
        );
      }

      const userIntent = prompt.trim();
      const intentLine =
        userIntent.length > 0
          ? userIntent
          : "Use this image on the current slide.";
      const lines = [intentLine];
      if (contextHint && contextHint.trim().length > 0) {
        lines.push(contextHint.trim());
      }
      lines.push(
        `Image URL (already uploaded): ${data.url}`,
        `Filename: ${file.name}`,
      );

      sendToAgentChat({
        message: lines.join("\n\n"),
        submit: true,
        referenceImagePaths: [data.url],
      });

      onClose();
      toast({
        title: t("raw.sentToAgent"),
        description: file.name,
      });
    } catch (err) {
      toast({
        title: t("raw.imageUploadFailed"),
        description:
          err instanceof Error ? err.message : t("raw.imageUploadGenericError"),
        variant: "destructive",
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
