// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";

import { ExportMenuItems } from "./export-submenu-content";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

type ExportMenuItemsProps = Parameters<typeof ExportMenuItems>[0];

function props({ generating }: { generating: boolean }): ExportMenuItemsProps {
  return {
    editorCore: {
      t: (key: string) => key,
      viewMode: "overview",
    },
    editorGenerationAndAccess: {
      exportHtmlMutation: { isPending: false },
      exportZipMutation: { isPending: false },
      generating,
      pendingGenerationActive: false,
    },
    editorFilesAndSaving: {
      overviewScreens: [{ id: "first" }, { id: "second" }],
      canvasFrameGeometryById: {},
    },
    editorActiveScreenAndGeometry: {
      activeFile: { id: "first" },
    },
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
    },
    alwaysShowPdf: true,
  } as unknown as ExportMenuItemsProps;
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
      <DropdownMenu open>
        <DropdownMenuContent>
          <ExportMenuItems {...props({ generating })} />
        </DropdownMenuContent>
      </DropdownMenu>,
    );
  });
  cleanup = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return host;
}

describe("ExportMenuItems", () => {
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
