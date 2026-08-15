import {
  agentNativePath,
  appBasePath,
} from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconDownload,
  IconUpload,
  IconFileTypePdf,
  IconCode,
  IconCopy,
  IconShare2,
  IconBrandGoogle,
} from "@tabler/icons-react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { useDecks } from "@/context/DeckContext";
import type { GoogleSlidesExportResult } from "@/lib/export-google-slides-client";

/** Google Slides' File → Import dialog, primed to ask for a file. */
const GOOGLE_SLIDES_IMPORT_URL =
  "https://docs.google.com/presentation/u/0/?usp=import";

/**
 * The importer stamps this on every slide it writes, and `parseSlideHtml` in
 * actions/export-pptx.ts branches on the same marker: those slides carry the
 * source file's own geometry, which the server emits as real `custGeom` vector
 * shapes. dom-to-pptx has no custGeom at all and rasterizes them to PNGs.
 */
const IMPORTED_SLIDE_MARKER = 'data-imported-pptx="true"';

/**
 * Objects whose geometry only exists once a browser has laid the slide out:
 * `freezeSlideElementForFreeform` and the text-box tool mint
 * `data-slide-object-id` client-side, while every object the importer emits
 * also carries `data-pptx-element-kind`. The server has no layout engine to
 * measure the former, so it refuses those slides rather than reflowing them.
 */
const BROWSER_AUTHORED_OBJECT =
  "[data-slide-object-id]:not([data-pptx-element-kind]), .fmd-freeform-object";

/**
 * Whether the vector-capable server exporter can render this deck losslessly.
 * `get-deck` returns the import receipt alongside the deck body, so the client
 * deck carries `sourceImport` at runtime even though the type predates it.
 */
export function canExportPptxFromServer(
  deck:
    | { sourceImport?: unknown; slides: { content?: string }[] }
    | null
    | undefined,
): boolean {
  if (!deck?.sourceImport || deck.slides.length === 0) return false;
  return deck.slides.every((slide) => {
    const html = slide.content ?? "";
    if (!html.includes(IMPORTED_SLIDE_MARKER)) return false;
    return !new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector(BROWSER_AUTHORED_OBJECT);
  });
}

interface ExportMenuProps {
  deckId: string;
  deckTitle: string;
  onDuplicate: () => void;
  onExportPdf: () => void;
  onExportPptx: () => Promise<void> | void;
  onExportGoogleSlides?: () => Promise<GoogleSlidesExportResult>;
  onShareLink?: () => void;
  onShareTeam?: () => void;
  /** Render the export actions inside an existing dropdown menu. */
  inline?: boolean;
}

export interface ExportMenuHandle {
  exportGoogleSlides: () => Promise<void>;
  exportHtml: () => Promise<void>;
  exportPptx: () => Promise<void>;
}

export const ExportMenu = forwardRef<ExportMenuHandle, ExportMenuProps>(
  function ExportMenu(
    {
      deckId,
      deckTitle,
      onDuplicate,
      onExportPdf,
      onExportPptx,
      onExportGoogleSlides,
      onShareLink,
      onShareTeam,
      inline = false,
    },
    ref,
  ) {
    const t = useT();
    const [googleSlidesImportOpen, setGoogleSlidesImportOpen] = useState(false);
    const googleSlidesImportTarget = useRef<Window | null>(null);
    const triggerBlobDownload = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    const filenameFromDisposition = (
      value: string | null,
      fallbackExt: string,
    ) => {
      const match = value?.match(/filename="?([^"]+)"?/i);
      const fallback = deckTitle.replace(/[^a-zA-Z0-9_-]/g, "-") || "deck";
      return match?.[1] ?? `${fallback}${fallbackExt}`;
    };

    const readErrorMessage = async (res: Response, fallback: string) => {
      try {
        const data = await res.json();
        return data.error || data.message || fallback;
      } catch {
        return fallback;
      }
    };

    const handleExportPptx = async () => {
      try {
        await onExportPptx();
      } catch (err) {
        console.error("Export failed:", err);
        toast.error(t("editorExport.exportFailed"), {
          description:
            err instanceof Error
              ? err.message
              : t("editorExport.exportPptxError"),
        });
      }
    };

    const handleConnectGoogle = async (target?: Window | null) => {
      const authUrl = new URL(
        agentNativePath("/_agent-native/google-docs/auth-url"),
        window.location.origin,
      );
      authUrl.searchParams.set(
        "return",
        window.location.pathname + window.location.search,
      );

      const popup =
        target ??
        window.open("", "google-docs-oauth", "popup,width=520,height=720");
      if (!popup) {
        toast.error(t("editorExport.exportFailed"), {
          description: t("editorExport.exportGoogleSlidesError"),
        });
        return;
      }

      try {
        const response = await fetch(authUrl.toString(), {
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new Error(
            await readErrorMessage(
              response,
              t("editorExport.exportGoogleSlidesError"),
            ),
          );
        }
        const data = (await response.json()) as { url?: unknown };
        if (typeof data.url !== "string") {
          throw new Error(t("editorExport.exportGoogleSlidesError"));
        }
        popup.location.href = data.url;
      } catch (err) {
        popup?.close();
        console.error("Google connection failed:", err);
        toast.error(t("editorExport.exportFailed"), {
          description:
            err instanceof Error
              ? err.message
              : t("editorExport.exportGoogleSlidesError"),
        });
      }
    };

    const handleExportGoogleSlides = async () => {
      if (!onExportGoogleSlides) return;
      // Opened up-front: browsers only honour window.open() inside the click
      // gesture, and building the PPTX is async. If the account is missing,
      // the same tab becomes the OAuth popup so the export action owns setup.
      const target = window.open("", "_blank");
      googleSlidesImportTarget.current = target;
      try {
        const result = await onExportGoogleSlides();
        if ("requiresConnection" in result && result.requiresConnection) {
          googleSlidesImportTarget.current = null;
          await handleConnectGoogle(target);
          return;
        }
        if (result.url !== null) {
          googleSlidesImportTarget.current = null;
          if (target) target.location.href = result.url;
          toast.success(t("editorExport.googleSlidesCreated"), {
            description: t("editorExport.googleSlidesCreatedHint"),
          });
          return;
        }
        if (target) target.location.href = GOOGLE_SLIDES_IMPORT_URL;
        setGoogleSlidesImportOpen(true);
        // The deck did not reach Drive. Saying "success" here is why users read
        // the .pptx download as the intended result and never learn that Drive
        // rejected the upload.
        toast.warning(t("editorExport.googleSlidesDownloaded"), {
          description: `${result.reason} ${t("editorExport.googleSlidesImportHint")}`,
        });
      } catch (err) {
        googleSlidesImportTarget.current = null;
        target?.close();
        console.error("Export failed:", err);
        toast.error(t("editorExport.exportFailed"), {
          description:
            err instanceof Error
              ? err.message
              : t("editorExport.exportGoogleSlidesError"),
        });
      }
    };

    const handleExportHtml = async () => {
      try {
        const res = await fetch(`${appBasePath()}/api/exports/html`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deckId }),
        });
        if (!res.ok) {
          throw new Error(
            await readErrorMessage(res, t("editorExport.htmlFailed")),
          );
        }
        const blob = await res.blob();
        const filename = filenameFromDisposition(
          res.headers.get("content-disposition"),
          ".html",
        );
        triggerBlobDownload(blob, filename);
      } catch (err) {
        console.error("Export failed:", err);
        toast.error(t("editorExport.exportFailed"), {
          description:
            err instanceof Error
              ? err.message
              : t("editorExport.exportHtmlError"),
        });
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        exportGoogleSlides: handleExportGoogleSlides,
        exportHtml: handleExportHtml,
        exportPptx: handleExportPptx,
      }),
      [handleExportGoogleSlides, handleExportHtml, handleExportPptx],
    );

    const exportActions = (
      <>
        <DropdownMenuItem onClick={handleExportHtml} className="cursor-pointer">
          <IconCode className="size-4" />
          {t("editorExport.downloadHtml")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportPdf} className="cursor-pointer">
          <IconFileTypePdf className="size-4" />
          {t("editorExport.exportPdf")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportPptx} className="cursor-pointer">
          <IconDownload className="size-4" />
          {t("editorExport.exportPptx")}
        </DropdownMenuItem>
        {onExportGoogleSlides && (
          <DropdownMenuItem
            onClick={handleExportGoogleSlides}
            className="cursor-pointer"
          >
            <IconBrandGoogle className="size-4" />
            {t("editorExport.openInGoogleSlides")}
          </DropdownMenuItem>
        )}
      </>
    );

    const shareActions = (
      <>
        {onShareTeam && (
          <DropdownMenuItem onClick={onShareTeam} className="cursor-pointer">
            <IconShare2 className="size-4" />
            {t("editorExport.shareWithTeam")}
          </DropdownMenuItem>
        )}
        {onShareLink && (
          <DropdownMenuItem onClick={onShareLink} className="cursor-pointer">
            <IconShare2 className="size-4" />
            {t("editorExport.publicShareLink")}
          </DropdownMenuItem>
        )}
      </>
    );

    const duplicateAction = (
      <DropdownMenuItem onClick={onDuplicate} className="cursor-pointer">
        <IconCopy className="size-4" />
        {t("editorExport.duplicateDeck")}
      </DropdownMenuItem>
    );

    const menuContent = (
      <>
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          {t("editorExport.exportAndDuplicate")}
        </DropdownMenuLabel>
        {shareActions}
        <DropdownMenuSeparator />
        {exportActions}
        <DropdownMenuSeparator />
        {duplicateAction}
      </>
    );

    const inlineMenuContent = (
      <>
        {onShareTeam || onShareLink ? (
          <>
            {shareActions}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="cursor-pointer gap-2">
            <IconUpload className="size-4" />
            {t("editorExport.export")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {exportActions}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {duplicateAction}
      </>
    );

    return (
      <>
        {inline ? (
          inlineMenuContent
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent text-xs cursor-pointer whitespace-nowrap">
                <IconUpload className="w-3.5 h-3.5" />
                <span className="hidden md:inline">
                  {t("editorExport.export")}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {menuContent}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Dialog
          open={googleSlidesImportOpen}
          onOpenChange={setGoogleSlidesImportOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("editorExport.googleSlidesDownloaded")}
              </DialogTitle>
              <DialogDescription>
                {t("editorExport.googleSlidesImportHint")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  const target = googleSlidesImportTarget.current;
                  if (target && !target.closed) {
                    target.focus?.();
                  } else {
                    window.open(GOOGLE_SLIDES_IMPORT_URL, "_blank");
                  }
                  setGoogleSlidesImportOpen(false);
                }}
              >
                {t("editorExport.openInGoogleSlides")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  },
);
