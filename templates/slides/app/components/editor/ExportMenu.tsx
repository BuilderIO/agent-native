import { appBasePath, useT } from "@agent-native/core/client";
import {
  IconDownload,
  IconFileTypePdf,
  IconCode,
  IconCopy,
  IconShare2,
  IconBrandGoogle,
} from "@tabler/icons-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";

interface ExportMenuProps {
  deckId: string;
  deckTitle: string;
  onDuplicate: () => void;
  onExportPdf: () => void;
  onExportPptx: () => Promise<void> | void;
  onShareLink?: () => void;
  onShareTeam?: () => void;
}

export function ExportMenu({
  deckId,
  deckTitle,
  onDuplicate,
  onExportPdf,
  onExportPptx,
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
      toast({
        title: t("editorExport.exportFailed"),
        description:
          err instanceof Error
            ? err.message
            : t("editorExport.exportPptxError"),
        variant: "destructive",
      });
    }
  };

  const handleExportGoogleSlides = async () => {
    try {
      await onExportPptx();
      toast({
        title: t("editorExport.googleSlidesDownloaded"),
        description: t("editorExport.googleSlidesImportHint"),
      });
    } catch (err) {
      console.error("Export failed:", err);
      toast({
        title: t("editorExport.exportFailed"),
        description:
          err instanceof Error
            ? err.message
            : t("editorExport.exportGoogleSlidesError"),
        variant: "destructive",
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
      toast({
        title: t("editorExport.exportFailed"),
        description:
          err instanceof Error
            ? err.message
            : t("editorExport.exportHtmlError"),
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent text-xs cursor-pointer whitespace-nowrap">
          <IconDownload className="w-3.5 h-3.5" />
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
        <DropdownMenuItem
          onClick={handleExportGoogleSlides}
          className="cursor-pointer"
        >
          <IconBrandGoogle className="w-4 h-4 mr-2" />
          {t("editorExport.downloadGoogleSlides")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onDuplicate} className="cursor-pointer">
          <IconCopy className="w-4 h-4 mr-2" />
          {t("editorExport.duplicateDeck")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
