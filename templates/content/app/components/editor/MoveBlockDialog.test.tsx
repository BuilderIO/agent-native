// @vitest-environment happy-dom
import { Editor, getNodeType, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { movedBlockNfm, useMoveBlock } from "./MoveBlockDialog";
import { createVisualEditorExtensions } from "./VisualEditor";

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  navigate: vi.fn(),
  search: vi.fn(),
  spaces: vi.fn(),
  toast: {
    loading: vi.fn(() => "move-toast"),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string>) =>
    vars ? `${key}(${Object.values(vars).join(",")})` : key,
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: (name: string, args: unknown, options: unknown) =>
    mocks.search(name, args, options),
}));

vi.mock("@/hooks/use-content-action-mutation", () => ({
  useContentActionMutation: () => ({ mutateAsync: mocks.append }),
}));

vi.mock("@/hooks/use-content-spaces", () => ({
  useContentSpaces: () => mocks.spaces(),
}));

vi.mock("@/hooks/use-local-storage", () => ({
  useLocalStorage: () => [null, vi.fn()],
}));

const recentPages = vi.hoisted(() => ({
  isLoading: false,
  data: {
    entries: [
      { target: { documentId: "page-here" }, title: "Here", icon: null },
      { target: { documentId: "page-a" }, title: "Plans", icon: null },
      {
        target: { documentId: "db-1", databaseId: "db", viewId: "board" },
        title: "Tasks",
        icon: null,
        viewName: "Board",
      },
      {
        target: { documentId: "db-2", databaseId: "db-two" },
        title: "Inventory",
        icon: null,
      },
      { target: { documentId: "db-2" }, title: "Inventory", icon: null },
    ],
  },
}));

vi.mock("@/hooks/use-content-recent", () => ({
  useContentRecent: (_spaceId: unknown, options: { enabled: boolean }) =>
    options.enabled ? recentPages : { isLoading: false, data: undefined },
}));

vi.mock("react-router", () => ({ useNavigate: () => mocks.navigate }));

vi.mock("sonner", () => ({ toast: mocks.toast }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useMoveBlock", () => {
  let editor: Editor | null = null;
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  let page: HTMLElement | null = null;
  let start: ReturnType<typeof useMoveBlock>["start"] | null = null;

  beforeEach(() => {
    mocks.spaces.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { spaces: [{ id: "space-1", name: "Personal" }] },
    });
    mocks.search.mockReturnValue({
      isLoading: false,
      data: {
        documents: [
          { id: "page-here", title: "Here", icon: null, parentTitle: null },
          { id: "page-b", title: "Plan B", icon: null, parentTitle: "Work" },
        ],
      },
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    editor?.destroy();
    page?.remove();
    editor = root = host = page = start = null;
    vi.clearAllMocks();
  });

  function Harness({ target }: { target: Editor }) {
    const move = useMoveBlock(target, "page-here");
    start = move.start;
    return move.dialog;
  }

  function mount(content: JSONContent[]) {
    page = document.createElement("div");
    document.body.append(page);
    editor = new Editor({
      element: page,
      extensions: createVisualEditorExtensions(),
      content: { type: "doc", content },
    });
    host = document.createElement("div");
    document.body.append(host);
    const nextRoot = createRoot(host);
    root = nextRoot;
    const current = editor;
    act(() => nextRoot.render(<Harness target={current} />));
    return current;
  }

  function startMoving(target: Editor, index: number) {
    let pos = 0;
    for (let child = 0; child < index; child += 1) {
      pos += target.state.doc.child(child).nodeSize;
    }
    act(() => start?.({ pos, node: target.state.doc.child(index) }));
  }

  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

  const options = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map(
      (option) => option.textContent,
    );

  function searchFor(text: string, wait = 150) {
    const input = dialog()?.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("No search box");
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldClearNativeTimers: true,
    });
    try {
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() => {
        vi.advanceTimersByTime(wait);
      });
    } finally {
      vi.useRealTimers();
    }
    return input;
  }

  function pick(text: string) {
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((element) => element.textContent.startsWith(text));
    if (!option) throw new Error(`No page "${text}"`);
    act(() => option.click());
  }

  const texts = (target: Editor) => {
    const found: string[] = [];
    target.state.doc.forEach((child) => found.push(child.textContent));
    return found;
  };

  it("lists recent pages, leaving out this page, collections, saved views and a page since made a collection", () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    startMoving(target, 1);

    expect(dialog()?.textContent).toContain("editor.blockMenu.moveToTitle");
    expect(options()).toEqual(["Plans"]);
  });

  it("waits for the spaces before saying there are no recent pages", () => {
    mocks.spaces.mockReturnValue({ isLoading: true, isError: false });
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    startMoving(target, 1);

    expect(options()).toEqual([]);
    expect(dialog()?.textContent).not.toContain("sidebar.noMatchingPages");
  });

  it("says the spaces failed to load, rather than that there are no pages, and retries them", () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.spaces.mockReturnValue({
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch,
    });
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    startMoving(target, 1);

    expect(dialog()?.textContent).toContain("empty.genericError");
    expect(dialog()?.textContent).not.toContain("sidebar.noMatchingPages");
    const retry = Array.from(dialog()?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "database.retry",
    );
    act(() => retry?.click());
    expect(refetch).toHaveBeenCalled();
  });

  it("searches every space's pages by title as you type", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    startMoving(target, 1);

    searchFor("plan");

    expect(mocks.search).toHaveBeenLastCalledWith(
      "search-documents",
      { query: "plan", searchFields: "title", documentType: "page", limit: 20 },
      { enabled: true },
    );
    expect(options()).toEqual(["Plan BWork"]);
  });

  it("says a search failed, rather than that nothing matched, and retries it", async () => {
    const refetch = vi.fn().mockResolvedValue(undefined);
    mocks.search.mockReturnValue({
      isLoading: false,
      isError: true,
      isFetching: false,
      data: undefined,
      refetch,
    });
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    startMoving(target, 1);

    searchFor("plan");

    expect(dialog()?.textContent).toContain("empty.genericError");
    expect(dialog()?.textContent).not.toContain("sidebar.noMatchingPages");
    const retry = Array.from(dialog()?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "database.retry",
    );
    act(() => retry?.click());
    expect(refetch).toHaveBeenCalled();
  });

  it("picks the first result with Enter, though a recent page was highlighted", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    mocks.append.mockResolvedValue({});
    startMoving(target, 1);
    const highlighted = () =>
      document.querySelector('[role="option"][aria-selected="true"]')
        ?.textContent;
    expect(highlighted()).toBe("Plans");

    const input = searchFor("plan");
    expect(highlighted()).toBe("Plan BWork");
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(mocks.append).toHaveBeenCalledWith({
      documentId: "page-b",
      content: "Move me",
    });
  });

  it("ignores Enter while a search waits to run, rather than picking a recent page", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    mocks.append.mockResolvedValue({});
    startMoving(target, 1);

    const input = searchFor("plan", 0);
    expect(dialog()?.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(dialog()?.textContent).not.toContain("sidebar.noMatchingPages");
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(mocks.append).not.toHaveBeenCalled();
    expect(texts(target)).toEqual(["Keep", "Move me"]);
  });

  it("adds the block to the chosen page, removes it here and offers Open", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    mocks.append.mockResolvedValue({ documentId: "page-a", title: "Plans" });
    startMoving(target, 1);

    await act(async () => pick("Plans"));

    expect(mocks.append).toHaveBeenCalledWith({
      documentId: "page-a",
      content: "Move me",
    });
    expect(texts(target)).toEqual(["Keep"]);
    expect(dialog()).toBeNull();
    expect(mocks.toast.loading).toHaveBeenCalledWith(
      "editor.blockMenu.movingTo(Plans)",
    );
    const [message, options] = mocks.toast.success.mock.calls[0] ?? [];
    expect(message).toBe("editor.blockMenu.movedTo(Plans)");
    expect(options.id).toBe("move-toast");
    expect(options.duration).toBe(10_000);
    expect(options.action.label).toBe("editor.blockMenu.openPage");
    options.action.onClick();
    expect(mocks.navigate).toHaveBeenCalledWith("/page/page-a");
  });

  it("keeps a block someone edits while it moves, and says it was copied", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    const sent = deferred<unknown>();
    mocks.append.mockReturnValue(sent.promise);
    startMoving(target, 1);
    pick("Plans");

    act(() => {
      target.view.dispatch(target.state.tr.insertText("!", 14));
    });
    await act(async () => sent.resolve({}));

    expect(texts(target)).toEqual(["Keep", "Move me!"]);
    expect(mocks.toast.success.mock.calls[0]?.[0]).toBe(
      "editor.blockMenu.copiedTo(Plans)",
    );
  });

  it("says the block stayed on its page when that page closed before the move finished", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    const sent = deferred<unknown>();
    mocks.append.mockReturnValue(sent.promise);
    startMoving(target, 1);
    pick("Plans");

    act(() => {
      target.destroy();
    });
    await act(async () => sent.resolve({}));

    expect(mocks.toast.success.mock.calls[0]?.[0]).toBe(
      "editor.blockMenu.copiedPageClosed(Plans)",
    );
  });

  it("follows the block when typing above it moves it", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    const sent = deferred<unknown>();
    mocks.append.mockReturnValue(sent.promise);
    startMoving(target, 1);
    pick("Plans");

    act(() => {
      target.view.dispatch(target.state.tr.insertText("ing", 5));
    });
    await act(async () => sent.resolve({}));

    expect(texts(target)).toEqual(["Keeping"]);
    expect(mocks.toast.success.mock.calls[0]?.[0]).toBe(
      "editor.blockMenu.movedTo(Plans)",
    );
  });

  function collaboratorWrites(target: Editor, content: JSONContent[]) {
    act(() => {
      const rebuilt = target.schema.nodeFromJSON({ type: "doc", content });
      target.view.dispatch(
        target.state.tr.replaceWith(
          0,
          target.state.doc.content.size,
          rebuilt.content,
        ),
      );
    });
  }

  it("finds the block after a collaborator's change elsewhere on the page", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    const sent = deferred<unknown>();
    mocks.append.mockReturnValue(sent.promise);
    startMoving(target, 1);
    pick("Plans");

    collaboratorWrites(target, [
      paragraph("New first"),
      paragraph("Keep typed"),
      paragraph("Move me"),
    ]);
    await act(async () => sent.resolve({}));

    expect(texts(target)).toEqual(["New first", "Keep typed"]);
    expect(mocks.toast.success.mock.calls[0]?.[0]).toBe(
      "editor.blockMenu.movedTo(Plans)",
    );
  });

  it("keeps a block a collaborator edits while it moves", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    const sent = deferred<unknown>();
    mocks.append.mockReturnValue(sent.promise);
    startMoving(target, 1);
    pick("Plans");

    collaboratorWrites(target, [paragraph("Keep"), paragraph("Move me too")]);
    await act(async () => sent.resolve({}));

    expect(texts(target)).toEqual(["Keep", "Move me too"]);
    expect(mocks.toast.success.mock.calls[0]?.[0]).toBe(
      "editor.blockMenu.copiedTo(Plans)",
    );
  });

  it("keeps the block's twins when a collaborator deletes the block among them", async () => {
    const target = mount([paragraph("A"), paragraph("A"), paragraph("A")]);
    const sent = deferred<unknown>();
    mocks.append.mockReturnValue(sent.promise);
    startMoving(target, 2);
    pick("Plans");

    collaboratorWrites(target, [paragraph("A"), paragraph("A")]);
    await act(async () => sent.resolve({}));

    expect(texts(target)).toEqual(["A", "A"]);
    expect(mocks.toast.success.mock.calls[0]?.[0]).toBe(
      "editor.blockMenu.copiedTo(Plans)",
    );
  });

  it("finds a block past twins when a collaborator deletes one of them", async () => {
    const target = mount([
      paragraph("Top"),
      paragraph("A"),
      paragraph("A"),
      paragraph("Move me"),
    ]);
    const sent = deferred<unknown>();
    mocks.append.mockReturnValue(sent.promise);
    startMoving(target, 3);
    pick("Plans");

    collaboratorWrites(target, [
      paragraph("Top"),
      paragraph("A"),
      paragraph("Move me"),
    ]);
    await act(async () => sent.resolve({}));

    expect(texts(target)).toEqual(["Top", "A"]);
    expect(mocks.toast.success.mock.calls[0]?.[0]).toBe(
      "editor.blockMenu.movedTo(Plans)",
    );
  });

  it("keeps a block deleted before a rewrite of the page in the same change", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    const sent = deferred<unknown>();
    mocks.append.mockReturnValue(sent.promise);
    startMoving(target, 1);
    pick("Plans");

    act(() => {
      const block = target.state.doc.child(1);
      const at = target.state.doc.child(0).nodeSize;
      const tr = target.state.tr
        .insert(at + block.nodeSize, block)
        .delete(at, at + block.nodeSize);
      const rebuilt = target.schema.nodeFromJSON(tr.doc.toJSON());
      target.view.dispatch(
        tr.replaceWith(0, tr.doc.content.size, rebuilt.content),
      );
    });
    await act(async () => sent.resolve({}));

    expect(texts(target)).toEqual(["Keep", "Move me"]);
    expect(mocks.toast.success.mock.calls[0]?.[0]).toBe(
      "editor.blockMenu.copiedTo(Plans)",
    );
  });

  it("keeps a duplicate of the block when the block itself is deleted while it moves", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    const sent = deferred<unknown>();
    mocks.append.mockReturnValue(sent.promise);
    startMoving(target, 1);
    pick("Plans");

    act(() => {
      const block = target.state.doc.child(1);
      const at = target.state.doc.child(0).nodeSize;
      target.view.dispatch(
        target.state.tr
          .insert(at + block.nodeSize, block)
          .delete(at, at + block.nodeSize),
      );
    });
    await act(async () => sent.resolve({}));

    expect(texts(target)).toEqual(["Keep", "Move me"]);
    expect(mocks.toast.success.mock.calls[0]?.[0]).toBe(
      "editor.blockMenu.copiedTo(Plans)",
    );
  });

  it("keeps a block wrapped in a quote while it moves", async () => {
    const target = mount([
      paragraph("Keep"),
      paragraph("Move me"),
      paragraph("After"),
    ]);
    const sent = deferred<unknown>();
    mocks.append.mockReturnValue(sent.promise);
    startMoving(target, 1);
    pick("Plans");

    act(() => {
      const at = target.state.doc.child(0).nodeSize;
      const range = target.state.doc.resolve(at + 1).blockRange();
      if (!range) throw new Error("No block range");
      target.view.dispatch(
        target.state.tr.wrap(range, [
          { type: getNodeType("blockquote", target.schema) },
        ]),
      );
    });
    await act(async () => sent.resolve({}));

    expect(target.state.doc.child(1).type.name).toBe("blockquote");
    expect(texts(target)).toEqual(["Keep", "Move me", "After"]);
    expect(mocks.toast.success.mock.calls[0]?.[0]).toBe(
      "editor.blockMenu.copiedTo(Plans)",
    );
  });

  it("keeps the block when the page can't take it, and says why", async () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    mocks.append.mockRejectedValue(
      Object.assign(
        new Error(
          "Action append-to-document failed: You can only view this page.",
        ),
        { actionMessage: "You can only view this page." },
      ),
    );
    startMoving(target, 1);

    await act(async () => pick("Plans"));

    expect(texts(target)).toEqual(["Keep", "Move me"]);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "editor.blockMenu.moveFailed(Plans)",
      { id: "move-toast", description: "You can only view this page." },
    );
  });

  it("sends nothing when the block changed before a page was picked", () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    startMoving(target, 1);

    act(() => {
      target.view.dispatch(target.state.tr.insertText("!", 14));
    });
    pick("Plans");

    expect(mocks.append).not.toHaveBeenCalled();
    expect(texts(target)).toEqual(["Keep", "Move me!"]);
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "editor.blockMenu.moveChanged",
    );
  });

  it("sends nothing when the picker closes", () => {
    const target = mount([paragraph("Keep"), paragraph("Move me")]);
    startMoving(target, 1);

    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(dialog()).toBeNull();
    expect(mocks.append).not.toHaveBeenCalled();
    expect(texts(target)).toEqual(["Keep", "Move me"]);
  });
});

describe("movedBlockNfm", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function node(json: JSONContent): ProseMirrorNode {
    editor = new Editor({
      extensions: createVisualEditorExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    return editor.schema.nodeFromJSON(json);
  }

  it("leaves out a video's id, in a Toggle too", () => {
    const video = {
      type: "video",
      attrs: {
        src: "https://example.com/clip.mp4",
        blockId: "video-abcd1234",
      },
    };

    expect(movedBlockNfm(node(video))).toBe(
      '<video src="https://example.com/clip.mp4"></video>',
    );
    const toggle = movedBlockNfm(
      node({
        type: "notionToggle",
        content: [
          {
            type: "notionToggleSummary",
            content: [{ type: "text", text: "Clip" }],
          },
          video,
        ],
      }),
    );
    expect(toggle).toContain("https://example.com/clip.mp4");
    expect(toggle).not.toContain("video-abcd1234");
  });
});
