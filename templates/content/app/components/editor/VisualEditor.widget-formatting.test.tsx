// @vitest-environment happy-dom

import { docToNfm } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
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

import {
  VisualEditor,
  type VisualEditorHistoryController,
} from "./VisualEditor";

const baseline = "Alpha beta gamma\nSecond block";

const lastSaved = (onChange: { mock: { calls: [value: string][] } }) =>
  onChange.mock.calls[onChange.mock.calls.length - 1]![0];

describe("widget formatting strip in the editor", () => {
  let container: HTMLDivElement;
  let slot: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let toolbarWidth = 700;

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
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const measure = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.getAttribute("role") === "toolbar"
          ? ({ width: toolbarWidth, height: 48 } as DOMRect)
          : measure.call(this);
      },
    );
    slot = document.createElement("div");
    slot.setAttribute("data-content-widget-formatting-slot", "");
    container = document.createElement("div");
    document.body.append(slot, container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    slot.remove();
    container.remove();
    toolbarWidth = 700;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }

  async function mount({
    widget = true,
    withSlot = true,
  }: { widget?: boolean; withSlot?: boolean } = {}) {
    let authoritativeContent = baseline;
    let revision = 0;
    let history: VisualEditorHistoryController | null = null;
    const onHistoryControllerChange = (
      controller: VisualEditorHistoryController | null,
    ) => {
      history = controller;
    };
    const onChange = vi.fn((value: string) => {
      authoritativeContent = value;
      revision += 1;
      render();
    });
    const render = () =>
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
                content: authoritativeContent,
                contentUpdatedAt: "2026-10-09T00:00:00.000Z",
                contentRevision: `widget-${revision}`,
                onChange,
                editable: true,
                directoryWidgetEditing: widget,
                widgetFormattingSlot: widget && withSlot ? slot : null,
                onHistoryControllerChange,
              }),
            ),
          ),
        ),
      );
    await act(async () => render());
    await settle();
    const editor = captured.editor!;
    expect(docToNfm(editor.getJSON())).toBe(baseline);
    return { editor, onChange, history: () => history! };
  }

  const toolbar = () =>
    document.body.querySelector<HTMLElement>(
      '[role="toolbar"][data-content-widget-format-toolbar]',
    );
  const control = (label: string) =>
    toolbar()?.querySelector<HTMLButtonElement>(
      `button[aria-label^="${label}"]`,
    ) ?? null;

  async function select(editor: Editor, text: string, length = text.length) {
    let from = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && from < 0 && node.text?.includes(text)) {
        from = position + node.text.indexOf(text);
      }
    });
    expect(from).toBeGreaterThan(0);
    await act(async () => {
      editor.commands.setTextSelection({ from, to: from + length });
      editor.view.dom.focus();
    });
  }

  async function press(label: string) {
    const target = control(label)!;
    expect(target, label).not.toBeNull();
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      target.dispatchEvent(down);
      target.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(down.defaultPrevented, `${label} keeps the editor selection`).toBe(
      true,
    );
  }

  const selectionFillPlugins = (editor: Editor) =>
    editor.state.plugins.filter((plugin) =>
      (plugin as unknown as { key: string }).key.startsWith(
        "contentSelectionFill",
      ),
    );

  it("renders the docked strip in the page slot instead of the floating bubble", async () => {
    const { editor } = await mount();
    expect(selectionFillPlugins(editor)).toHaveLength(1);

    expect(slot.contains(toolbar())).toBe(true);
    expect(container.contains(toolbar())).toBe(false);
    expect(container.querySelector(".bubble-toolbar")).toBeNull();
    expect(
      slot.querySelectorAll("[data-content-widget-format-toolbar]"),
    ).toHaveLength(1);
  });

  it("keeps the strip pinned in place when the page has no slot", async () => {
    await mount({ withSlot: false });

    const strip = toolbar()!;
    expect(strip).not.toBeNull();
    expect(strip.parentElement?.className).toContain("sticky");
    expect(strip.parentElement?.className).toContain("top-0");
    expect(container.contains(strip)).toBe(true);
  });

  it("keeps the floating bubble outside the widget", async () => {
    const { editor } = await mount({ widget: false });
    await select(editor, "Alpha");
    await settle();

    expect(toolbar()).toBeNull();
    expect(
      document.body.querySelector('button[aria-label="editor.bold"]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector('button[aria-label="editor.toolbar.undo"]'),
    ).toBeNull();
  });

  it("persists bold, italic, headings, bullets, and numbers through the normal change path", async () => {
    const { editor, onChange } = await mount();
    const lastChange = () => lastSaved(onChange);

    await select(editor, "Alpha");
    await press("editor.bold");
    expect(lastChange()).toBe(docToNfm(editor.getJSON()));
    expect(lastChange()).toContain("**Alpha**");
    expect(control("editor.bold")!.getAttribute("aria-pressed")).toBe("true");

    await select(editor, "beta");
    await press("editor.italic");
    expect(lastChange()).toContain("*beta*");

    await select(editor, "Second", 0);
    await press("editor.slash.bulletedList");
    expect(lastChange()).toContain("- Second block");
    expect(
      control("editor.slash.bulletedList")!.getAttribute("aria-pressed"),
    ).toBe("true");

    await press("editor.slash.numberedList");
    expect(lastChange()).toContain("1. Second block");
    expect(lastChange()).not.toContain("- Second block");
    expect(lastChange()).toBe(docToNfm(editor.getJSON()));

    await select(editor, "Alpha", 0);
    await act(async () => control("editor.slash.turnInto")!.click());
    await settle();
    const row = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        '[role="menu"][aria-label="editor.slash.turnInto"] button',
      ),
    ).find((button) => button.textContent?.includes("editor.heading2"))!;
    await act(async () => {
      row.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerType: "mouse",
          button: 0,
        }),
      );
    });
    await settle();
    expect(lastChange()).toContain("## ");
    expect(lastChange()).toBe(docToNfm(editor.getJSON()));
    expect(editor.isActive("heading", { level: 2 })).toBe(true);
  });

  it("persists a link applied from the docked link field", async () => {
    const { editor, onChange } = await mount();

    await select(editor, "gamma");
    await press("editor.link");
    const input = toolbar()!.querySelector<HTMLInputElement>(
      'input[aria-label="editor.pasteLink"]',
    )!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "https://example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await settle();

    expect(lastSaved(onChange)).toContain("[gamma](https://example.com)");
  });

  it("undoes and redoes through the editor's history controller", async () => {
    const { editor, onChange, history } = await mount();
    const undo = vi.spyOn(history(), "undo");
    const redo = vi.spyOn(history(), "redo");

    expect(control("editor.toolbar.undo")!.disabled).toBe(true);
    await select(editor, "Alpha");
    await press("editor.bold");
    const bolded = lastSaved(onChange);
    expect(bolded).toContain("**Alpha**");
    expect(control("editor.toolbar.undo")!.disabled).toBe(false);

    await press("editor.toolbar.undo");
    expect(undo).toHaveBeenCalledTimes(1);
    expect(lastSaved(onChange)).toBe(baseline);
    expect(control("editor.toolbar.redo")!.disabled).toBe(false);

    await press("editor.toolbar.redo");
    expect(redo).toHaveBeenCalledTimes(1);
    expect(lastSaved(onChange)).toBe(bolded);
  });

  it("moves lower-priority actions into the overflow menu in a narrow frame", async () => {
    toolbarWidth = 360;
    await mount();

    for (const label of [
      "editor.slash.turnInto",
      "editor.bold",
      "editor.italic",
      "editor.slash.bulletedList",
      "editor.slash.numberedList",
    ]) {
      expect(control(label), label).not.toBeNull();
    }
    expect(control("editor.strikethrough")).toBeNull();
    expect(control("editor.media.more")).not.toBeNull();
  });
});
