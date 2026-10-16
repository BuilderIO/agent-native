// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getExtensionField, resolveExtensions } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import {
  NODE_VIEWS_LAID_OUT_BY_RENDER_HTML,
  renderStaticDocumentBody,
  STATIC_NODE_VIEWS,
  StaticDocumentBody,
} from "./StaticDocumentBody";
import {
  createVisualEditorExtensions,
  getContentEditorSchema,
  VisualEditor,
} from "./VisualEditor";

// One of each block the editor draws with a node view, between paragraphs.
const BODY = [
  'Intro with $E = mc^2$ and <mention-page url="https://www.notion.so/abc">A Page</mention-page>.',
  "",
  "![Alt text](https://example.com/a.png)",
  "",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
  "",
  "<details>",
  "<summary>Closed toggle</summary>",
  "\tHidden text",
  "</details>",
  "",
  "<details open>",
  "<summary>Open toggle</summary>",
  "\tVisible text",
  "</details>",
  "",
  '<callout icon="💡">',
  "\tCallout text",
  "</callout>",
  "",
  "$$",
  "x^2",
  "$$",
  "",
  '<page url="https://www.notion.so/abc">Child Page</page>',
  "",
  '<file src="https://x.com/f.pdf">A file</file>',
  "",
  '<audio src="https://x.com/a.mp3">My audio</audio>',
  "",
  "- [ ] Task open",
  "",
  "Last paragraph.",
].join("\n");

const LABELS = { imageBroken: "editor.media.imageBroken" };

// Icons, and controls the stylesheet takes out of the flow, take no part in
// where a block sits.
const OUT_OF_FLOW =
  "svg, input[type=file], .media-block__toolbar, .media-block__resize-handle, .media-block__alt-badge, [style*='position: absolute']";

const laidOut = (element: Element) =>
  !element.matches(OUT_OF_FLOW) &&
  // An empty, unstyled span has no box.
  !(element.matches("span:not([class])") && !element.textContent);

// Each element as its tag, classes and node-view role. A control's own class
// lays it out, so an editor's `input` and a stand-in `span` count alike. The
// editor's highlighting and math internals are left out, and so is the
// callout's icon: tests resolve the toolkit's server build, whose icon picker
// renders nothing.
function shape(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const name = tag === "input" ? "span" : tag;
  const classes = [...element.classList].sort().map((name) => `.${name}`);
  const roles = [
    "data-node-view-wrapper",
    "data-node-view-content",
    "data-node-view-content-react",
  ]
    .filter((role) => element.hasAttribute(role))
    .map((role) => `[${role}]`);
  const children =
    tag === "code" ||
    element.classList.contains("content-math") ||
    element.hasAttribute("data-notion-callout-icon")
      ? []
      : [...element.children].filter(laidOut);
  return `${name}${classes.join("")}${roles.join("")}${
    children.length ? `(${children.map(shape).join(" ")})` : ""
  }`;
}

describe("the static document body", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("has a stand-in for every node the editor draws with a node view", () => {
    const viewed = resolveExtensions(createVisualEditorExtensions())
      .filter(
        (extension) =>
          extension.type === "node" &&
          getExtensionField(extension, "addNodeView"),
      )
      .map((extension) => extension.name);

    expect(viewed.length).toBeGreaterThan(0);
    expect(
      viewed.filter(
        (name) =>
          !STATIC_NODE_VIEWS[name] &&
          !NODE_VIEWS_LAID_OUT_BY_RENDER_HTML.has(name),
      ),
    ).toEqual([]);
  });

  it("draws each block in the layout the editable editor gives it", async () => {
    const staticBody = document.createElement("div");
    renderStaticDocumentBody(
      getContentEditorSchema(),
      BODY,
      staticBody,
      LABELS,
    );

    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(
              QueryClientProvider,
              { client: new QueryClient() },
              createElement(VisualEditor, {
                documentId: "page",
                content: BODY,
                ydoc: null,
                editable: true,
                onChange: () => {},
              }),
            ),
          ),
        ),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const editor = container.querySelector(".ProseMirror")!;

    const blocks = (body: Element) => [...body.children].filter(laidOut);
    expect(blocks(staticBody).map(shape)).toEqual(blocks(editor).map(shape));
  });

  it("draws an image that failed to load as the image block draws one", async () => {
    const content = [
      "Before.",
      "",
      "![Alt text](https://example.com/missing.png)",
      "",
      "After.",
    ].join("\n");
    const blocks = async (element: ReturnType<typeof createElement>) => {
      await act(async () =>
        root.render(
          createElement(
            MemoryRouter,
            null,
            createElement(
              TooltipProvider,
              null,
              createElement(
                QueryClientProvider,
                { client: new QueryClient() },
                element,
              ),
            ),
          ),
        ),
      );
      await act(async () => {
        container.querySelector("img")!.dispatchEvent(new Event("error"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      const body = container.querySelector(
        "[data-static-document-body], .ProseMirror",
      )!;
      return [...body.children].filter(laidOut).map(shape);
    };

    const standIn = await blocks(
      createElement(StaticDocumentBody, {
        schema: getContentEditorSchema(),
        content,
      }),
    );
    // With no body on screen, the editor loads the image itself.
    await act(async () => root.render(null));
    const editor = await blocks(
      createElement(VisualEditor, {
        documentId: "page",
        content,
        ydoc: null,
        editable: true,
        onChange: () => {},
      }),
    );

    expect(standIn.join()).toContain(".media-block__broken");
    expect(standIn).toEqual(editor);
  });
});
