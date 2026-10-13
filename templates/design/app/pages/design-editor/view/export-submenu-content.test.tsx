import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorExportAndHandoff } from "../domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import { ExportMenuItems } from "./export-submenu-content";

function disabledByLabel(screenCount: number) {
  const noop = vi.fn();
  const menu = ExportMenuItems({
    editorCore: {
      t: (key: string) => key,
      viewMode: "single",
    } as unknown as EditorCore,
    editorGenerationAndAccess: {
      exportHtmlMutation: { isPending: false },
      exportZipMutation: { isPending: false },
    } as unknown as EditorGenerationAndAccess,
    editorFilesAndSaving: {
      overviewScreens: Array.from({ length: screenCount }, (_, index) => ({
        id: `screen-${index + 1}`,
      })),
    } as unknown as EditorFilesAndSaving,
    editorActiveScreenAndGeometry: {
      activeFile: { id: "screen-1" },
    } as unknown as EditorActiveScreenAndGeometry,
    editorExportAndHandoff: {
      handleDownloadHtml: noop,
      handleDownloadPng: noop,
      pngExporting: false,
      handleDownloadSvg: noop,
      svgExporting: false,
      handleDownloadFigmaSvg: noop,
      figmaSvgExporting: false,
      handleDownloadZip: noop,
      handleDownloadAllScreensPdf: noop,
      handleCopyCodingHandoff: noop,
      codingHandoffLoading: false,
    } as unknown as EditorExportAndHandoff,
    alwaysShowPdf: true,
  });
  const children = Children.toArray(
    (menu as ReactElement<{ children?: ReactNode }>).props.children,
  );
  return Object.fromEntries(
    children.flatMap((child) => {
      if (!isValidElement<{ children?: ReactNode; disabled?: boolean }>(child))
        return [];
      const label = Children.toArray(child.props.children).join("").trim();
      return label ? [[label, child.props.disabled ?? false]] : [];
    }),
  );
}

describe("Design export menu", () => {
  it("disables exports until a screen exists", () => {
    expect(disabledByLabel(0)).toEqual({
      "designEditor.downloadHtml": true,
      "designEditor.downloadPng": true,
      "designEditor.downloadSvg": true,
      "designEditor.downloadFigmaSvg": true,
      "designEditor.downloadZip": true,
      "designEditor.downloadPdfAllScreens": true,
      "designEditor.copyCodingHandoff": true,
    });
  });

  it("keeps single-screen exports available after a screen exists", () => {
    expect(disabledByLabel(1)).toMatchObject({
      "designEditor.downloadHtml": false,
      "designEditor.downloadPng": false,
      "designEditor.downloadSvg": false,
      "designEditor.downloadFigmaSvg": false,
      "designEditor.downloadZip": false,
      "designEditor.copyCodingHandoff": false,
    });
  });
});
