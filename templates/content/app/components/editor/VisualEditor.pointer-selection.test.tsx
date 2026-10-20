// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      captured.editor = editor;
      return editor;
    },
  };
});
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import { suggestionHighlightKey } from "./extensions/SuggestionHighlight";
import { VisualEditor, type VisualEditorSuggestion } from "./VisualEditor";

describe("suggestion pointer selection handoff", () => {
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
    document.body.append(container);
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

  async function mount(editable = true, editableText = true) {
    const suggestions: VisualEditorSuggestion[] = [
      {
        id: "s1",
        kind: editableText ? "replace_text" : "set_inline_mark",
        beforeText: editableText ? "Changed" : "Bright",
        afterText: "Bright",
        anchor: { from: 0, prefix: "", suffix: " sample." },
        presentation: editableText ? "draft" : "canonical",
      },
    ];
    const onActivateSuggestion = vi.fn(() => {
      render("s1");
    });
    const render = (activeSuggestionId: string | null) =>
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
                content: "Bright sample.",
                onChange: vi.fn(),
                ydoc: null,
                editable,
                onActivateSuggestion,
                suggestions,
                activeSuggestionId,
              }),
            ),
          ),
        ),
      );
    await act(async () => render(null));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const editor = captured.editor!;
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({
      left: 0,
      right: 10,
      top: 0,
      bottom: 10,
    });
    act(() => {
      editor.view.focus();
    });
    const highlighted = container.querySelector<HTMLElement>(
      ".suggestion-change[data-suggestion-id=s1]",
    )!;
    expect(highlighted.textContent).toBe("Bright");
    const node = highlighted.firstChild!;
    const native = window.getSelection()!;
    const select = (
      anchor: Node,
      anchorOffset: number,
      head: Node,
      headOffset: number,
    ) => {
      native.setBaseAndExtent(anchor, anchorOffset, head, headOffset);
    };
    const click = (target = highlighted) => {
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 2,
      });
      act(() => {
        target.dispatchEvent(event);
      });
      expect(onActivateSuggestion).toHaveBeenCalledWith("s1");
      expect(event.defaultPrevented).toBe(false);
    };
    const updateActive = async (activeId: string | null) => {
      await act(async () => render(activeId));
    };
    return { editor, highlighted, node, native, select, click, updateActive };
  }

  it.each([false, true])(
    "preserves pending native paragraph-boundary selection through hover-clear metadata before click (reverse: %s)",
    async (reverse) => {
      const { editor, node, native, select, click, updateActive } =
        await mount();
      await updateActive("s1");
      act(() => editor.commands.setTextSelection(4));
      const paragraph = node.parentElement!.parentElement!;
      select(
        reverse ? node : paragraph,
        reverse ? 6 : 0,
        reverse ? paragraph : node,
        reverse ? 0 : 6,
      );
      expect(native.isCollapsed).toBe(false);
      expect(editor.state.selection.anchor).toBe(4);
      const before = editor.getJSON();
      const dispatch = vi.spyOn(editor.view, "dispatch");
      await updateActive(null);
      const transactions = dispatch.mock.calls.map(
        ([transaction]) => transaction,
      );
      const metadataTransactions = transactions.filter((transaction) =>
        transaction.getMeta(suggestionHighlightKey),
      );
      expect(metadataTransactions).toHaveLength(1);
      const transaction = metadataTransactions[0]!;
      expect(
        transactions.filter((candidate) => candidate.selectionSet),
      ).toEqual([transaction]);
      expect(transaction.selectionSet).toBe(true);
      expect(transaction.getMeta(suggestionHighlightKey).activeId).toBeNull();
      expect(transaction.docChanged).toBe(false);
      expect(editor.getJSON()).toEqual(before);
      expect(editor.state.selection.anchor).toBe(reverse ? 7 : 1);
      expect(editor.state.selection.head).toBe(reverse ? 1 : 7);
      expect(native.isCollapsed).toBe(false);
      dispatch.mockRestore();
      click();
      expect(editor.state.selection.anchor).toBe(reverse ? 7 : 1);
      expect(editor.state.selection.head).toBe(reverse ? 1 : 7);
    },
  );

  it.each([false, true])(
    "preserves exact pending word selection beside a deletion widget (reverse: %s)",
    async (reverse) => {
      const { editor, node, native, select, click } = await mount();
      select(node, reverse ? 6 : 0, node, reverse ? 0 : 6);
      expect(native.toString()).toBe("Bright");
      expect(editor.state.selection.empty).toBe(true);
      const before = editor.getJSON();
      click();
      expect(editor.state.selection.anchor).toBe(reverse ? 7 : 1);
      expect(editor.state.selection.head).toBe(reverse ? 1 : 7);
      expect(
        editor.state.doc.textBetween(
          editor.state.selection.from,
          editor.state.selection.to,
        ),
      ).toBe("Bright");
      expect(editor.getJSON()).toEqual(before);
    },
  );

  it("does not crop a genuine selection extending beyond the clicked suggestion", async () => {
    const { editor, node, select, click } = await mount();
    const end = node.parentElement!.nextSibling!;
    select(node, 2, end, 7);
    click();
    expect(editor.state.selection.anchor).toBe(3);
    expect(editor.state.selection.head).toBe(14);
  });

  it.each([false, true])(
    "replaces stale nonempty PM selection with the current native range (reverse: %s)",
    async (reverse) => {
      const { editor, node, select, click } = await mount();
      act(() =>
        editor.view.dispatch(
          editor.state.tr.setSelection(
            TextSelection.create(editor.state.doc, 8, 11),
          ),
        ),
      );
      select(node, reverse ? 6 : 0, node, reverse ? 0 : 6);
      click();
      expect(editor.state.selection.anchor).toBe(reverse ? 7 : 1);
      expect(editor.state.selection.head).toBe(reverse ? 1 : 7);
    },
  );

  it.each([false, true])(
    "does not redispatch an exactly matching selection (reverse: %s)",
    async (reverse) => {
      const { editor, node, select, click } = await mount();
      act(() =>
        editor.view.dispatch(
          editor.state.tr.setSelection(
            TextSelection.create(
              editor.state.doc,
              reverse ? 7 : 1,
              reverse ? 1 : 7,
            ),
          ),
        ),
      );
      select(node, reverse ? 6 : 0, node, reverse ? 0 : 6);
      const before = editor.state.selection;
      const dispatch = vi.spyOn(editor.view, "dispatch");
      click();
      expect(editor.state.selection).toBe(before);
      expect(
        dispatch.mock.calls.filter(([tr]) => tr.selectionSet),
      ).toHaveLength(0);
    },
  );

  it.each([
    "outside",
    "collapsed",
    "unmappable",
    "disjoint",
    "widget",
    "readonly",
    "inspection",
    "disconnected",
    "invalid",
    "zero",
    "blurred",
  ])("ignores %s selection without suppressing activation", async (kind) => {
    const { editor, highlighted, node, select, click } = await mount(
      kind !== "readonly",
      kind !== "inspection",
    );
    const outside = document.createElement("span");
    outside.textContent = "Outside";
    container.append(outside);
    if (kind === "outside") select(node, 0, outside.firstChild!, 3);
    else if (kind === "collapsed") select(node, 2, node, 2);
    else if (kind === "disjoint")
      select(highlighted.nextSibling!, 1, highlighted.nextSibling!, 4);
    else if (kind === "widget") {
      const widget = container.querySelector<HTMLElement>(
        "[data-suggestion-edit-boundary]",
      )!;
      select(
        widget.firstChild!,
        0,
        widget.firstChild!,
        widget.firstChild!.textContent!.length,
      );
    } else select(node, 0, node, 6);
    if (kind === "unmappable")
      vi.spyOn(editor.view, "posAtDOM").mockImplementation(() => {
        throw new RangeError("unmappable test node");
      });
    if (kind === "invalid")
      vi.spyOn(editor.view, "posAtDOM").mockReturnValue(Number.NaN);
    if (kind === "zero") vi.spyOn(editor.view, "posAtDOM").mockReturnValue(1);
    if (kind === "blurred") act(() => editor.view.dom.blur());
    if (kind === "disconnected") {
      const detached = document.createTextNode("Bright");
      vi.spyOn(document, "getSelection").mockReturnValueOnce({
        isCollapsed: false,
        rangeCount: 1,
        anchorNode: detached,
        focusNode: detached,
        anchorOffset: 0,
        focusOffset: 6,
      } as unknown as globalThis.Selection);
    }
    const before = editor.state.selection.toJSON();
    click();
    expect(editor.state.selection.toJSON()).toEqual(before);
  });
});
