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

export function ExportMenuItems({
  editorCore,
  editorGenerationAndAccess,
  editorFilesAndSaving,
  editorActiveScreenAndGeometry,
  editorExportAndHandoff,
  alwaysShowPdf = false,
}: {
  editorCore: EditorCore;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorExportAndHandoff: EditorExportAndHandoff;
  alwaysShowPdf?: boolean;
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

  const canExportAllScreens =
    viewMode === "overview" && overviewScreens.length >= 2;

  return (
    <>
      <DropdownMenuItem
        onClick={handleDownloadHtml}
        disabled={!activeFile || exportHtmlMutation.isPending}
      >
        {t("designEditor.downloadHtml")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => void handleDownloadPng()}
        disabled={!activeFile || pngExporting}
      >
        {t("designEditor.downloadPng")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => void handleDownloadSvg()}
        disabled={!activeFile || svgExporting}
      >
        {t("designEditor.downloadSvg")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => void handleDownloadFigmaSvg()}
        disabled={!activeFile || figmaSvgExporting}
      >
        {t("designEditor.downloadFigmaSvg")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={handleDownloadZip}
        disabled={!activeFile || exportZipMutation.isPending}
      >
        {t("designEditor.downloadZip")}
      </DropdownMenuItem>
      {alwaysShowPdf || canExportAllScreens ? (
        <DropdownMenuItem
          onClick={() => void handleDownloadAllScreensPdf()}
          disabled={!canExportAllScreens || pngExporting}
        >
          {t("designEditor.downloadPdfAllScreens")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={handleCopyCodingHandoff}
        disabled={!activeFile || codingHandoffLoading}
      >
        {t("designEditor.copyCodingHandoff")}
      </DropdownMenuItem>
    </>
  );
}

export function ExportSubmenuContent(props: {
  editorCore: EditorCore;
  editorGenerationAndAccess: EditorGenerationAndAccess;
  editorFilesAndSaving: EditorFilesAndSaving;
  editorActiveScreenAndGeometry: EditorActiveScreenAndGeometry;
  editorExportAndHandoff: EditorExportAndHandoff;
}) {
  return (
    <DropdownMenuSubContent className="design-editor-app-menu-content w-56">
      <ExportMenuItems {...props} />
    </DropdownMenuSubContent>
  );
}
