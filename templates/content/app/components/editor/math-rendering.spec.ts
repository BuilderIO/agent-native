// @vitest-environment happy-dom

import { docToNfm, nfmToDoc } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { createVisualEditorExtensions, VisualEditor } from "./VisualEditor";

const editors: Editor[] = [];
const mountedRoots: Array<{
  container: HTMLElement;
  queryClient: QueryClient;
  root: Root;
}> = [];
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, "compatMode", {
    configurable: true,
    value: "CSS1Compat",
  });
  if (!document.doctype) {
    document.insertBefore(
      document.implementation.createDocumentType("html", "", ""),
      document.documentElement,
    );
  }
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const mounted of mountedRoots.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.queryClient.clear();
    mounted.container.remove();
  }
});

function createMathEditor(source: string, editable = true) {
  const editor = new Editor({
    extensions: createVisualEditorExtensions(),
    content: nfmToDoc(source),
    editable,
  });
  editors.push(editor);
  return editor;
}

function inlineMathPosition(editor: Editor): number {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (
      node.type.name === "notionInlineAtom" &&
      node.attrs.tagName === "math"
    ) {
      position = pos;
      return false;
    }
    return position === -1;
  });
  if (position === -1) throw new Error("Inline math atom was not found");
  return position;
}

async function mountVisualEditors(source: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mountedRoots.push({ container, queryClient, root });

  act(() => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(TooltipProvider, {
          delayDuration: 0,
          children: createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement("div", null, [
              createElement(VisualEditor, {
                key: "editor",
                content: source,
                editable: true,
                onChange: () => {},
              }),
              createElement(VisualEditor, {
                key: "reader",
                content: source,
                editable: false,
                onChange: () => {},
              }),
            ]),
          ),
        }),
      ),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  return container;
}

describe("math editor rendering", () => {
  it("renders inline and block atoms with KaTeX in editable and read-only editors", async () => {
    const source = [
      "Before $`a^2 + b^2`$ after",
      "$$",
      "\\int_0^1 x^2 dx",
      "$$",
    ].join("\n");
    const container = await mountVisualEditors(source);

    expect(
      container.querySelectorAll(".content-inline-equation .katex"),
    ).toHaveLength(2);
    expect(
      container.querySelectorAll(".content-equation .katex-display"),
    ).toHaveLength(2);
    for (const equation of container.querySelectorAll(
      ".content-inline-equation",
    )) {
      expect(equation.getAttribute("contenteditable")).toBe("false");
    }
  });

  it("preserves the math atom while editing on both sides", () => {
    const editor = createMathEditor("Before $`a^2`$ after");

    let position = inlineMathPosition(editor);
    editor.view.dispatch(editor.state.tr.insertText("left ", position));
    position = inlineMathPosition(editor);
    editor.view.dispatch(editor.state.tr.insertText(" right", position + 1));

    expect(docToNfm(editor.getJSON() as never)).toBe(
      "Before left $`a^2`$ right after",
    );
    let mathAttrs: Record<string, unknown> | null = null;
    editor.state.doc.descendants((node) => {
      if (
        node.type.name === "notionInlineAtom" &&
        node.attrs.tagName === "math"
      ) {
        mathAttrs = node.attrs;
        return false;
      }
      return mathAttrs === null;
    });
    expect(mathAttrs).toMatchObject({ tagName: "math", label: "a^2" });
  });

  it("keeps math source intact when adjacent text is deleted", () => {
    const editor = createMathEditor("A $`x`$ B");
    const position = inlineMathPosition(editor);

    editor.view.dispatch(editor.state.tr.delete(position - 1, position));

    expect(docToNfm(editor.getJSON() as never)).toBe("A$`x`$ B");
  });

  it("copies structured math content into another editor without drift", () => {
    const source = "Copy $`x^2`$ intact";
    const editor = createMathEditor(source);
    const target = createMathEditor("");

    target.commands.setContent(editor.getJSON());

    expect(docToNfm(target.getJSON() as never)).toBe(source);
  });

  it("degrades invalid expressions to visible raw source", async () => {
    const source = "Broken $`\\frac{`$ equation";
    const container = await mountVisualEditors(source);
    const fallbacks = container.querySelectorAll(".content-math-error");

    expect(fallbacks).toHaveLength(2);
    for (const fallback of fallbacks) {
      expect(fallback.textContent).toBe("\\frac{");
      expect(fallback.getAttribute("title")).toContain("KaTeX parse error");
    }
  });
});
