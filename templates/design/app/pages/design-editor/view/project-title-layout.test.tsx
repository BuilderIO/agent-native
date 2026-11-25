import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { chromium, type Browser, type Locator } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { renderLeftSidebar } from "./left-sidebar";
import { renderProjectTitleControl } from "./project-title-control";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: undefined, isError: false }),
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatSurface: () => null,
}));
vi.mock("@agent-native/toolkit/app/feedback", () => ({
  FeedbackButton: () => null,
}));
vi.mock("@agent-native/toolkit/app/org", () => ({ OrgSwitcher: () => null }));
vi.mock("@/components/design/DesignExtensionsPanel", () => ({
  AssetLibraryPanel: () => null,
  DesignExtensionsPanel: () => null,
}));
vi.mock("@/components/design/editor/LeftPanelHeader", () => ({
  LeftPanelHeader: () => null,
}));
vi.mock("@/components/design/editor/ReadOnlyEditorPanel", () => ({
  ReadOnlyEditorPanel: () => null,
}));
vi.mock("@/components/design/FirstRunStart", () => ({
  FirstRunStart: () => null,
}));
vi.mock("@/components/design/LayersPanel", () => ({ LayersPanel: () => null }));
vi.mock("@/components/design/TokensPanel", () => ({ TokensPanel: () => null }));
vi.mock("@/components/editor/DesignComposerContextProvider", () => ({
  DesignComposerContextProvider: () => null,
}));
vi.mock("@/components/editor/FigmaLinkComposerBubble", () => ({
  FigmaLinkComposerBubble: () => null,
}));

const title =
  "A very long design project title that must never overlap the minimize button ".repeat(
    3,
  );
const brief = {
  source: "content",
  id: "page-one",
  url: "https://content.example.com/page-one",
};
let browser: Browser | undefined;
let vite: ViteDevServer | undefined;
let css: string;
let cacheDir: string | undefined;

async function expectEllipsis(titleElement: Locator) {
  const overflow = await titleElement.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    textOverflow: getComputedStyle(element).textOverflow,
    overflowX: getComputedStyle(element).overflowX,
    whiteSpace: getComputedStyle(element).whiteSpace,
  }));
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
  expect(overflow.textOverflow).toBe("ellipsis");
  expect(overflow.overflowX).toBe("hidden");
  expect(overflow.whiteSpace).toBe("nowrap");
}

beforeAll(async () => {
  cacheDir = await mkdtemp(path.join(os.tmpdir(), "design-title-layout-"));
  vite = await createServer({
    configFile: false,
    cacheDir,
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "title-layout-styles",
        enforce: "pre",
        load(id) {
          if (!id.endsWith("/app/global.css")) return;
          return readFileSync(id, "utf8")
            .replace(
              '@import "tailwindcss";',
              '@import "tailwindcss" source(none);',
            )
            .replace(
              '@source "./**/*.{ts,tsx}";',
              '@source "./pages/design-editor/view/left-sidebar.tsx";\n@source "./pages/design-editor/view/project-title-control.tsx";\n@source "./components/ui/input.tsx";',
            );
        },
      },
      tailwindcss(),
    ],
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    appType: "custom",
  });
  const result = await vite.transformRequest("/app/global.css?direct");
  if (!result) throw new Error("Could not compile Design's stylesheet");
  css = result.code;
  const useSystemChromium =
    !existsSync(chromium.executablePath()) && existsSync("/usr/bin/chromium");
  browser = await chromium.launch({
    headless: true,
    ...(useSystemChromium ? { executablePath: "/usr/bin/chromium" } : {}),
  });
}, 60_000);

afterAll(async () => {
  try {
    await browser?.close();
  } finally {
    try {
      await vite?.close();
    } finally {
      if (cacheDir) await rm(cacheDir, { recursive: true, force: true });
    }
  }
});

describe("Design left header title", () => {
  it.each([
    ["read-only", false, false, false],
    ["read-only with brief", false, true, false],
    ["editable", true, false, false],
    ["renaming", true, false, true],
  ])(
    "keeps a long %s title clear of the minimize control",
    async (_name, canEdit, hasBrief, editing) => {
      const titleControl = renderProjectTitleControl({
        editorCore: { t: (key: string) => key, id: "design-one" },
        editorGenerationAndAccess: {
          canEditDesign: canEdit,
          canShareDesign: false,
          duplicateDesignMutation: { isPending: false },
        },
        editorFilesAndSaving: {
          titleEditing: editing,
          titleDraft: title,
          files: [],
        },
        editorHistory: {},
        editorLiveEditsAndPresence: {},
        editorLayoutAndStructure: {},
        editorSourceAndSync: {},
        design: { title, data: { briefs: hasBrief ? [brief] : [] } },
        widgetEmbed: false,
      } as unknown as Parameters<typeof renderProjectTitleControl>[0]);
      const sidebar = renderLeftSidebar({
        editorCore: { t: (key: string) => key, mode: "edit" },
        editorHistory: {},
        editorGenerationAndAccess: { canEditDesign: canEdit },
        editorFilesAndSaving: {},
        editorCanvasAndScreens: {},
        editorLiveEditsAndPresence: {},
        editorContentAndComponents: {},
        editorSelectionAndStyles: {},
        editorClipboard: {},
        editorModes: {},
        editorExportAndHandoff: {},
        editorLayerModels: {},
        editorLayerActions: {},
        editorSourceAndSync: {},
        id: "design-one",
        canApplyPendingVisualEditsWithAgent: false,
        projectMenu: <button style={{ width: 28, flexShrink: 0 }}>M</button>,
        projectTitleControl: titleControl,
        saveStatus: null,
        minimalUiToggle: (
          <button data-test-toggle style={{ width: 28, flexShrink: 0 }}>
            T
          </button>
        ),
        leftContentWidth: 320,
        leftSidebarVisible: true,
      } as unknown as Parameters<typeof renderLeftSidebar>[0]);
      const html = renderToStaticMarkup(
        <MemoryRouter>
          <TooltipProvider>{sidebar}</TooltipProvider>
        </MemoryRouter>,
      );
      if (!browser) throw new Error("Browser was not initialized");
      const page = await browser.newPage();
      try {
        await page.setContent(
          `<html class="dark"><head><style>${css}</style></head><body>${html}</body></html>`,
        );
        const header = page.locator(
          '[data-design-chrome-region="left-header"]',
        );
        const titleElement = editing
          ? header.locator("input")
          : header.getByText(title, { exact: true });
        const titleBox = await titleElement.boundingBox();
        const toggleBox = await header
          .locator("[data-test-toggle]")
          .boundingBox();
        if (!titleBox || !toggleBox)
          throw new Error("Title or minimize control is missing");
        expect(titleBox.width).toBeGreaterThan(0);
        expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(toggleBox.x);
        if (!editing) await expectEllipsis(titleElement);
      } finally {
        await page.close();
      }
    },
  );
});
