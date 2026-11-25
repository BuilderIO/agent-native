// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { renderLeftSidebar } from "@/pages/design-editor/view/left-sidebar";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  templates: [
    {
      id: "starter",
      title: "Starter",
      previewHtml: "<h1>Starter</h1>",
      width: 1280,
      height: 720,
      isBuiltIn: true,
    },
  ],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (...args: unknown[]) => {
    mocks.query(...args);
    return { data: { templates: mocks.templates }, isLoading: false };
  },
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatSurface: ({ emptyStateFooter }: { emptyStateFooter: ReactNode }) => (
    <div>
      <textarea aria-label="Agent composer" />
      {emptyStateFooter}
    </div>
  ),
}));
vi.mock("@/components/templates/TemplatePreview", () => ({
  TemplatePreview: () => null,
}));
vi.mock("@/components/design/DesignExtensionsPanel", () => ({
  AssetLibraryPanel: () => null,
  DesignExtensionsPanel: () => null,
}));
vi.mock("@/components/design/editor/LeftPanelHeader", () => ({
  LeftPanelHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/components/design/editor/ReadOnlyEditorPanel", () => ({
  ReadOnlyEditorPanel: () => null,
}));
vi.mock("@/components/design/LayersPanel", () => ({ LayersPanel: () => null }));
vi.mock("@/components/design/ReviewCommentsPanel", () => ({
  ReviewCommentsPanel: () => null,
}));
vi.mock("@/components/design/TokensPanel", () => ({ TokensPanel: () => null }));
vi.mock("@/components/editor/DesignComposerContextProvider", () => ({
  DesignComposerContextProvider: () => null,
}));
vi.mock("@/components/editor/FigmaLinkComposerBubble", () => ({
  FigmaLinkComposerBubble: () => null,
}));
vi.mock("@agent-native/toolkit/app/feedback", () => ({
  FeedbackButton: () => null,
}));
vi.mock("@agent-native/toolkit/app/org", () => ({ OrgSwitcher: () => null }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.query.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("editor first-run templates", () => {
  async function render(
    files: { filename: string }[] | undefined,
    canEditDesign = true,
    designIsEmpty = true,
  ) {
    const onPickTemplate = vi.fn();
    const props = {
      editorCore: {
        searchParams: new URLSearchParams(),
        t: (key: string) => key,
        shellMode: false,
      },
      editorHistory: {
        activeLeftPanel: "agent",
        codeWorkbenchOpenedRef: { current: false },
      },
      editorGenerationAndAccess: {
        canEditDesign,
        designDataReady: files !== undefined,
        design: files === undefined ? null : { files: [] },
        sourceMetadata: files ?? [],
      },
      editorFilesAndSaving: {},
      editorCanvasAndScreens: {},
      editorLiveEditsAndPresence: {},
      editorContentAndComponents: {},
      editorToolsAndVectors: {},
      editorSelectionAndStyles: {},
      editorClipboard: {},
      editorEditCommands: {},
      editorModes: {},
      editorExportAndHandoff: {},
      editorLayerModels: { designIsEmpty, chatMessageCount: 0 },
      editorLayerActions: {},
      editorSourceAndSync: {
        firstRunTemplates: mocks.templates,
        firstRunTemplatesQuery: { isLoading: false },
        applyingTemplateId: null,
        handleFirstRunTemplate: onPickTemplate,
      },
      id: "design-1",
      canApplyPendingVisualEditsWithAgent: true,
      projectMenu: <div />,
      projectTitleControl: <div />,
      minimalUiToggle: null,
      leftContentWidth: 320,
      leftSidebarVisible: true,
    } as unknown as Parameters<typeof renderLeftSidebar>[0];
    await act(async () =>
      root.render(
        <MemoryRouter>
          <TooltipProvider>{renderLeftSidebar(props)}</TooltipProvider>
        </MemoryRouter>,
      ),
    );
    return onPickTemplate;
  }

  it.each([
    ["file metadata is still loading", undefined],
    ["a CSS file exists without a screen", [{ filename: "repro.css" }]],
    [
      "a board and a non-board file exist",
      [{ filename: "__board__.html" }, { filename: "repro.css" }],
    ],
  ])("does not offer or query templates when %s", async (_reason, files) => {
    await render(files);
    expect(
      container.querySelector('[aria-label="Agent composer"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-template-card]")).toBeNull();
    expect(mocks.query).toHaveBeenCalledWith(
      "list-design-templates",
      { includePreview: "true" },
      { enabled: false },
    );
  });

  it.each([
    ["no files", []],
    ["only the board file", [{ filename: "__board__.html" }]],
  ])("offers and applies templates with %s", async (_reason, files) => {
    const onPickTemplate = await render(files);
    expect(mocks.query).toHaveBeenCalledWith(
      "list-design-templates",
      { includePreview: "true" },
      { enabled: true },
    );
    const card = container.querySelector<HTMLButtonElement>(
      '[data-template-card="starter"]',
    );
    expect(card).not.toBeNull();
    await act(async () => card?.click());
    expect(onPickTemplate).toHaveBeenCalledWith("starter");
  });

  it("waits for metadata before offering templates", async () => {
    await render(undefined);
    expect(container.querySelector("[data-template-card]")).toBeNull();
    await render([{ filename: "__board__.html" }]);
    expect(
      container.querySelector('[data-template-card="starter"]'),
    ).not.toBeNull();
    expect(mocks.query).toHaveBeenLastCalledWith(
      "list-design-templates",
      { includePreview: "true" },
      { enabled: true },
    );
  });

  it("keeps the composer without querying templates on a non-empty canvas", async () => {
    await render([{ filename: "__board__.html" }], true, false);
    expect(
      container.querySelector('[aria-label="Agent composer"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-template-card]")).toBeNull();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("does not offer cached templates without edit access", async () => {
    await render([], false);
    expect(container.querySelector("[data-template-card]")).toBeNull();
    expect(mocks.query).toHaveBeenCalledWith(
      "list-design-templates",
      { includePreview: "true" },
      { enabled: false },
    );
  });
});
