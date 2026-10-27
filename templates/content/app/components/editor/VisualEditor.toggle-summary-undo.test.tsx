// @vitest-environment happy-dom

import { nfmToDoc } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type Editor, getSchema } from "@tiptap/core";
import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

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

import { createVisualEditorExtensions, VisualEditor } from "./VisualEditor";

const TITLE = "5. One MCP server for every sign-in";
const OPEN_TITLE = "6. An open toggle";

const PAGE = [
  "Intro.",
  "",
  "<details>",
  `<summary>${TITLE}</summary>`,
  "\tHidden text",
  "</details>",
  "",
  "<details open>",
  `<summary>${OPEN_TITLE}</summary>`,
  "\tShown text",
  "</details>",
].join("\n");

describe("undo in a Toggle's summary", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let ydoc: Y.Doc;

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
      vi.fn(
        async () =>
          new Response("{}", {
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
    captured.editor = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    ydoc.destroy();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function settle(ms = 150) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  // Opens the page from a live copy the server wrote, as beta does.
  async function open() {
    const server = new Y.Doc();
    prosemirrorJSONToYXmlFragment(
      getSchema(createVisualEditorExtensions()),
      nfmToDoc(PAGE),
      server.getXmlFragment("default"),
    );
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(server));
    server.destroy();
    const onChange = vi.fn();
    act(() =>
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
                content: PAGE,
                contentUpdatedAt: "2026-10-24T00:00:00.000Z",
                contentRevision: "open-1",
                documentId: "page-1",
                ydoc,
                collabSynced: true,
                onChange,
                editable: true,
              }),
            ),
          ),
        ),
      ),
    );
    await settle(300);
    const editor = captured.editor;
    if (!editor) throw new Error("The editor didn't open");
    return { editor, onChange };
  }

  function summaryInput(index: number) {
    const inputs = container.querySelectorAll<HTMLInputElement>(
      "input.content-toggle__summary",
    );
    if (index >= inputs.length) {
      throw new Error(`No Toggle summary at ${index}`);
    }
    return inputs.item(index);
  }

  function storedSummaries(editor: Editor) {
    const summaries: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "notionToggle") summaries.push(node.attrs.summary);
    });
    return summaries;
  }

  async function type(index: number, value: string) {
    const input = summaryInput(index);
    act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
  }

  async function press(index: number, init: KeyboardEventInit) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => {
      summaryInput(index).dispatchEvent(event);
    });
    await settle();
    return event;
  }

  it("undoes and redoes a collapsed Toggle's summary from the summary", async () => {
    const { editor, onChange } = await open();
    await type(0, "Love it. Yeah.");
    expect(storedSummaries(editor)).toEqual(["Love it. Yeah.", OPEN_TITLE]);

    const undo = await press(0, { key: "z", ctrlKey: true });
    expect(undo.defaultPrevented).toBe(true);
    expect(storedSummaries(editor)).toEqual([TITLE, OPEN_TITLE]);
    expect(summaryInput(0).value).toBe(TITLE);
    expect(document.activeElement).toBe(summaryInput(0));
    await vi.waitFor(() =>
      expect(String(onChange.mock.lastCall?.[0])).toContain(
        `<summary>${TITLE}</summary>`,
      ),
    );

    await press(0, { key: "z", ctrlKey: true, shiftKey: true });
    expect(storedSummaries(editor)).toEqual(["Love it. Yeah.", OPEN_TITLE]);
    expect(summaryInput(0).value).toBe("Love it. Yeah.");
  });

  it("undoes an open Toggle's summary with Cmd+Z and redoes it with Ctrl+Y", async () => {
    const { editor } = await open();
    await type(1, "Love it. Yeah.");

    await press(1, { key: "z", metaKey: true });
    expect(storedSummaries(editor)).toEqual([TITLE, OPEN_TITLE]);
    expect(summaryInput(1).value).toBe(OPEN_TITLE);
    expect(document.activeElement).toBe(summaryInput(1));

    await press(1, { key: "y", ctrlKey: true });
    expect(storedSummaries(editor)).toEqual([TITLE, "Love it. Yeah."]);
  });

  it("undoes only the summary while the body's cursor sits after a slash command being typed", async () => {
    const { editor } = await open();
    // A new paragraph holding "/ab" after "Intro.", with the cursor after it.
    act(() => {
      editor
        .chain()
        .insertContentAt(8, {
          type: "paragraph",
          content: [{ type: "text", text: "/ab" }],
        })
        .setTextSelection(12)
        .run();
    });
    // Far enough apart that the history keeps the two edits as separate steps.
    await settle(700);
    await type(0, "Love it. Yeah.");

    await press(0, { key: "z", ctrlKey: true });
    expect(storedSummaries(editor)).toEqual([TITLE, OPEN_TITLE]);
    expect(editor.state.doc.textContent).toContain("/ab");
  });

  it("leaves other shortcuts in the summary to the browser", async () => {
    await open();
    const selectAll = await press(0, { key: "a", ctrlKey: true });
    expect(selectAll.defaultPrevented).toBe(false);
  });
});
