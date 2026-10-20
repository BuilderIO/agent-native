// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import { VisualEditor, type VisualEditorExternalContent } from "./VisualEditor";

describe("VisualEditor external content", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}")),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function render(
    externalContent: VisualEditorExternalContent | null,
    editable = true,
  ) {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(
          TooltipProvider,
          null,
          createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(VisualEditor, {
              content: "One\nTwo",
              externalContent,
              onChange: vi.fn(),
              editable,
              localFileMode: true,
            }),
          ),
        ),
      ),
    );
  }

  const liveEditor = () =>
    (
      container.querySelector(".ProseMirror") as HTMLElement & {
        editor: Editor;
      }
    ).editor;

  const paragraphs = (editor: Editor) =>
    Array.from(
      { length: editor.state.doc.childCount },
      (_, index) => editor.state.doc.child(index).textContent,
    );

  it("merges into everything the editor holds and keeps the cursor", async () => {
    await act(async () => render(null));
    const editor = liveEditor();
    // Typing the hook hasn't heard about yet.
    await act(async () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.commands.insertContent(" typed");
    });
    const merge = vi.fn((live: string | null) =>
      live!.replace("One", "One edited"),
    );

    await act(async () => render({ key: "11:1", merge }));
    await act(async () => render({ key: "11:1", merge }));

    expect(merge).toHaveBeenCalledExactlyOnceWith("One\nTwo typed");
    expect(paragraphs(editor)).toEqual(["One edited", "Two typed"]);
    // Still right after the typing, past the longer first paragraph.
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  it("waits for a slash command to finish before merging", async () => {
    await act(async () => render(null));
    const editor = liveEditor();
    await act(async () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.commands.splitBlock();
      editor.commands.insertContent("/he");
    });
    const merge = vi.fn(() => null);

    await act(async () => render({ key: "11:1", merge }));
    expect(merge).not.toHaveBeenCalled();

    await act(async () => {
      editor.commands.deleteRange({
        from: editor.state.selection.from - 3,
        to: editor.state.selection.from,
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(merge).toHaveBeenCalledTimes(1);
  });

  it("waits for an input method to finish composing before merging", async () => {
    await act(async () => render(null));
    const editor = liveEditor();
    let composing = true;
    vi.spyOn(editor.view, "composing", "get").mockImplementation(
      () => composing,
    );
    const merge = vi.fn(() => null);

    await act(async () => render({ key: "11:1", merge }));
    expect(merge).not.toHaveBeenCalled();

    composing = false;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(merge).toHaveBeenCalledTimes(1);
  });

  it("reports no typed text from an editor that can't be edited", async () => {
    await act(async () => render(null, false));
    const merge = vi.fn(() => "Theirs");

    await act(async () => render({ key: "11:1", merge }, false));

    expect(merge).toHaveBeenCalledExactlyOnceWith(null);
    expect(paragraphs(liveEditor())).toEqual(["Theirs"]);
  });
});
