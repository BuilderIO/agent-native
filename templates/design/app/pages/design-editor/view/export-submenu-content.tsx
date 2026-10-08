import {
  IconArchive,
  IconCode,
  IconDownload,
  IconFileExport,
  IconFileStack,
  IconPhoto,
} from "@tabler/icons-react";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorExportAndHandoff } from "../domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";

export function ExportSubmenuContent({
  editorCore,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorExportAndHandoff,
}: {
  editorCore: EditorCore;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorExportAndHandoff: EditorExportAndHandoff;
}) {
  const { t, viewMode } = editorCore;
  const { exportHtmlMutation, exportZipMutation } = editorGenerationAndAccess;
  const { overviewScreens } = editorFilesAndSaving;
  const { activeFile } = editorActiveScreenAndGeometry;
  const {
    handleDownloadHtml,
    handleDownloadPng,
    pngExporting,
    handleDownloadSvg,
    svgExporting,
    handleDownloadFigmaSvg,
    figmaSvgExporting,
    handleDownloadZip,
    handleDownloadAllScreensPdf,
    handleCopyCodingHandoff,
    codingHandoffLoading,
  } = editorExportAndHandoff;

  return (
    <DropdownMenuSubContent className="design-editor-app-menu-content w-56">
      <DropdownMenuItem
        onClick={handleDownloadHtml}
        disabled={!activeFile || exportHtmlMutation.isPending}
      >
        <IconCode className="mr-2 h-4 w-4" />
        {t("designEditor.downloadHtml")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => void handleDownloadPng()}
        disabled={!activeFile || pngExporting}
      >
        <IconPhoto className="mr-2 h-4 w-4" />
        {t("designEditor.downloadPng")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => void handleDownloadSvg()}
        disabled={!activeFile || svgExporting}
      >
        <IconCode className="mr-2 h-4 w-4" />
        {t("designEditor.downloadSvg")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => void handleDownloadFigmaSvg()}
        disabled={!activeFile || figmaSvgExporting}
      >
        <IconFileExport className="mr-2 h-4 w-4" />
        {t("designEditor.downloadFigmaSvg")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={handleDownloadZip}
        disabled={!activeFile || exportZipMutation.isPending}
      >
        <IconArchive className="mr-2 h-4 w-4" />
        {t("designEditor.downloadZip")}
      </DropdownMenuItem>
      {viewMode === "overview" && overviewScreens.length >= 2 ? (
        <DropdownMenuItem
          onClick={() => void handleDownloadAllScreensPdf()}
          disabled={pngExporting}
        >
          <IconFileStack className="mr-2 h-4 w-4" />
          {t("designEditor.downloadPdfAllScreens")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={handleCopyCodingHandoff}
        disabled={!activeFile || codingHandoffLoading}
      >
        <IconDownload className="mr-2 h-4 w-4" />
        {t("designEditor.copyCodingHandoff")}
      </DropdownMenuItem>
    </DropdownMenuSubContent>
  );
}
