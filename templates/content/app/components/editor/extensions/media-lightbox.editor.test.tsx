// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent } from "@tiptap/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("@agent-native/core/client/uploads", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/uploads")
  >()),
  useFileUploadStatus: () => ({
    isSuccess: true,
    isError: false,
    isFetching: false,
    data: { configured: true },
    refetch: vi.fn(),
  }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { createVisualEditorExtensions } from "../VisualEditor";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

const TOP = "https://cdn.example.test/top.png";
const BEFORE = "https://cdn.example.test/before.png";
const AFTER = "https://cdn.example.test/after.png";
const NESTED = "https://cdn.example.test/nested.png";

const image = (src: string) => ({ type: "image", attrs: { src, alt: "" } });
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const column = (label: string, src: string) => ({
  type: "notionColumn",
  content: [paragraph(label), image(src)],
});

const untitledToggle = (
  open: boolean,
  content: JSONContent[],
): JSONContent => ({
  type: "notionToggle",
  attrs: { open, summary: "Details" },
  content,
});
const toggle = (open: boolean, content: JSONContent[]): JSONContent => ({
  type: "notionToggle",
  attrs: { open },
  content: [
    {
      type: "notionToggleSummary",
      content: [{ type: "text", text: "Details" }],
    },
    ...content,
  ],
});

const beforeAndAfterPage: JSONContent[] = [
  paragraph("Intro"),
  image(TOP),
  {
    type: "notionColumns",
    content: [column("Before", BEFORE), column("After", AFTER)],
  },
  paragraph("Outro"),
];

async function mountEditor(content = beforeAndAfterPage, editable = true) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const editor = new Editor({
    extensions: createVisualEditorExtensions({ documentId: "doc_1" }),
    content: { type: "doc", content },
    editable,
  });
  cleanup.push(() => {
    act(() => root.unmount());
    editor.destroy();
    container.remove();
    document.body.innerHTML = "";
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
  return { container, editor };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function expand(container: HTMLElement, index: number) {
  const block = Array.from(container.querySelectorAll(".media-block")).find(
    (_, position) => position === index,
  );
  const button = block?.querySelector<HTMLButtonElement>(
    'button[aria-label="editor.media.expandImage"]',
  );
  if (!block || !button) throw new Error(`No image ${index} to expand`);
  await act(async () => button.click());
  await settle();
  return block;
}

async function press(key: string) {
  await act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

function lightbox() {
  return document.body.querySelector<HTMLElement>(
    '[role="dialog"].media-lightbox',
  );
}

function shownSrc() {
  return lightbox()
    ?.querySelector("img.media-lightbox__image")
    ?.getAttribute("src");
}

function position() {
  return lightbox()?.querySelector(".media-lightbox__position")?.textContent;
}

function stepButton(label: "previousImage" | "nextImage") {
  return lightbox()?.querySelector<HTMLButtonElement>(
    `button[aria-label="editor.media.${label}"]`,
  );
}

describe("media lightbox in a live editor", () => {
  it.each([
    ["on its own", 0],
    ["in a column", 1],
  ])("keeps an image's lightbox open %s", async (_, index) => {
    const { container } = await mountEditor();
    expect(container.querySelectorAll(".media-block")).toHaveLength(3);

    const block = await expand(container, index);

    expect(lightbox()).not.toBeNull();
    expect(block.isConnected).toBe(true);
  });

  it("renders no explicit aria-live inside the editor", async () => {
    const { container } = await mountEditor();

    expect(container.querySelectorAll(".ProseMirror [aria-live]")).toHaveLength(
      0,
    );
  });

  it("steps through the page's images in reading order with the arrow keys", async () => {
    const { container, editor } = await mountEditor();
    await expand(container, 1);
    const selection = editor.state.selection;

    expect(shownSrc()).toBe(BEFORE);
    expect(position()).toBe(
      'editor.media.imagePosition {"current":2,"total":3}',
    );

    await press("ArrowRight");
    expect(shownSrc()).toBe(AFTER);
    expect(stepButton("nextImage")?.disabled).toBe(true);

    await press("ArrowRight");
    expect(shownSrc()).toBe(AFTER);

    await press("ArrowLeft");
    await press("ArrowLeft");
    expect(shownSrc()).toBe(TOP);
    expect(position()).toBe(
      'editor.media.imagePosition {"current":1,"total":3}',
    );
    expect(stepButton("previousImage")?.disabled).toBe(true);
    expect(editor.state.selection.eq(selection)).toBe(true);
  });

  it("steps with the toolbar's buttons", async () => {
    const { container } = await mountEditor();
    await expand(container, 0);

    await act(async () => stepButton("nextImage")?.click());
    expect(shownSrc()).toBe(BEFORE);

    await act(async () => stepButton("previousImage")?.click());
    expect(shownSrc()).toBe(TOP);
  });

  it("hands focus back to the image showing when it closes", async () => {
    const { container, editor } = await mountEditor();
    await expand(container, 0);

    await press("ArrowRight");
    await press("ArrowRight");
    await press("Escape");

    expect(lightbox()).toBeNull();
    await vi.waitFor(() => {
      const { selection } = editor.state;
      expect(selection).toBeInstanceOf(NodeSelection);
      expect((selection as NodeSelection).node.attrs.src).toBe(AFTER);
    });
  });

  it("hands focus to the showing image on a read-only page", async () => {
    const { container } = await mountEditor(beforeAndAfterPage, false);
    await expand(container, 0);

    await press("ArrowRight");
    await press("ArrowRight");
    await press("Escape");

    expect(lightbox()).toBeNull();
    const after = container.querySelector(`img[src="${AFTER}"]`);
    expect(after).not.toBeNull();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(after);
    });
  });

  it.each([
    ["with a title", toggle],
    ["without a title", untitledToggle],
  ])("skips images in a closed toggle %s", async (_, makeToggle) => {
    const { container } = await mountEditor([
      image(TOP),
      makeToggle(false, [image(BEFORE), makeToggle(true, [image(NESTED)])]),
      makeToggle(true, [image(AFTER)]),
    ]);
    expect(container.querySelectorAll(".media-block")).toHaveLength(4);
    await expand(container, 0);

    expect(position()).toBe(
      'editor.media.imagePosition {"current":1,"total":2}',
    );
    await press("ArrowRight");
    expect(shownSrc()).toBe(AFTER);
    expect(stepButton("nextImage")?.disabled).toBe(true);
  });

  it("shows no stepping on a page with one image", async () => {
    const { container } = await mountEditor([paragraph("Intro"), image(TOP)]);
    await expand(container, 0);

    expect(stepButton("nextImage")).toBeNull();
    expect(position()).toBeUndefined();

    await press("ArrowRight");
    expect(shownSrc()).toBe(TOP);
  });
});
