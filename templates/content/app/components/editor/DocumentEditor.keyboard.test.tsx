// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { TooltipProvider } from "@/components/ui/tooltip";

const captured = vi.hoisted(() => ({
  editor: null as Editor | null,
  innerExtension: null as Extension | null,
}));
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(
        {
          ...args[0],
          extensions: [
            ...(args[0]?.extensions ?? []),
            ...(captured.innerExtension ? [captured.innerExtension] : []),
          ],
        },
        args[1],
      );
      captured.editor = editor;
      return editor;
    },
  };
});
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import { DocumentToolbar } from "./DocumentToolbar";
import { VisualEditor } from "./VisualEditor";

describe("document editor keyboard exit", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let ydoc: Y.Doc;

  beforeEach(() => {
    captured.innerExtension = null;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    ydoc = new Y.Doc();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    ydoc.destroy();
    container.remove();
    vi.unstubAllGlobals();
  });

  async function mount(suggesting = false) {
    const target = createRef<HTMLButtonElement>();
    const onSuggestingChange = vi.fn();
    const onChange = vi.fn();
    const onSaveContent = vi.fn(() => true);
    const onEscape = vi.fn(() =>
      target.current?.focus({ preventScroll: true }),
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
              { client: queryClient },
              createElement(DocumentToolbar, {
                documentId: "keyboard-fixture",
                utilityPanel: null,
                onUtilityPanelChange: () => {},
                canSuggest: true,
                suggesting,
                onSuggestingChange,
                editorEscapeTargetRef: target,
              }),
              createElement(VisualEditor, {
                content: "Draft text",
                contentUpdatedAt: "2026-09-09T00:00:00.000Z",
                onChange,
                onSaveContent,
                onEscape,
                ydoc: suggesting ? null : ydoc,
                collabSynced: true,
                editable: true,
              }),
            ),
          ),
        ),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const editor = captured.editor!;
    expect(editor).not.toBeNull();
    act(() => {
      editor.commands.setTextSelection(1);
      editor.view.dom.focus();
    });
    expect(document.activeElement).toBe(editor.view.dom);
    return {
      editor,
      target,
      onEscape,
      onChange,
      onSaveContent,
      onSuggestingChange,
    };
  }

  function key(
    target: HTMLElement,
    key: string,
    options: KeyboardEventInit = {},
  ) {
    const event = new KeyboardEvent("keydown", {
      key,
      ...(key === "Escape" ? { code: "Escape", keyCode: 27 } : {}),
      ...(key === "Tab" ? { code: "Tab", keyCode: 9 } : {}),
      bubbles: true,
      cancelable: true,
      ...options,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it.each([false, true])(
    "focuses the existing toolbar control without committing (suggesting: %s)",
    async (suggesting) => {
      const {
        editor,
        target,
        onEscape,
        onChange,
        onSaveContent,
        onSuggestingChange,
      } = await mount(suggesting);
      act(() => {
        editor.view.dispatch(editor.state.tr.insertText("Unsent "));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const draft = editor.getJSON();
      onChange.mockClear();
      onSaveContent.mockClear();
      const escape = key(editor.view.dom, "Escape");
      expect(document.activeElement?.getAttribute("aria-label")).toBe(
        suggesting
          ? "editor.toolbar.stopSuggesting"
          : "editor.toolbar.morePageActions",
      );
      expect(document.activeElement).toBe(target.current);
      expect(onEscape).toHaveBeenCalledOnce();
      expect(escape.defaultPrevented).toBe(true);
      expect(key(target.current!, "Tab").defaultPrevented).toBe(false);
      expect(editor.getJSON()).toEqual(draft);
      expect(onChange).not.toHaveBeenCalled();
      expect(onSaveContent).not.toHaveBeenCalled();
      expect(onSuggestingChange).not.toHaveBeenCalled();
      expect(container.querySelector('[role="menu"]')).toBeNull();
    },
  );

  it("preserves Tab and Shift-Tab indentation inside the editor", async () => {
    const { editor, onEscape } = await mount(true);
    expect(key(editor.view.dom, "Tab").defaultPrevented).toBe(true);
    expect(editor.state.doc.firstChild?.attrs.indent).toBe(1);
    expect(
      key(editor.view.dom, "Tab", { shiftKey: true }).defaultPrevented,
    ).toBe(true);
    expect(editor.state.doc.firstChild?.attrs.indent).toBe(0);
    expect(
      key(editor.view.dom, "Tab", { shiftKey: true }).defaultPrevented,
    ).toBe(true);
    expect(editor.state.doc.firstChild?.attrs.indent).toBe(0);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("leaves an Escape consumed by an inner editor plugin alone", async () => {
    const consumed = vi.fn(
      (_view, event: KeyboardEvent) => event.key === "Escape",
    );
    captured.innerExtension = Extension.create({
      name: "earlierEscapeConsumer",
      priority: 100,
      addProseMirrorPlugins() {
        return [new Plugin({ props: { handleKeyDown: consumed } })];
      },
    });
    const { editor, onEscape } = await mount(true);
    expect(key(editor.view.dom, "Escape").defaultPrevented).toBe(true);
    expect(consumed).toHaveBeenCalledOnce();
    expect(onEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it("does not exit during an IME composition Escape", async () => {
    const { editor, onEscape } = await mount(true);
    const before = editor.getJSON();
    key(editor.view.dom, "Escape", { isComposing: true });
    expect(onEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.getJSON()).toEqual(before);
  });

  it("does not exit for the legacy IME keyCode 229", async () => {
    const { editor, onEscape } = await mount(true);
    const before = editor.getJSON();
    key(editor.view.dom, "Escape", { keyCode: 229 });
    expect(onEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.getJSON()).toEqual(before);
  });

  it("does not override an already-prevented native Escape", async () => {
    const { editor, onEscape } = await mount(true);
    const before = editor.getJSON();
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    act(() => {
      editor.view.dom.dispatchEvent(event);
    });
    expect(onEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.getJSON()).toEqual(before);
  });

  it("uses the current exit callback without remounting the editor", async () => {
    const initial = await mount(true);
    const current = await mount(true);
    expect(current.editor).toBe(initial.editor);
    key(current.editor.view.dom, "Escape");
    expect(current.onEscape).toHaveBeenCalledOnce();
    expect(initial.onEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(current.target.current);
  });

  it("does not steal Escape from the bubble toolbar link input", async () => {
    const { editor, target, onEscape } = await mount(true);
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    key(editor.view.dom, "k", { metaKey: true });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="editor.pasteLink"]',
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    const draft = editor.getJSON();
    key(input!, "Escape");
    expect(onEscape).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(target.current);
    expect(editor.getJSON()).toEqual(draft);
  });

  it("does not intercept Escape from surrounding page controls", async () => {
    const { editor, target, onEscape, onSuggestingChange } = await mount(true);
    act(() => {
      target.current!.focus();
    });
    const draft = editor.getJSON();
    key(target.current!, "Escape");
    expect(document.activeElement).toBe(target.current);
    expect(onEscape).not.toHaveBeenCalled();
    expect(onSuggestingChange).not.toHaveBeenCalled();
    expect(editor.getJSON()).toEqual(draft);
  });
});
