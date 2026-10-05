// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Editor,
  Node,
  type Extensions,
  type NodeViewRenderer,
} from "@tiptap/core";
import type { NodeView } from "@tiptap/pm/view";
import { EditorContent } from "@tiptap/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { createVisualEditorExtensions } from "./VisualEditor";

// Chromium on macOS reports `ontouchend` on document, so Tiptap's isiOS()
// treats every Mac as an iPad. Tiptap 3.30 then handed React's own node-view
// renders to ProseMirror as document edits, which re-created the node view in
// an endless loop until the tab crashed.
const MAC_CHROME_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, "compatMode", {
    configurable: true,
    value: "CSS1Compat",
  });
});

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

function emulateMacChromeWithTouch() {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: MAC_CHROME_USER_AGENT,
  });
  Object.defineProperty(document, "ontouchend", {
    configurable: true,
    value: null,
  });
  cleanup.push(() => {
    delete (navigator as { userAgent?: string }).userAgent;
    delete (document as { ontouchend?: unknown }).ontouchend;
  });
}

function capturingNodeViews(extensions: Extensions, names: string[]) {
  const views = new Map<string, NodeView>();
  const captured = extensions.map((extension) => {
    if (!names.includes(extension.name)) return extension;
    return (extension as Node).extend({
      addNodeView() {
        const render = this.parent?.() as NodeViewRenderer | undefined;
        if (!render) return null;
        return (props) => {
          const view = render(props);
          views.set(extension.name, view);
          return view;
        };
      },
    });
  });
  return { extensions: captured, views };
}

it.each(["notionToggle", "notionCallout"])(
  "keeps a focused %s node view stable when a Mac reports touch support",
  async (name) => {
    emulateMacChromeWithTouch();
    const { extensions, views } = capturingNodeViews(
      createVisualEditorExtensions(),
      [name],
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const editor = new Editor({
      extensions,
      content: {
        type: "doc",
        content: [
          { type: name, content: [{ type: "paragraph" }] },
          { type: "paragraph" },
        ],
      },
    });
    cleanup.push(() => {
      act(() => root.unmount());
      editor.destroy();
      container.remove();
    });

    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <EditorContent editor={editor} />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      editor.commands.focus("end");
    });
    expect(editor.isFocused).toBe(true);

    const view = views.get(name);
    const rendered = view?.dom.firstElementChild;
    expect(rendered).toBeTruthy();
    expect(view?.contentDOM?.contains(rendered!)).toBe(false);

    expect(
      view?.ignoreMutation?.({
        type: "childList",
        target: view.dom,
        addedNodes: [rendered!] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
      } as unknown as MutationRecord),
    ).toBe(true);

    const typed = document.createElement("p");
    expect(
      view?.ignoreMutation?.({
        type: "childList",
        target: view.contentDOM!,
        addedNodes: [typed] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
      } as unknown as MutationRecord),
    ).toBe(false);
  },
);
