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

import { VisualEditor } from "./VisualEditor";

const baseline = "Alpha beta gamma\nSecond block";

const lastSaved = (onChange: { mock: { calls: [value: string][] } }) =>
  onChange.mock.calls[onChange.mock.calls.length - 1]![0];

// The ChatGPT widget edits through the same editor as the app. Formatting
// appears on a selection and from the slash menu; there is no strip pinned to
// the top of the page in any width.
describe("widget formatting in the editor", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

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

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  }

  async function mount({ widget = true }: { widget?: boolean } = {}) {
    let authoritativeContent = baseline;
    let revision = 0;
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
              }),
            ),
          ),
        ),
      );
    await act(async () => render());
    await settle();
    const editor = captured.editor!;
    expect(docToNfm(editor.getJSON())).toBe(baseline);
    return { editor, onChange };
  }

  const bubble = () =>
    document.body.querySelector<HTMLElement>(".bubble-toolbar");
  const control = (label: string) =>
    bubble()?.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
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
    await settle();
  }

  it("pins no formatting strip to the page in the widget", async () => {
    const { editor } = await mount();

    expect(document.body.querySelector('[role="toolbar"]')).toBeNull();
    expect(document.body.querySelector("button[aria-label]")).toBeNull();

    await select(editor, "Alpha");
    expect(document.body.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("shows the selection toolbar for selected text and saves a bold edit", async () => {
    const { editor, onChange } = await mount();

    await select(editor, "Alpha");
    expect(bubble()).not.toBeNull();
    const bold = control("editor.bold");
    expect(bold).not.toBeNull();

    await act(async () => {
      bold!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          button: 0,
        }),
      );
    });
    await settle();

    expect(lastSaved(onChange)).toContain("**Alpha**");
    expect(lastSaved(onChange)).toBe(docToNfm(editor.getJSON()));
  });

  it("offers no selection toolbar while the caret is collapsed", async () => {
    const { editor } = await mount();

    await select(editor, "Alpha", 0);
    expect(control("editor.bold")?.offsetParent ?? null).toBeNull();
  });

  it("opens the slash menu from a slash typed in the widget", async () => {
    const { editor } = await mount();

    await select(editor, "Second block", 0);
    await act(async () => {
      editor.view.dispatch(editor.state.tr.insertText("/"));
    });
    await settle();

    expect(document.body.querySelector(".slash-command-menu")).not.toBeNull();
  });

  it("matches the app: the selection toolbar is the same outside the widget", async () => {
    const { editor } = await mount({ widget: false });

    await select(editor, "Alpha");
    expect(control("editor.bold")).not.toBeNull();
    expect(document.body.querySelector('[role="toolbar"]')).toBeNull();
  });
});
