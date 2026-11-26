// @vitest-environment happy-dom

import { Editor as CoreEditor } from "@tiptap/core";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BubbleToolbar } from "./BubbleToolbar.js";

describe("BubbleToolbar selections", () => {
  let container: HTMLDivElement;
  let editorHost: HTMLDivElement;
  let toolbarHost: HTMLDivElement;
  let root: Root;
  let editor: CoreEditor;
  let rangeRect: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    editorHost = document.createElement("div");
    toolbarHost = document.createElement("div");
    container.append(editorHost, toolbarHost);
    document.body.append(container);
    editor = new CoreEditor({
      element: editorHost,
      extensions: [StarterKit],
      content: "<p>Selected summary text</p><p>More text</p>",
      editable: true,
    });
    root = createRoot(toolbarHost);
    rangeRect = vi
      .spyOn(Range.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 20,
        y: 30,
        top: 30,
        left: 20,
        right: 120,
        bottom: 50,
        width: 100,
        height: 20,
        toJSON: () => ({}),
      });
  });

  afterEach(() => {
    act(() => root.unmount());
    editor.destroy();
    container.remove();
    rangeRect?.mockRestore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderToolbar() {
    await act(async () => {
      root.render(
        <BubbleToolbar
          editor={editor as never}
          buildItems={() => [
            {
              label: "Quick edit ⌘ J",
              title: "Quick edit",
              action: vi.fn(),
              isActive: () => false,
            },
          ]}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function dispatchSelection(
    selection: TextSelection | AllSelection | NodeSelection,
  ) {
    await act(async () => {
      editor.view.dispatch(editor.state.tr.setSelection(selection));
      editor.view.focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("shows the toolbar for a focused AllSelection", async () => {
    await renderToolbar();
    const selection = new AllSelection(editor.state.doc);
    await dispatchSelection(selection);

    expect(editor.state.selection).toBeInstanceOf(AllSelection);
    expect(toolbarHost.textContent).toContain("Quick edit ⌘ J");
  });

  it("keeps text selections visible and empty or node selections hidden", async () => {
    await renderToolbar();
    await dispatchSelection(TextSelection.create(editor.state.doc, 1, 8));
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(toolbarHost.textContent).toContain("Quick edit ⌘ J");

    await dispatchSelection(TextSelection.create(editor.state.doc, 1));
    expect(toolbarHost.textContent).not.toContain("Quick edit");

    await dispatchSelection(NodeSelection.create(editor.state.doc, 1));
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(toolbarHost.textContent).not.toContain("Quick edit");
  });
});
