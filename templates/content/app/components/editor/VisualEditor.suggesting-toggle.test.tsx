// @vitest-environment jsdom

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

const PAGE = [
  "Intro.",
  "",
  "<details>",
  "<summary>Toggle title</summary>",
  "\tHidden text",
  "</details>",
].join("\n");

describe("Toggles while suggesting", () => {
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

  async function mount(suggesting: boolean) {
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
              createElement(VisualEditor, {
                content: PAGE,
                onChange: vi.fn(),
                ydoc: null,
                editable: true,
                suggesting,
              }),
            ),
          ),
        ),
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    return captured.editor!;
  }

  function storedOpen(editor: Editor): boolean | undefined {
    let open: boolean | undefined;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "notionToggle") open = node.attrs.open;
      return open === undefined;
    });
    return open;
  }

  async function clickToggle() {
    await act(async () => {
      container
        .querySelector<HTMLElement>(".notion-toggle__summary-row")!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function bodyCollapsed(): boolean {
    return container
      .querySelector(".notion-toggle__body")!
      .classList.contains("notion-toggle__body--collapsed");
  }

  it("opens and closes a Toggle without changing the draft", async () => {
    const editor = await mount(true);
    expect(storedOpen(editor)).toBe(false);
    expect(bodyCollapsed()).toBe(true);
    expect(container.querySelector("input.notion-toggle__summary")).toBeNull();

    await clickToggle();
    expect(bodyCollapsed()).toBe(false);
    expect(storedOpen(editor)).toBe(false);

    await clickToggle();
    expect(bodyCollapsed()).toBe(true);
    expect(storedOpen(editor)).toBe(false);
  });

  it("stores the open state outside suggesting", async () => {
    const editor = await mount(false);
    expect(container.querySelector("input.notion-toggle__summary")).not.toBe(
      null,
    );

    await clickToggle();
    expect(bodyCollapsed()).toBe(false);
    expect(storedOpen(editor)).toBe(true);
  });
});
