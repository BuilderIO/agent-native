// @vitest-environment happy-dom

import { docToNfm } from "@shared/nfm";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { SEALED_FRAME_SANDBOX } from "./interactive-html/sealed-frame";
import { VisualEditor } from "./VisualEditor";

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

const HTML = [
  "<title>Tap counter</title>",
  '<button id="tap">0</button>',
  "<script>tap.onclick = () => tap.textContent++</script>",
].join("\n");
const SOURCE = [
  "Before the block.",
  "",
  "```html interactive",
  HTML,
  "```",
  "",
  "```html",
  HTML,
  "```",
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
  vi.unstubAllGlobals();
});

async function until(check: () => void) {
  await vi.waitFor(
    async () => {
      await act(async () => {});
      check();
    },
    { timeout: 3000 },
  );
}

async function mountEditor(
  props: Partial<ComponentProps<typeof VisualEditor>> = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
    ),
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mountedRoots.push({ container, queryClient, root });
  const render = (changed: Partial<ComponentProps<typeof VisualEditor>> = {}) =>
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
                content: SOURCE,
                editable: true,
                runInteractiveHtml: true,
                onChange: () => {},
                ...props,
                ...changed,
              }),
            ),
          }),
        ),
      );
    });
  render();
  await until(() =>
    expect(
      container.querySelector(".content-interactive-html__title"),
    ).not.toBeNull(),
  );
  const dom = container.querySelector<HTMLElement & { editor?: Editor }>(
    ".ProseMirror",
  );
  if (!dom?.editor) throw new Error("The editor did not mount");
  const block = container.querySelector<HTMLDialogElement>(
    ".content-interactive-html",
  );
  if (!block) throw new Error("The block did not mount");
  return { container, editor: dom.editor, block, render };
}

function blockPosition(editor: Editor): number {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.language === "html interactive") position = pos;
    return position === -1;
  });
  if (position === -1) throw new Error("The block was not found");
  return position;
}

const frameOf = (block: Element) => block.querySelector("iframe");
const sourceOf = (block: Element) => block.querySelector("pre");
const markdownOf = (editor: Editor) => docToNfm(editor.getJSON() as never);

async function press(block: Element, name: string) {
  const label = `editor.interactiveHtml.${name}`;
  const button = [...block.querySelectorAll("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label ||
      candidate.textContent === label,
  );
  if (!button) throw new Error(`No button ${label}`);
  await act(async () => button.click());
}

describe("interactive HTML blocks", () => {
  it("run in a sealed frame with their source put away", async () => {
    const { container, block } = await mountEditor();

    await until(() => expect(frameOf(block)).not.toBeNull());
    expect(frameOf(block)?.getAttribute("sandbox")).toBe(SEALED_FRAME_SANDBOX);
    expect(frameOf(block)?.getAttribute("srcdoc")).toContain(
      "default-src 'none'",
    );
    expect(frameOf(block)?.title).toBe("Tap counter");
    expect(sourceOf(block)?.hidden).toBe(true);
    expect(
      container.querySelectorAll(".content-interactive-html"),
    ).toHaveLength(1);
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("wait for a click on Run on a page that isn't the reader's own", async () => {
    const { block } = await mountEditor({ runInteractiveHtml: false });

    expect(frameOf(block)).toBeNull();
    await press(block, "run");

    await until(() => expect(frameOf(block)).not.toBeNull());
  });

  it("take the height the block reports, and only from its own frame", async () => {
    const { block } = await mountEditor();
    await until(() => expect(frameOf(block)).not.toBeNull());
    const frame = frameOf(block);
    const report = (height: number, source: unknown) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type: "content-interactive-html-height", height },
            source: source as Window,
          }),
        );
      });

    await report(900, window);
    expect(frame?.style.height).toBe("400px");

    await report(640, frame?.contentWindow);
    expect(frame?.style.height).toBe("640px");
  });

  it("show the source to read or edit, and put it away again", async () => {
    const { editor, block } = await mountEditor();
    const before = markdownOf(editor);

    await press(block, "showSource");
    await until(() => expect(sourceOf(block)?.hidden).toBe(false));
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.selection.$from.before()).toBe(blockPosition(editor));

    await press(block, "hideSource");
    await until(() => expect(sourceOf(block)?.hidden).toBe(true));
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(markdownOf(editor)).toBe(before);
    expect(before).toContain(`\`\`\`html interactive\n${HTML}\n\`\`\``);
  });

  it("keep the source open while the cursor is in it, whatever has focus", async () => {
    const { editor, block } = await mountEditor();
    const pos = blockPosition(editor);
    const moveCursor = (to: number) =>
      act(async () => {
        editor.chain().focus(null, { scrollIntoView: false }).run();
        editor.view.dispatch(
          editor.state.tr.setSelection(
            TextSelection.create(editor.state.doc, to),
          ),
        );
      });

    await moveCursor(pos + 1);
    await until(() => expect(sourceOf(block)?.hidden).toBe(false));

    await act(async () => editor.view.dom.blur());
    await until(() => expect(editor.isFocused).toBe(false));
    expect(sourceOf(block)?.hidden).toBe(false);

    await moveCursor(1);
    await until(() => expect(sourceOf(block)?.hidden).toBe(true));
  });

  it("show the source in a page that can't be edited", async () => {
    const { block } = await mountEditor({ editable: false });

    await press(block, "showSource");

    await until(() => expect(sourceOf(block)?.hidden).toBe(false));
    expect(sourceOf(block)?.textContent).toContain("Tap counter");
  });

  it("run the new source once an edit settles", async () => {
    const { editor, block } = await mountEditor();
    await until(() => expect(frameOf(block)).not.toBeNull());
    const pos = blockPosition(editor);

    await act(async () => {
      editor.view.dispatch(
        editor.state.tr.insertText("Changed ", pos + 1 + "<title>".length),
      );
    });
    await until(() =>
      expect(
        block.querySelector(".content-interactive-html__title")?.textContent,
      ).toBe("Changed Tap counter"),
    );
    expect(frameOf(block)?.srcdoc).not.toContain("Changed Tap counter");

    await until(() =>
      expect(frameOf(block)?.srcdoc).toContain("Changed Tap counter"),
    );
  });

  it("cover the window in full screen without reloading, until Escape", async () => {
    const { block } = await mountEditor();
    await until(() => expect(frameOf(block)).not.toBeNull());
    const frame = frameOf(block);

    await press(block, "fullScreen");
    await until(() => expect(block.open).toBe(true));
    expect(block.getAttribute("role")).toBe("dialog");
    expect(frameOf(block)).toBe(frame);
    expect(document.activeElement).toBe(frame);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "content-interactive-html-escape" },
          source: frame?.contentWindow ?? null,
        }),
      );
    });
    expect(block.open).toBe(false);
    expect(block.getAttribute("role")).toBe("figure");
    expect(frameOf(block)).toBe(frame);
  });

  it("open and close full screen as the page's link changes", async () => {
    const publicInteractiveHtml = {
      documentId: "doc-1",
      blockIds: { "0": "block_a", "1": "block_b" },
      displaySources: { imageSources: ["data:"], mediaSources: ["data:"] },
    };
    const { container, render } = await mountEditor({
      content: "```html interactive\n<p>A\n```\n```html interactive\n<p>B\n```",
      editable: false,
      publicInteractiveHtml,
      linkedBlockId: "block_a",
      linkedBlockFullScreen: true,
    });
    const open = () =>
      [...container.querySelectorAll("dialog")].map((dialog) => dialog.open);
    await until(() => expect(open()).toEqual([true, false]));

    render({ linkedBlockId: "block_b" });
    await until(() => expect(open()).toEqual([false, true]));

    render({ linkedBlockId: null, linkedBlockFullScreen: false });
    await until(() => expect(open()).toEqual([false, false]));
  });

  it("show media from the hosts a public page loads with, without asking for them", async () => {
    const { block } = await mountEditor({
      editable: false,
      publicInteractiveHtml: {
        documentId: "doc-1",
        blockIds: {},
        displaySources: {
          imageSources: ["data:", "https://media.example.com"],
          mediaSources: ["data:"],
        },
      },
    });

    await until(() =>
      expect(frameOf(block)?.getAttribute("srcdoc")).toContain(
        "img-src data: blob: https://media.example.com",
      ),
    );
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).includes("display-sources")),
    ).toEqual([]);
  });

  it("ask for an uploaded image again each time they are opened", async () => {
    const image = "/api/private-media/11111111-2222-4333-8444-555555555555";
    const open = async () => {
      const { block } = await mountEditor({
        content: `Text\n\n\`\`\`html interactive\n<img src="${image}">\n\`\`\``,
      });
      await until(() =>
        expect(frameOf(block)?.getAttribute("srcdoc")).toContain("data:"),
      );
      return vi
        .mocked(fetch)
        .mock.calls.filter(([url]) => String(url).includes(image)).length;
    };

    expect(await open()).toBe(1);
    expect(await open()).toBe(1);
  });

  it("show a caption and the empty source before anything is written", async () => {
    const { block } = await mountEditor({
      content: "Text\n\n```html interactive\n```",
    });

    expect(frameOf(block)).toBeNull();
    expect(sourceOf(block)?.hidden).toBe(false);
    expect(block.querySelector("button")).toBeNull();
  });

  it("are selected by their caption, so an agent can be told about them", async () => {
    const { editor, block } = await mountEditor();

    await act(async () => {
      block
        .querySelector<HTMLElement>(".content-interactive-html__title")
        ?.click();
    });

    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(editor.state.selection.from).toBe(blockPosition(editor));
  });
});
