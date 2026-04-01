import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  IconLoader2,
  IconPaperclip,
  IconX,
  IconArrowUp,
} from "@tabler/icons-react";

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
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setPrompt("");
      setFiles([]);
      setUploadedFiles([]);
      setDragging(false);
    }
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

    // Vertical: prefer below, flip above if needed
    let top = anchor.bottom + MARGIN;
    if (top + panelRect.height > vh - MARGIN) {
      top = Math.max(MARGIN, anchor.top - panelRect.height - MARGIN);
    }

    // Horizontal: center on anchor, then clamp to stay within viewport
    const anchorCenterX = anchor.left + anchor.width / 2;
    let left = anchorCenterX - panelRect.width / 2;

    // Clamp: don't go off right edge
    if (left + panelRect.width > vw - MARGIN) {
      left = vw - panelRect.width - MARGIN;
    }
    // Clamp: don't go off left edge
    if (left < MARGIN) {
      left = MARGIN;
    }

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

  const uploadFiles = useCallback(async (newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
    setUploading(true);
    try {
      const formData = new FormData();
      newFiles.forEach((f) => formData.append("files", f));
      const res = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const results: UploadedFile[] = await res.json();
        setUploadedFiles((prev) => [...prev, ...results]);
      }
    } catch {
      /* silent */
    } finally {
      setUploading(false);
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0) return;
    uploadFiles(Array.from(selected));
    e.target.value = "";
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) uploadFiles(droppedFiles);
    },
    [uploadFiles],
  );

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (!prompt.trim() && uploadedFiles.length === 0) return;
    onSubmit(prompt.trim(), uploadedFiles);
  };

  const busy = loading || uploading;
  const hasContent = prompt.trim().length > 0 || uploadedFiles.length > 0;

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
        className={`fixed z-[200] w-[min(400px,calc(100vw-24px))] rounded-xl border bg-[hsl(240,5%,10%)] shadow-2xl shadow-black/60 overflow-hidden transition-colors ${
          dragging
            ? "border-[#609FF8]/50 bg-[hsl(240,5%,12%)]"
            : "border-white/[0.1]"
        }`}
        style={{ top: 0, left: 0, visibility: "visible" }}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
      >
        <div className="px-3.5 pt-3 pb-1.5">
          <span className="text-sm font-medium text-white/80">{title}</span>
        </div>

        <div className="px-3.5 pb-2">
          <textarea
            ref={inputRef}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              const el = e.target;
              el.style.height = "auto";
              el.style.height =
                Math.min(el.scrollHeight, window.innerHeight * 0.5) + "px";
            }}
            placeholder={placeholder}
            className="w-full bg-transparent text-sm text-white/90 placeholder:text-white/30 outline-none resize-none"
            rows={3}
            style={{ maxHeight: "50vh" }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
        </div>

        {/* File chips */}
        {files.length > 0 && (
          <div className="px-3.5 pb-2 flex flex-wrap gap-1.5">
            {files.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/[0.08] text-[11px] text-white/50"
              >
                <span className="max-w-[120px] truncate">{file.name}</span>
                <button
                  onClick={() => removeFile(i)}
                  className="p-0.5 rounded hover:bg-white/[0.1]"
                  aria-label={`Remove ${file.name}`}
                >
                  <IconX className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Bottom bar */}
        <div className="px-3.5 py-2 flex items-center justify-between border-t border-white/[0.06]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-md hover:bg-white/[0.06] text-white/30 hover:text-white/50 transition-colors"
              title="Attach files"
              aria-label="Attach files"
            >
              <IconPaperclip className="w-4 h-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <div className="flex items-center gap-3">
            {onSkip && (
              <button
                onClick={() => {
                  onSkip();
                  onOpenChange(false);
                }}
                className="text-xs text-[#609FF8] hover:text-[#7AB2FA] transition-colors"
              >
                {skipLabel}
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={busy || !hasContent}
              className={`p-1.5 rounded-lg transition-colors ${
                hasContent && !busy
                  ? "bg-[#609FF8] hover:bg-[#7AB2FA] text-black"
                  : "bg-white/[0.12] hover:bg-white/[0.18] disabled:opacity-30 disabled:cursor-not-allowed"
              }`}
              title="Submit"
              aria-label="Submit"
            >
              {busy ? (
                <IconLoader2
                  className={`w-4 h-4 animate-spin ${hasContent ? "text-black" : "text-white/70"}`}
                />
              ) : (
                <IconArrowUp
                  className={`w-4 h-4 ${hasContent ? "text-black" : "text-white/70"}`}
                />
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(popover, document.body);
}
