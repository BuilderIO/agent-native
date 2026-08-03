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
  IconPlugConnected,
} from "@tabler/icons-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GoogleSlidesExportResult } from "@/lib/export-google-slides-client";

/** Google Slides' File → Import dialog, primed to ask for a file. */
const GOOGLE_SLIDES_IMPORT_URL =
  "https://docs.google.com/presentation/u/0/?usp=import";

interface ExportMenuProps {
  deckId: string;
  deckTitle: string;
  onDuplicate: () => void;
  onExportPdf: () => void;
  onExportPptx: () => Promise<void> | void;
  onExportGoogleSlides?: () => Promise<GoogleSlidesExportResult>;
  onShareLink?: () => void;
  onShareTeam?: () => void;
}

export function ExportMenu({
  deckId,
  deckTitle,
  onDuplicate,
  onExportPdf,
  onExportPptx,
  onExportGoogleSlides,
  onShareLink,
  onShareTeam,
}: ExportMenuProps) {
  const t = useT();
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

  const handleExportGoogleSlides = async () => {
    if (!onExportGoogleSlides) return;
    // Opened up-front: browsers only honour window.open() inside the click
    // gesture, and building the PPTX is async.
    const target = window.open("", "_blank");
    try {
      const result = await onExportGoogleSlides();
      if (result.url !== null) {
        if (target) target.location.href = result.url;
        toast.success(t("editorExport.googleSlidesCreated"), {
          description: t("editorExport.googleSlidesCreatedHint"),
        });
        return;
      }
      console.warn("Google Slides upload unavailable:", result.reason);
      if (target) target.location.href = GOOGLE_SLIDES_IMPORT_URL;
      toast.success(t("editorExport.googleSlidesDownloaded"), {
        description: t("editorExport.googleSlidesImportHint"),
      });
    } catch (err) {
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

  const handleConnectGoogle = async () => {
    const authUrl = new URL(
      agentNativePath("/_agent-native/google-docs/auth-url"),
      window.location.origin,
    );
    authUrl.searchParams.set(
      "return",
      window.location.pathname + window.location.search,
    );

    const popup = window.open(
      "",
      "google-docs-oauth",
      "popup,width=520,height=720",
    );
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent text-xs cursor-pointer whitespace-nowrap">
          <IconUpload className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{t("editorExport.export")}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-[11px] text-muted-foreground">
          {t("editorExport.exportAndDuplicate")}
        </DropdownMenuLabel>
        {onShareTeam && (
          <DropdownMenuItem onClick={onShareTeam} className="cursor-pointer">
            <IconShare2 className="w-4 h-4 mr-2" />
            {t("editorExport.shareWithTeam")}
          </DropdownMenuItem>
        )}
        {onShareLink && (
          <DropdownMenuItem onClick={onShareLink} className="cursor-pointer">
            <IconShare2 className="w-4 h-4 mr-2" />
            {t("editorExport.publicShareLink")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleExportHtml} className="cursor-pointer">
          <IconCode className="w-4 h-4 mr-2" />
          {t("editorExport.downloadHtml")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportPdf} className="cursor-pointer">
          <IconFileTypePdf className="w-4 h-4 mr-2" />
          {t("editorExport.exportPdf")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportPptx} className="cursor-pointer">
          <IconDownload className="w-4 h-4 mr-2" />
          {t("editorExport.exportPptx")}
        </DropdownMenuItem>
        {onExportGoogleSlides && (
          <>
            <DropdownMenuItem
              onClick={handleConnectGoogle}
              className="cursor-pointer"
            >
              <IconPlugConnected className="w-4 h-4 mr-2" />
              {t("editorExport.connectGoogle")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleExportGoogleSlides}
              className="cursor-pointer"
            >
              <IconBrandGoogle className="w-4 h-4 mr-2" />
              {t("editorExport.openInGoogleSlides")}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDuplicate} className="cursor-pointer">
          <IconCopy className="w-4 h-4 mr-2" />
          {t("editorExport.duplicateDeck")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
