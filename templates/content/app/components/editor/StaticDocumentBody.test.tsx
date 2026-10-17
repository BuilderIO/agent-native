// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type Editor,
  getExtensionField,
  resolveExtensions,
} from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const locale = vi.hoisted(() => ({ prefix: "" }));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => `${locale.prefix}${key}`,
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

const IMAGE_BODY = [
  "Before.",
  "",
  "![Alt text](https://example.com/missing.png)",
  "",
  "After.",
].join("\n");

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
    locale.prefix = "";
  });

  const inApp = (element: ReturnType<typeof createElement>) =>
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
    );
  const imageStoredBody = () =>
    createElement(StaticDocumentBody, {
      schema: getContentEditorSchema(),
      content: IMAGE_BODY,
    });
  const imageEditor = () =>
    createElement(VisualEditor, {
      documentId: "page",
      content: IMAGE_BODY,
      ydoc: null,
      editable: true,
      onChange: () => {},
    });
  const show = async (element: ReturnType<typeof createElement> | null) => {
    await act(async () => root.render(element && inApp(element)));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  };
  const failImage = (image: Element) =>
    act(async () => {
      image.dispatchEvent(new Event("error"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  const blocks = () =>
    [
      ...container.querySelector("[data-static-document-body], .ProseMirror")!
        .children,
    ]
      .filter(laidOut)
      .map(shape);

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
    await show(imageStoredBody());
    await failImage(container.querySelector("img")!);
    const standIn = blocks();
    // With no body on screen, the editor loads the image itself.
    await show(null);
    await show(imageEditor());
    await failImage(container.querySelector("img")!);

    expect(standIn.join()).toContain(".media-block__broken");
    expect(standIn).toEqual(blocks());
  });

  it("forgets an image failure that arrives after its body has left", async () => {
    await show(imageStoredBody());
    const image = container.querySelector("img")!;
    await show(null);
    await failImage(image);
    await show(imageEditor());

    expect(container.querySelector(".ProseMirror img")).not.toBeNull();
    expect(container.querySelector(".media-block__broken")).toBeNull();
  });

  it("still loads an image that starts as the stored body's failure", async () => {
    const probes: HTMLImageElement[] = [];
    vi.stubGlobal("Image", function () {
      const probe = document.createElement("img");
      probes.push(probe);
      return probe;
    });
    // The editor mounts behind the stored body, which stays up until the
    // editor's node views draw.
    const page = (editing: boolean) =>
      createElement(
        "div",
        null,
        imageStoredBody(),
        editing ? imageEditor() : null,
      );
    await show(page(false));
    await failImage(container.querySelector("img")!);
    await show(page(true));

    expect(
      container.querySelector(".ProseMirror .media-block__broken"),
    ).not.toBeNull();
    expect(probes.map((probe) => probe.getAttribute("src"))).toEqual([
      "https://example.com/missing.png",
    ]);
    await act(async () => probes[0].onload?.call(probes[0], new Event("load")));
    expect(
      container.querySelector(".ProseMirror .media-block__broken"),
    ).toBeNull();
    expect(container.querySelector(".ProseMirror img")).not.toBeNull();
  });

  it("loads a failed source again when the image changes back to it", async () => {
    await show(imageEditor());
    await failImage(container.querySelector("img")!);
    const editor = (
      container.querySelector(".ProseMirror") as HTMLElement & {
        editor: Editor;
      }
    ).editor;
    const setSource = (src: string) =>
      act(async () => {
        let at = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "image") at = pos;
        });
        editor.view.dispatch(editor.state.tr.setNodeAttribute(at, "src", src));
      });
    await setSource("https://example.com/other.png");
    await setSource("https://example.com/missing.png");

    expect(
      container.querySelector(".ProseMirror img")?.getAttribute("src"),
    ).toBe("https://example.com/missing.png");
  });

  it("redraws a failed image in the reader's new language", async () => {
    await show(imageStoredBody());
    await failImage(container.querySelector("img")!);
    locale.prefix = "fr:";
    await show(imageStoredBody());
    await failImage(container.querySelector("img")!);

    expect(
      container.querySelector(".media-block__broken-title")?.textContent,
    ).toBe("fr:editor.media.imageBroken");
  });
});
