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

import { DocumentEditorSkeleton } from "@/components/editor/DocumentEditorSkeleton";
import { DocumentToolbar } from "@/components/editor/DocumentToolbar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { byLabel, renderUi } from "@/test-utils/render-ui";

import { ContentStartupShell } from "./ContentStartupShell";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
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
  if (inWidget) document.documentElement.setAttribute(WIDGET_ATTRIBUTE, "1");
}

// A utility from the real Tailwind compiler. happy-dom ignores the native CSS
// nesting it writes for a variant, so the one nested form used here is
// flattened first.
async function utilityStyles(...candidates: string[]) {
  const compiler = await compile("@tailwind utilities;");
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
  document.head.replaceChildren();
  document.documentElement.removeAttribute(WIDGET_ATTRIBUTE);
});

describe.each([
  { inWidget: true, place: "inside an MCP App widget" },
  { inWidget: false, place: "in the app" },
])("the page $place", ({ inWidget }) => {
  it(
    inWidget ? "shows no document toolbar" : "keeps the document toolbar",
    async () => {
      openPage({ inWidget });

      renderUi(
        <MemoryRouter>
          <TooltipProvider>
            <DocumentToolbar
              documentId="doc-1"
              utilityPanel={null}
              onUtilityPanelChange={() => {}}
            />
          </TooltipProvider>
        </MemoryRouter>,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(isShown(byLabel("editor.toolbar.morePageActions"))).toBe(
        !inWidget,
      );
    },
  );

  it(
    inWidget
      ? "drops the loading skeleton's toolbar row and keeps its page"
      : "draws the loading skeleton's toolbar row",
    () => {
      openPage({ inWidget });

      const { container } = renderUi(
        <main className="agent-native-app-main">
          <DocumentEditorSkeleton title="Roadmap" />
        </main>,
      );

      // The skeleton's first row stands in for the toolbar, ahead of the page.
      const toolbarRow =
        container.querySelector("main > div")?.firstElementChild;
      const title = container.querySelector('[data-startup-anchor="title"]');
      expect(toolbarRow).toBeTruthy();
      expect(title).toBeTruthy();
      expect(isShown(toolbarRow!)).toBe(!inWidget);
      expect(isShown(title!)).toBe(true);
    },
  );

  it(
    inWidget
      ? "omits the app sidebar from the startup shell"
      : "draws the app sidebar in the startup shell",
    async () => {
      openPage({
        inWidget,
        extraStyles: await utilityStyles(
          "flex",
          "[html[data-agent-native-mcp-widget]_&]:hidden",
        ),
      });

      const { container } = renderUi(
        <ContentStartupShell pathname="/page/doc-1" label="Loading" />,
      );

      const sidebar = container.querySelector(".agent-layout-left-drawer");
      expect(sidebar).toBeTruthy();
      expect(isShown(sidebar!)).toBe(!inWidget);
    },
  );
});
