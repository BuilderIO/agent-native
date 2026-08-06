import { appBasePath } from "@agent-native/core/client/api-path";
import { PromptComposer } from "@agent-native/core/client/composer";
import { ensureEmbedAuthFetchInterceptor } from "@agent-native/core/client/host";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconBrandGoogle,
  IconFileTypePdf,
  IconPresentation,
} from "@tabler/icons-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { GoogleDocImportHint } from "./GoogleDocImportHint";

export interface UploadedFile {
  path: string;
  url?: string;
  originalName: string;
  filename: string;
  type: string;
  size: number;
}

export async function uploadPromptFiles(
  files: File[],
): Promise<UploadedFile[]> {
  if (files.length === 0) return [];
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  ensureEmbedAuthFetchInterceptor();
  const response = await fetch(`${appBasePath()}/api/uploads`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!response.ok) {
    let message = "Upload failed";
    try {
      const data: unknown = await response.json();
      if (
        data &&
        typeof data === "object" &&
        "error" in data &&
        typeof data.error === "string" &&
        data.error.trim()
      ) {
        message = data.error;
      }
    } catch (error) {
      throw new Error(`Upload failed (${response.status})`, { cause: error });
    }
    throw new Error(message);
  }
  return (await response.json()) as UploadedFile[];
}

/**
 * Radix popovers portal to `document.body`, so a mousedown inside the model
 * picker or attachment menu reads as "outside" any panel that hosts a composer.
 * Closing on it unmounts the popover before its own click fires, which looks
 * exactly like a dead button.
 */
export function isInsidePortaledLayer(target: EventTarget | null): boolean {
  return Boolean(
    (target as Element | null)?.closest?.(
      "[data-radix-popper-content-wrapper]",
    ),
  );
}

export type PromptImportSource = "pdf" | "pptx" | "google-slides";

export type PromptImportSelection =
  | { kind: "pdf" | "pptx"; files: File[] }
  | { kind: "google-slides"; url: string };

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
  /** Forwarded to PromptComposer/TipTap for draft persistence in localStorage. */
  draftScope?: string;
  initialText?: string;
  initialTextKey?: string | number;
  onBeforeUpload?: (prompt: string, files: File[]) => boolean | void;
  onImport?: (
    selection: PromptImportSelection,
  ) => Promise<boolean | void> | boolean | void;
  importFromLabel?: string;
  importingLabel?: string;
  children?: React.ReactNode;
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
  draftScope,
  initialText,
  initialTextKey,
  onBeforeUpload,
  onImport,
  importFromLabel,
  importingLabel = "Importing...",
  children,
}: PromptPopoverProps) {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [googleDocContext, setGoogleDocContext] = useState("");
  const [googleSlidesUrl, setGoogleSlidesUrl] = useState("");
  const [googleSlidesInputOpen, setGoogleSlidesInputOpen] = useState(false);
  const [importingSource, setImportingSource] =
    useState<PromptImportSource | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const pptxInputRef = useRef<HTMLInputElement>(null);
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
      if (isInsidePortaledLayer(e.target)) return;
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
        return await uploadPromptFiles(files);
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    async (text: string, files: File[]) => {
      const enrichedText = [text.trim(), googleDocContext]
        .filter(Boolean)
        .join("\n\n");
      if (files.length > 0 && onBeforeUpload?.(enrichedText, files) === false) {
        return;
      }
      try {
        const uploaded = await uploadFiles(files);
        onSubmit(enrichedText, uploaded);
      } catch (error) {
        toast.error(t("raw.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("raw.uploadAttachedFailed"),
        });
      }
    },
    [googleDocContext, onBeforeUpload, onSubmit, uploadFiles, t],
  );

  const runImport = useCallback(
    async (selection: PromptImportSelection) => {
      if (!onImport) return;
      setImportingSource(selection.kind);
      try {
        const shouldClose = await onImport(selection);
        if (shouldClose !== false) onOpenChange(false);
      } catch (error) {
        toast.error(t("raw.uploadFailed"), {
          description:
            error instanceof Error
              ? error.message
              : t("raw.uploadAttachedFailed"),
        });
      } finally {
        setImportingSource(null);
      }
    },
    [onImport, onOpenChange, t],
  );

  const handleFileImport = useCallback(
    (kind: "pdf" | "pptx", file: File | undefined) => {
      if (!file) return;
      void runImport({ kind, files: [file] });
    },
    [runImport],
  );

  const handleGoogleSlidesImport = useCallback(() => {
    const url = googleSlidesUrl.trim();
    if (!url) return;
    void runImport({ kind: "google-slides", url });
  }, [googleSlidesUrl, runImport]);

  useEffect(() => {
    if (!open) {
      setPromptText("");
      setGoogleDocContext("");
      setGoogleSlidesUrl("");
      setGoogleSlidesInputOpen(false);
      setImportingSource(null);
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
        className="fixed z-[200] w-[min(500px,calc(100vw-24px))] rounded-xl border border-border/80 bg-popover shadow-xl shadow-black/15"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ top: 0, left: 0, visibility: "visible" }}
      >
        <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-3.5">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {onSkip && (
            <button
              type="button"
              onClick={() => {
                onSkip();
                onOpenChange(false);
              }}
              className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {skipLabel}
            </button>
          )}
        </div>

        <div className="px-2.5 pb-2.5">
          <PromptComposer
            autoFocus
            attachmentsEnabled
            disabled={loading || uploading}
            placeholder={placeholder}
            onSubmit={handleSubmit}
            onTextChange={setPromptText}
            draftScope={draftScope}
            initialText={initialText}
            initialTextKey={initialTextKey}
          />
        </div>

        {onImport && importFromLabel && (
          <div className="border-t border-border/60 px-4 pb-3 pt-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">
                {importFromLabel}
              </span>
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="sr-only"
                aria-label={t("editorToolbar.importFile")}
                onChange={(event) => {
                  handleFileImport("pdf", event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <input
                ref={pptxInputRef}
                type="file"
                accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                className="sr-only"
                aria-label={t("editorToolbar.importFile")}
                onChange={(event) => {
                  handleFileImport("pptx", event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={importingSource !== null || loading || uploading}
                onClick={() => pdfInputRef.current?.click()}
              >
                <IconFileTypePdf className="size-3.5" />
                PDF
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={importingSource !== null || loading || uploading}
                onClick={() => setGoogleSlidesInputOpen((current) => !current)}
              >
                <IconBrandGoogle className="size-3.5" />
                {t("home.googleSlidesReferenceTitle")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={importingSource !== null || loading || uploading}
                onClick={() => pptxInputRef.current?.click()}
              >
                <IconPresentation className="size-3.5" />
                PPT
              </Button>
              {importingSource && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {importingLabel}
                </span>
              )}
            </div>
            {googleSlidesInputOpen && (
              <div className="mt-2 flex gap-2">
                <Input
                  autoFocus
                  type="url"
                  value={googleSlidesUrl}
                  placeholder={t("home.googleSlidesReferenceUrl")}
                  aria-label={t("home.googleSlidesReferenceUrl")}
                  className="h-8 text-xs"
                  disabled={importingSource !== null || loading || uploading}
                  onChange={(event) => setGoogleSlidesUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleGoogleSlidesImport();
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8 shrink-0 px-3 text-xs"
                  disabled={
                    !googleSlidesUrl.trim() ||
                    importingSource !== null ||
                    loading ||
                    uploading
                  }
                  onClick={handleGoogleSlidesImport}
                >
                  Import
                </Button>
              </div>
            )}
          </div>
        )}

        {children}

        <GoogleDocImportHint
          promptText={promptText}
          onSourceContextChange={setGoogleDocContext}
        />
      </div>
    </>
  );

  return createPortal(popover, document.body);
}
