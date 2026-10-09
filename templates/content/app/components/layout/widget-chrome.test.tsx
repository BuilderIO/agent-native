// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { act } from "react";
import { MemoryRouter } from "react-router";
import { compile } from "tailwindcss";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  documentEditorBodyClassName,
  documentEditorTitleRegionClassName,
} from "@/components/editor/document-editor-layout";
import {
  DocumentEditorSkeleton,
  HIDDEN_IN_WIDGET_CLASS_NAME,
} from "@/components/editor/DocumentEditorSkeleton";
import { DocumentToolbar } from "@/components/editor/DocumentToolbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryByLabel, renderUi } from "@/test-utils/render-ui";

import { ContentStartupShell } from "./ContentStartupShell";
import { Header } from "./Header";

const widgetHost = vi.hoisted(() => ({ embedded: false, writable: false }));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
// The real hook latches for the life of the document, so one test file could
// not show both the widget and the app.
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/mcp-app-host")
  >()),
  useIsMcpAppWidgetEmbed: () => widgetHost.embedded,
  useIsMcpDirectoryWidgetReadOnlyEmbed: () => false,
  useIsMcpDirectoryWidgetWriteEmbed: () => widgetHost.writable,
}));

const WIDGET_ATTRIBUTE = "data-agent-native-mcp-widget";
const appStyles = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../global.css"),
  "utf8",
);

// happy-dom resolves a style against the document as it stands when asked, so
// the page is marked, and the styles loaded, before anything renders.
function openPage({
  inWidget,
  extraStyles = "",
}: {
  inWidget: boolean;
  extraStyles?: string;
}) {
  const style = document.createElement("style");
  style.textContent = appStyles + extraStyles;
  document.head.append(style);
  widgetHost.embedded = inWidget;
  if (inWidget) document.documentElement.setAttribute(WIDGET_ATTRIBUTE, "1");
}

// Utilities from the real Tailwind compiler, with the two theme values the
// page column reads. happy-dom ignores the native CSS nesting Tailwind writes
// for a variant, so the one nested form used here is flattened first.
async function utilityStyles(...candidates: string[]) {
  const compiler = await compile(
    "@theme { --container-3xl: 48rem; --spacing: 0.25rem; } @tailwind utilities;",
  );
  return compiler
    .build(candidates)
    .replace(/(\.[^\s{]+) \{\s*(html[^{]+?) & \{([^}]*)\}\s*\}/g, "$2 $1 {$3}");
}

function isShown(element: Element) {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (getComputedStyle(node).display === "none") return false;
  }
  return true;
}

// The toolbar reads and clears its history state on mount and unmount.
beforeAll(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  widgetHost.embedded = false;
  widgetHost.writable = false;
  document.head.replaceChildren();
  document.documentElement.removeAttribute(WIDGET_ATTRIBUTE);
});

describe.each([
  { inWidget: true, place: "inside an MCP App widget" },
  { inWidget: false, place: "in the app" },
])("the page $place", ({ inWidget }) => {
  it(
    inWidget
      ? "draws the document toolbar's page title and a single Open link, without the app's agent chrome"
      : "keeps the full document toolbar",
    async () => {
      openPage({ inWidget });

      renderUi(
        <MemoryRouter>
          <TooltipProvider>
            <DocumentToolbar
              documentId="doc-1"
              documentTitle="Roadmap"
              utilityPanel={null}
              onUtilityPanelChange={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(
        queryByLabel("editor.toolbar.pageBreadcrumb")?.textContent,
      ).toContain("Roadmap");
      // The app's toolbar keeps its menu and the agent toggle; the widget's
      // holds the one link, which stands where the menu would.
      expect(queryByLabel("editor.toolbar.morePageActions") !== null).toBe(
        !inWidget,
      );
      expect(queryByLabel("editor.toolbar.openInAgentNative") !== null).toBe(
        inWidget,
      );
      expect(queryByLabel("agentPanel.toggleAgent") !== null).toBe(!inWidget);
    },
  );

  it(inWidget ? "shows no app header" : "keeps the app header", () => {
    openPage({ inWidget });

    const { container } = renderUi(
      <MemoryRouter initialEntries={["/home"]}>
        <Header />
      </MemoryRouter>,
    );

    expect(container.querySelector("header") !== null).toBe(!inWidget);
  });

  it("draws the loading skeleton's toolbar row ahead of its page", async () => {
    openPage({
      inWidget,
      extraStyles: await utilityStyles("flex", HIDDEN_IN_WIDGET_CLASS_NAME),
    });

    const { container } = renderUi(
      <main className="agent-native-app-main">
        <DocumentEditorSkeleton title="Roadmap" />
      </main>,
    );

    // The skeleton's first row stands in for the toolbar, ahead of the page.
    const toolbarRow = container.querySelector("main > div")?.firstElementChild;
    const title = container.querySelector('[data-startup-anchor="title"]');
    expect(toolbarRow).toBeTruthy();
    expect(title).toBeTruthy();
    // The widget has the toolbar now, so the skeleton holds its place.
    expect(isShown(toolbarRow!)).toBe(true);
    expect(isShown(title!)).toBe(true);
  });

  it(
    inWidget
      ? "omits the app sidebar from the startup shell"
      : "draws the app sidebar in the startup shell",
    async () => {
      openPage({
        inWidget,
        extraStyles: await utilityStyles("flex", HIDDEN_IN_WIDGET_CLASS_NAME),
      });

      const { container } = renderUi(
        <ContentStartupShell pathname="/page/doc-1" label="Loading" />,
      );

      const sidebar = container.querySelector(".agent-layout-left-drawer");
      expect(sidebar).toBeTruthy();
      expect(isShown(sidebar!)).toBe(!inWidget);
    },
  );

  it(
    inWidget
      ? "draws no menu button in the startup toolbar row where the app narrows to a drawer"
      : "draws the menu button in the startup toolbar row where the app narrows to a drawer",
    async () => {
      document.documentElement.setAttribute("data-content-sidebar-drawer", "");
      const { container } = renderUi(
        <ContentStartupShell pathname="/page/doc-1" label="Loading" />,
      );
      const classes = new Set(
        Array.from(container.querySelectorAll("[class]")).flatMap((element) =>
          (element.getAttribute("class") ?? "").split(/\s+/),
        ),
      );
      openPage({ inWidget, extraStyles: await utilityStyles(...classes) });

      const menuButton = container.querySelector("main [aria-hidden] svg");
      expect(menuButton).toBeTruthy();
      expect(isShown(menuButton!.parentElement!)).toBe(!inWidget);
      document.documentElement.removeAttribute("data-content-sidebar-drawer");
    },
  );

  it(
    inWidget
      ? "gives the page column the pane's width and a short lead-in"
      : "keeps the page column and its lead-in",
    async () => {
      const titleRegion = documentEditorTitleRegionClassName(false);
      const body = documentEditorBodyClassName("page");
      openPage({
        inWidget,
        extraStyles: await utilityStyles(
          ...`${titleRegion} ${body}`.split(/\s+/),
        ),
      });

      const { container } = renderUi(
        <main className="agent-native-app-main">
          <div className={titleRegion} data-testid="title-region" />
          <div className={body} data-testid="body" />
        </main>,
      );

      const title = getComputedStyle(
        container.querySelector('[data-testid="title-region"]')!,
      );
      const column = getComputedStyle(
        container.querySelector('[data-testid="body"]')!,
      );
      expect(title.maxWidth).toBe(inWidget ? "1024px" : "768px");
      expect(column.maxWidth).toBe(inWidget ? "1024px" : "768px");
      if (inWidget) expect(title.paddingTop).toBe("24px");
      else expect(title.paddingTop).not.toBe("24px");
    },
  );
});

it("gives an editable directory widget Share and the page title, and leaves undo and redo to the formatting strip", async () => {
  openPage({ inWidget: true });
  widgetHost.writable = true;

  const { container } = renderUi(
    <MemoryRouter>
      <TooltipProvider>
        <DocumentToolbar
          documentId="doc-1"
          documentTitle="Roadmap"
          canEdit
          canUndo
          canRedo
          readOnly
          utilityPanel={null}
          onUtilityPanelChange={() => {}}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.querySelector("[data-content-widget-editor-toolbar]")).toBe(
    null,
  );
  expect(queryByLabel("editor.toolbar.undo", container)).toBeNull();
  expect(queryByLabel("editor.toolbar.redo", container)).toBeNull();
  expect(
    queryByLabel("editor.toolbar.pageBreadcrumb", container)?.textContent,
  ).toContain("Roadmap");
  expect(queryByLabel("editor.toolbar.share", container)).not.toBeNull();
  expect(
    queryByLabel("editor.toolbar.openInAgentNative", container),
  ).not.toBeNull();
});
