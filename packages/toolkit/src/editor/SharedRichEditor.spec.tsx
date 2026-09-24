// @vitest-environment happy-dom

import type { Editor } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharedRichEditor } from "./SharedRichEditor.js";

describe("SharedRichEditor block controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("mounts the shared Notion-style block grip by default", async () => {
    await act(async () => {
      root.render(
        <SharedRichEditor
          value="<p>First</p><p>Second</p>"
          onChange={() => undefined}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const prose = container.querySelector<HTMLElement>(".an-rich-md-prose");
    const firstBlock = prose?.firstElementChild;
    for (const [element, rect] of [
      [prose, { left: 0, top: 0, right: 640, bottom: 100 }],
      [firstBlock, { left: 0, top: 0, right: 640, bottom: 24 }],
    ] as const) {
      if (!element) continue;
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          ...rect,
          x: rect.left,
          y: rect.top,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
          toJSON: () => ({}),
        }),
      });
    }
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 8,
        clientY: 8,
      }),
    );
    expect(container.querySelector(".an-rich-md-wrapper")).not.toBeNull();
    expect(container.querySelector(".drag-handle")).not.toBeNull();
  });

  it("allows hosts to opt out when they own block controls", async () => {
    await act(async () => {
      root.render(
        <SharedRichEditor
          value="First"
          onChange={() => undefined}
          dragHandle={false}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(container.querySelector(".drag-handle")).toBeNull();
  });
});

describe("SharedRichEditor unstyled mode", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders no shared prose typography or wrapper box when unstyled", async () => {
    await act(async () => {
      root.render(
        <SharedRichEditor
          value="<p>First</p>"
          onChange={() => undefined}
          unstyled
          dragHandle={false}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(container.querySelector(".an-rich-md-prose")).toBeNull();
    const unstyledRoot = container.querySelector(".an-rich-md-unstyled");
    expect(unstyledRoot).not.toBeNull();
    expect(unstyledRoot?.getAttribute("contenteditable")).toBe("true");
    expect(container.querySelector(".an-rich-md-wrapper")?.className).toContain(
      "an-rich-md-wrapper--unstyled",
    );
    expect(
      container.querySelector(
        ".an-rich-md-wrapper--unstyled > .an-rich-md-content",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(".an-rich-md-content > .an-rich-md-unstyled"),
    ).not.toBeNull();
  });

  it("keeps the default prose styling when unstyled is omitted", async () => {
    await act(async () => {
      root.render(
        <SharedRichEditor
          value="<p>First</p>"
          onChange={() => undefined}
          dragHandle={false}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(container.querySelector(".an-rich-md-prose")).not.toBeNull();
    expect(container.querySelector(".an-rich-md-unstyled")).toBeNull();
    expect(
      container.querySelector(".an-rich-md-wrapper")?.className,
    ).not.toContain("an-rich-md-wrapper--unstyled");
  });

  it("honors StarterKit overrides such as disabling the trailing node", async () => {
    // `value` is markdown source (gfm dialect), not raw HTML, so a real `<ul>`
    // needs list syntax. TrailingNode's `appendTransaction` only runs on a
    // dispatched transaction (not the initial `content` seed), so a `focus`
    // command exercises it the same way real editing would.
    let overriddenEditor: Editor | undefined;
    await act(async () => {
      root.render(
        <SharedRichEditor
          value="- One"
          onChange={() => undefined}
          dragHandle={false}
          starterKit={{ trailingNode: false }}
          onEditorReady={(editor) => {
            overriddenEditor = editor;
          }}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      overriddenEditor?.commands.focus("end");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const overriddenRoot = container.querySelector(".an-rich-md-prose");
    expect(overriddenRoot?.lastElementChild?.tagName).toBe("UL");

    const defaultContainer = document.createElement("div");
    document.body.appendChild(defaultContainer);
    const defaultRoot = createRoot(defaultContainer);
    let defaultEditor: Editor | undefined;

    await act(async () => {
      defaultRoot.render(
        <SharedRichEditor
          value="- One"
          onChange={() => undefined}
          dragHandle={false}
          onEditorReady={(editor) => {
            defaultEditor = editor;
          }}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      defaultEditor?.commands.focus("end");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const defaultRootEl = defaultContainer.querySelector(".an-rich-md-prose");
    expect(defaultRootEl?.lastElementChild?.tagName).toBe("P");

    act(() => defaultRoot.unmount());
    defaultContainer.remove();
  });
});
