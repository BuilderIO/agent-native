// @vitest-environment happy-dom

import { docToNfm } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { VisualEditor } from "./VisualEditor";

// The real renderer needs a browser that lays out SVG. These tests are about
// the block around the drawing, so source containing "broken" fails to draw
// and anything else draws a stand-in.
vi.mock("@agent-native/toolkit/app/blocks", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/toolkit/app/blocks")
  >()),
  useMermaidRender: (source: string) => {
    if (!source.trim()) return { mounted: true };
    if (source.includes("broken")) {
      return { mounted: true, error: "Parse error on line 2" };
    }
    return { mounted: true, svg: '<svg data-testid="drawing"></svg>' };
  },
}));

const DIAGRAM = "flowchart LR\n  A[Comment] --> B[Reply]";
const SOURCE = [
  "Before the diagram.",
  "",
  "```mermaid",
  DIAGRAM,
  "```",
  "",
  "After the diagram.",
].join("\n");

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
  for (const mounted of mountedRoots.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.queryClient.clear();
    mounted.container.remove();
  }
});

async function mountEditor(
  source: string,
  props: { editable?: boolean; drawDiagrams?: boolean } = {},
) {
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
            createElement(VisualEditor, {
              content: source,
              editable: props.editable ?? true,
              drawDiagrams: props.drawDiagrams ?? true,
              onChange: () => {},
            }),
          ),
        }),
      ),
    );
  });
  await settle();

  const dom = container.querySelector<HTMLElement & { editor?: Editor }>(
    ".ProseMirror",
  );
  if (!dom?.editor) throw new Error("The editor did not mount");
  return { container, editor: dom.editor };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function mermaidPosition(editor: Editor): number {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock" && node.attrs.language === "mermaid") {
      position = pos;
    }
    return position === -1;
  });
  if (position === -1) throw new Error("The Mermaid block was not found");
  return position;
}

async function pressKey(editor: Editor, key: string) {
  await act(async () => {
    editor.view.someProp("handleKeyDown", (handler) =>
      handler(editor.view, new KeyboardEvent("keydown", { key })),
    );
  });
  await settle();
}

describe("Mermaid code blocks", () => {
  it("draw the diagram at rest and hide the source", async () => {
    const { container } = await mountEditor(SOURCE);

    const block = container.querySelector(".content-mermaid");
    expect(block?.querySelector("pre")?.hidden).toBe(true);
    expect(block?.querySelector(".content-code-block-header")).toBeNull();
    expect(
      block?.querySelector(
        'button.content-mermaid__drawing [data-testid="drawing"]',
      ),
    ).not.toBeNull();
  });

  it("open the source on Enter and close it on Escape", async () => {
    const { container, editor } = await mountEditor(SOURCE);
    const blockPos = mermaidPosition(editor);
    const before = docToNfm(editor.getJSON() as never);

    await act(async () => {
      editor.chain().focus().setNodeSelection(blockPos).run();
    });
    await pressKey(editor, "Enter");

    const opened = editor.state.selection;
    expect(opened).toBeInstanceOf(TextSelection);
    expect(opened.$from.before()).toBe(blockPos);
    expect(opened.from).toBe(blockPos + 1 + DIAGRAM.length);
    expect(
      container.querySelector<HTMLPreElement>(".content-mermaid pre")?.hidden,
    ).toBe(false);

    await pressKey(editor, "Escape");

    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(blockPos);
    expect(
      container.querySelector<HTMLPreElement>(".content-mermaid pre")?.hidden,
    ).toBe(true);
    expect(docToNfm(editor.getJSON() as never)).toBe(before);
    expect(before).toContain(`\`\`\`mermaid\n${DIAGRAM}\n\`\`\``);
  });

  it("select the resting drawing when the caret arrows into it", async () => {
    const { editor } = await mountEditor(SOURCE);
    const blockPos = mermaidPosition(editor);

    await act(async () => {
      editor.commands.setTextSelection(blockPos - 1);
    });
    await pressKey(editor, "ArrowRight");

    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(blockPos);
  });

  it("keep the source open beside the error when it can't be drawn", async () => {
    const { container } = await mountEditor(
      SOURCE.replace(DIAGRAM, "flowchart LR\n  broken -->"),
    );

    const block = container.querySelector(".content-mermaid");
    expect(block?.querySelector("pre")?.hidden).toBe(false);
    // Without a locale provider the label is the message key's fallback, so
    // only the renderer's error is checked.
    expect(
      block?.querySelector(".content-mermaid__error")?.textContent,
    ).toContain("Parse error on line 2");
  });

  it("draw without an edit control in a read-only editor", async () => {
    const { container } = await mountEditor(SOURCE, { editable: false });

    const block = container.querySelector(".content-mermaid");
    expect(block?.querySelector("div.content-mermaid__drawing")).not.toBeNull();
    expect(block?.querySelector("button")).toBeNull();
  });

  it("stay plain code where diagrams aren't drawn", async () => {
    const { container } = await mountEditor(SOURCE, {
      editable: false,
      drawDiagrams: false,
    });

    expect(container.querySelector(".content-mermaid")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toBe(DIAGRAM);
  });
});
