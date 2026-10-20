// @vitest-environment happy-dom

import {
  Children,
  act,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";

import type { EditorActiveScreenAndGeometry } from "../domains/use-editor-active-screen-and-geometry";
import type { EditorCore } from "../domains/use-editor-core";
import type { EditorExportAndHandoff } from "../domains/use-editor-export-and-handoff";
import type { EditorFilesAndSaving } from "../domains/use-editor-files-and-saving";
import type { EditorGenerationAndAccess } from "../domains/use-editor-generation-and-access";
import { ExportMenuItems } from "./export-submenu-content";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

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
      generating: false,
      pendingGenerationActive: false,
    } as unknown as EditorGenerationAndAccess,
    editorFilesAndSaving: {
      overviewScreens: Array.from({ length: screenCount }, (_, index) => ({
        id: `screen-${index + 1}`,
      })),
      canvasFrameGeometryById: {},
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

type ExportMenuItemsProps = Parameters<typeof ExportMenuItems>[0];

function props({ generating }: { generating: boolean }): ExportMenuItemsProps {
  return {
    editorCore: {
      t: (key: string) => key,
      viewMode: "overview",
    } as unknown as EditorCore,
    editorGenerationAndAccess: {
      exportHtmlMutation: { isPending: false },
      exportZipMutation: { isPending: false },
      generating,
      pendingGenerationActive: false,
    } as unknown as EditorGenerationAndAccess,
    editorFilesAndSaving: {
      overviewScreens: [{ id: "first" }, { id: "second" }],
      canvasFrameGeometryById: {},
    } as unknown as EditorFilesAndSaving,
    editorActiveScreenAndGeometry: {
      activeFile: { id: "first" },
    } as unknown as EditorActiveScreenAndGeometry,
    editorExportAndHandoff: {
      handleDownloadHtml: vi.fn(),
      handleDownloadPng: vi.fn(),
      pngExporting: false,
      handleDownloadSvg: vi.fn(),
      svgExporting: false,
      handleDownloadFigmaSvg: vi.fn(),
      figmaSvgExporting: false,
      handleDownloadZip: vi.fn(),
      handleDownloadAllScreensPdf: vi.fn(),
      handleCopyCodingHandoff: vi.fn(),
      codingHandoffLoading: false,
    } as unknown as EditorExportAndHandoff,
    alwaysShowPdf: true,
  };
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function mount(generating: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        DropdownMenu,
        { open: true },
        createElement(
          DropdownMenuContent,
          null,
          createElement(ExportMenuItems, props({ generating })),
        ),
      ),
    );
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return host;
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

  it("disables every export while initial generation has no canvas frames", async () => {
    await mount(true);
    const items = document.querySelectorAll('[role="menuitem"]');

    expect(items).toHaveLength(7);
    expect(
      [...items].every((item) => item.getAttribute("aria-disabled") === "true"),
    ).toBe(true);
  });

  it("keeps frame-less exports available outside generation", async () => {
    await mount(false);
    const items = document.querySelectorAll('[role="menuitem"]');

    expect(items).toHaveLength(7);
    expect(
      [...items].every((item) => item.getAttribute("aria-disabled") !== "true"),
    ).toBe(true);
  });
});
