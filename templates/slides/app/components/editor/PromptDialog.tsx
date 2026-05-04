import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { appBasePath, PromptComposer } from "@agent-native/core/client";
import { GoogleDocImportHint } from "./GoogleDocImportHint";

export interface UploadedFile {
  path: string;
  originalName: string;
  filename: string;
  type: string;
  size: number;
}

interface PromptPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder?: string;
  onSkip?: () => void;
  skipLabel?: string;
  onSubmit: (prompt: string, files: UploadedFile[]) => void;
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
  const [promptText, setPromptText] = useState("");
  const [googleDocContext, setGoogleDocContext] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

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
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        (!anchorRef?.current || !anchorRef.current.contains(e.target as Node))
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
        if (!res.ok) return [];
        return (await res.json()) as UploadedFile[];
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    async (text: string, files: File[]) => {
      const uploaded = await uploadFiles(files);
      const enrichedText = [text.trim(), googleDocContext]
        .filter(Boolean)
        .join("\n\n");
      onSubmit(enrichedText, uploaded);
    },
    [googleDocContext, onSubmit, uploadFiles],
  );

  useEffect(() => {
    if (!open) {
      setPromptText("");
      setGoogleDocContext("");
    }
  }, [open]);

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
            onTextChange={setPromptText}
          />
        </div>

        <GoogleDocImportHint
          promptText={promptText}
          onSourceContextChange={setGoogleDocContext}
        />

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
      </div>
    </>
  );

  return createPortal(popover, document.body);
}
