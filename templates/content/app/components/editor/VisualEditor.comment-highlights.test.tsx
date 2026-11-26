// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { CommentThread } from "@/hooks/use-comments";

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
const pages = vi.hoisted(() => ({
  create: vi.fn(async (_parentId: string, _id: string) => {}),
  rollback: vi.fn(async (_input: { id: string; parentId: string }) => ({})),
}));
vi.mock("@/hooks/use-create-page", () => ({
  useCreatePage: () => pages.create,
}));
vi.mock("@/hooks/use-documents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-documents")>()),
  useRollbackCreatedSlashDocument: () => ({ mutateAsync: pages.rollback }),
}));

import {
  derivedCommentAnchorBlockId,
  derivedVideoBlockId,
} from "@shared/comment-block-anchor";

import { commentHighlightKey } from "./extensions/CommentHighlight";
import { VisualEditor, type VisualEditorSuggestion } from "./VisualEditor";

function found<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected the fixture to have it");
  return value;
}

const BEFORE = "Intro.\nThe team ships every Friday afternoon, so it lands.";
const AFTER = "Intro.\nThe team ships every Friday at 2 pm, so it lands.";

function thread(
  threadId: string,
  quotedText = "ships every Friday afternoon",
): CommentThread {
  return {
    threadId,
    quotedText,
    prefix: null,
    suffix: null,
    startOffset: null,
    resolved: false,
    comments: [],
  };
}

describe("VisualEditor comment highlights", () => {
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

  function render(
    content: string,
    threads: CommentThread[],
    resetKey = "seed",
    showCommentIndicators = true,
    props: Partial<Parameters<typeof VisualEditor>[0]> = {},
  ) {
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
              content,
              contentResetKey: resetKey,
              onChange: vi.fn(),
              ydoc: null,
              editable: true,
              commentThreads: threads,
              showCommentIndicators,
              ...props,
            }),
          ),
        ),
      ),
    );
  }

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

  const highlighted = (threadId: string) =>
    [...container.querySelectorAll(`[data-comment-thread="${threadId}"]`)]
      .map((element) => element.textContent)
      .join("");

  it("keeps a thread's highlight on text replaced before its new quote arrives", async () => {
    await act(async () => render(BEFORE, [thread("t1")]));
    await settle();
    expect(highlighted("t1")).toBe("ships every Friday afternoon");

    // The accepted text reaches the editor while the thread still carries the
    // quote it had before the change.
    await act(async () => render(AFTER, [thread("t1")], "accepted"));
    await settle();

    expect(highlighted("t1")).toBe("ships every Friday at 2 pm");

    // The thread's re-anchored quote then replaces the mapped range.
    await act(async () =>
      render(AFTER, [thread("t1", "every Friday at 2 pm")], "accepted"),
    );
    await settle();

    expect(highlighted("t1")).toBe("every Friday at 2 pm");
  });

  it("finds a highlight's quote again after a swap too large to diff in time", async () => {
    let seed = 7;
    const word = () =>
      Array.from({ length: 6 }, () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return "abcdefghijklmnopqrstuvwxyz"[seed % 26];
      }).join("");
    const sentence = () => `${Array.from({ length: 20 }, word).join(" ")}.`;
    const before = Array.from({ length: 100 }, sentence);
    before[50] = "Keep this exact quote here.";
    await act(async () =>
      render(before.join("\n"), [thread("t1", "exact quote")]),
    );
    await settle();
    expect(highlighted("t1")).toBe("exact quote");
    const editor = (
      container.querySelector(".ProseMirror") as HTMLElement & {
        editor: Editor;
      }
    ).editor;

    // One collaborative update rewrites every paragraph but the quote's.
    const after = before.map((text, index) =>
      index === 50 ? text : sentence(),
    );
    await act(async () => {
      editor.commands.setContent({
        type: "doc",
        content: after.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      });
    });

    expect(highlighted("t1")).toBe("exact quote");
  });

  it("moves a highlight when its thread is re-anchored to another copy", async () => {
    const anchored = (suffix: string) => ({
      ...thread("t1", "beta"),
      suffix,
    });
    await act(async () => render("beta Alpha beta.", [anchored(".")]));
    await settle();
    const editor = (
      container.querySelector(".ProseMirror") as HTMLElement & {
        editor: Editor;
      }
    ).editor;
    const start = () =>
      commentHighlightKey
        .getState(editor.state)!
        .specs.find((spec) => spec.threadId === "t1")?.from;
    expect(start()).toBe(12);

    // Only the context changes: the quote is the same text.
    await act(async () => render("beta Alpha beta.", [anchored(" Alpha")]));
    await settle();

    expect(start()).toBe(1);
  });

  it("moves a highlight to its new quote once the quote arrives in the page", async () => {
    await act(async () => render("Alpha beta.", [thread("t1", "Alpha")]));
    await settle();
    expect(highlighted("t1")).toBe("Alpha");

    // The thread's new quote reaches the editor before the text it quotes.
    await act(async () => render("Alpha beta.", [thread("t1", "gamma")]));
    await settle();
    expect(highlighted("t1")).toBe("Alpha");

    await act(async () =>
      render("Alpha beta gamma.", [thread("t1", "gamma")], "arrived"),
    );
    await settle();

    expect(highlighted("t1")).toBe("gamma");
  });

  it("shows highlights again when comment indicators are restored", async () => {
    await act(async () => render(BEFORE, [thread("t1")]));
    await settle();
    expect(highlighted("t1")).toBe("ships every Friday afternoon");

    await act(async () => render(BEFORE, [thread("t1")], "seed", false));
    await settle();
    expect(highlighted("t1")).toBe("");

    await act(async () => render(BEFORE, [thread("t1")], "seed", true));
    await settle();
    expect(highlighted("t1")).toBe("ships every Friday afternoon");
  });

  describe("suggestions", () => {
    const suggestion: VisualEditorSuggestion = {
      id: "s1",
      kind: "replace_text",
      beforeText: "afternoon",
      afterText: "at 2 pm",
      anchor: { from: 0, prefix: "every Friday ", suffix: ", so" },
      presentation: "canonical",
    };
    const suggested = () =>
      [...container.querySelectorAll("[data-suggestion-id=s1]")]
        .map((element) => element.textContent)
        .join(" → ");

    it("hides a suggestion with comment indicators and still reports it placed", async () => {
      const onSuggestionAnchorsChange = vi.fn();
      const props = { suggestions: [suggestion], onSuggestionAnchorsChange };
      await act(async () => render(BEFORE, [], "seed", false, props));
      await settle();
      expect(suggested()).toBe("");
      expect(onSuggestionAnchorsChange).toHaveBeenLastCalledWith(["s1"]);

      await act(async () => render(BEFORE, [], "seed", true, props));
      await settle();
      expect(suggested()).toBe("afternoon → at 2 pm");
      expect(onSuggestionAnchorsChange).toHaveBeenLastCalledWith(["s1"]);
    });

    it.each([
      [false, 1],
      [true, 0],
    ])(
      "reports placed suggestions after typing only outside Suggesting (suggesting: %s)",
      async (suggesting, reports) => {
        const onSuggestionAnchorsChange = vi.fn();
        await act(async () =>
          render(BEFORE, [], "seed", true, {
            suggestions: [suggestion],
            onSuggestionAnchorsChange,
            suggesting,
          }),
        );
        await settle();
        onSuggestionAnchorsChange.mockClear();
        const editor = found(captured.editor);
        act(() => {
          editor.view.dispatch(editor.state.tr.insertText("Typed ", 1));
        });
        await settle();
        expect(onSuggestionAnchorsChange).toHaveBeenCalledTimes(reports);
      },
    );

    it.each([
      ["a saved", {}, false],
      ["a settling", { presentation: "settling" }, true],
      ["a frozen", { frozen: true }, true],
    ] as const)(
      "with comment indicators hidden, draws %s suggestion's words: %s",
      async (_kind, state, drawn) => {
        await act(async () =>
          render(BEFORE, [], "seed", false, {
            suggestions: [{ ...suggestion, ...state }],
          }),
        );
        await settle();
        expect(container.textContent.includes("at 2 pm")).toBe(drawn);
      },
    );

    it("leaves the words being typed out of the suggestions it reports placed", async () => {
      const onSuggestionAnchorsChange = vi.fn();
      const unplaced: VisualEditorSuggestion = {
        ...suggestion,
        id: "d1",
        kind: "insert_text",
        beforeText: "",
        afterText: "words the page has yet to show",
        presentation: "draft",
      };
      const props = { suggesting: true, onSuggestionAnchorsChange };
      await act(async () =>
        render(BEFORE, [], "seed", true, {
          ...props,
          suggestions: [suggestion],
        }),
      );
      await settle();
      const editor = found(captured.editor);
      act(() => {
        editor.view.dispatch(editor.state.tr.insertText("Typed ", 1));
      });
      await act(async () =>
        render(BEFORE, [], "seed", true, {
          ...props,
          suggestions: [suggestion, unplaced],
        }),
      );
      await settle();
      expect(container.textContent).toContain("Typed ");
      expect(onSuggestionAnchorsChange).toHaveBeenLastCalledWith(["s1"]);
    });
  });

  describe("/page", () => {
    async function makePage(answer: boolean | "failed") {
      pages.create.mockClear();
      pages.rollback.mockClear();
      const onSaveContent = vi.fn(async (_markdown: string) => answer);
      await act(async () =>
        render(BEFORE, [], "seed", true, {
          documentId: "parent",
          onSaveContent,
        }),
      );
      await settle();
      const editor = found(captured.editor);
      act(() => {
        editor.chain().focus("end").splitBlock().run();
        for (const char of "/page") {
          const { from, to } = editor.state.selection;
          editor.view.dispatch(editor.state.tr.insertText(char, from, to));
        }
      });
      await settle();
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await act(async () =>
        vi.waitFor(() => expect(onSaveContent).toHaveBeenCalledOnce()),
      );
      const pageId = found(pages.create.mock.calls[0]?.[1]);
      expect(pages.create).toHaveBeenCalledWith("parent", pageId);
      expect(onSaveContent.mock.calls[0]?.[0]).toContain(`id="${pageId}"`);
      return { linked: () => editor.getHTML().includes(pageId), pageId };
    }

    it("saves the new page's link through the page's save", async () => {
      const { linked } = await makePage(true);
      expect(linked()).toBe(true);
      expect(pages.rollback).not.toHaveBeenCalled();
    });

    it("takes the new page back when the page's save fails", async () => {
      const { linked, pageId } = await makePage("failed");
      await act(async () =>
        vi.waitFor(() =>
          expect(pages.rollback).toHaveBeenCalledWith({
            id: pageId,
            parentId: "parent",
          }),
        ),
      );
      expect(linked()).toBe(false);
    });
  });

  it("keeps a highlight on its copy when edits make its context match another", async () => {
    const t1 = { ...thread("t1", "beta"), prefix: "Gamma ", suffix: "." };
    await act(async () => render("Alpha beta. Gamma beta.", [t1]));
    await settle();
    const editor = (
      container.querySelector(".ProseMirror") as HTMLElement & {
        editor: Editor;
      }
    ).editor;
    const start = () =>
      commentHighlightKey
        .getState(editor.state)!
        .specs.find((spec) => spec.threadId === "t1")?.from;
    expect(start()).toBe(19);

    // The text before the second copy no longer reads "Gamma"; the first's does.
    await act(async () => {
      editor.commands.insertContentAt({ from: 13, to: 18 }, "Delta");
      editor.commands.insertContentAt({ from: 1, to: 6 }, "Gamma");
    });
    expect(start()).toBe(19);

    // The edits are saved and come back as the document's content.
    await act(async () => render("Gamma beta. Delta beta.", [t1]));
    await settle();

    expect(start()).toBe(19);
  });

  it("keeps a thread's highlight on its copy when another thread changes", async () => {
    const quoteOnly = (threadId: string, quotedText: string) => ({
      ...thread(threadId, quotedText),
      prefix: null,
      suffix: null,
      startOffset: null,
    });
    await act(async () => render("Alpha beta.", [quoteOnly("t1", "beta")]));
    await settle();
    const editor = (
      container.querySelector(".ProseMirror") as HTMLElement & {
        editor: Editor;
      }
    ).editor;
    // A copy typed ahead of the quoted word does not take its highlight.
    await act(async () => {
      editor.commands.insertContentAt(1, "beta ");
    });
    const start = () =>
      commentHighlightKey
        .getState(editor.state)!
        .specs.find((spec) => spec.threadId === "t1")?.from;
    expect(start()).toBe(12);

    await act(async () =>
      render("Alpha beta.", [
        quoteOnly("t1", "beta"),
        quoteOnly("t2", "Alpha"),
      ]),
    );
    await settle();

    expect(start()).toBe(12);
  });

  describe("threads on a video", () => {
    const VIDEO = "https://example.com/demo.mp4";
    const onVideo = (threadId: string, blockId: string): CommentThread => ({
      ...thread(threadId, ""),
      quotedText: null,
      block: { blockId, blockType: "video" },
    });
    // How a comment on a video was saved before videos had ids.
    const legacy = (threadId: string): CommentThread =>
      thread(threadId, "Video");
    const marked = (threadId: string) =>
      container.querySelector<HTMLElement>(
        `[data-comment-block-threads~="${threadId}"]`,
      );

    it("marks the video the thread is anchored to", async () => {
      await act(async () =>
        render(
          `Intro.\n<video src="${VIDEO}" id="video-demo0001"></video>\nAfter.`,
          [onVideo("v1", "video-demo0001")],
        ),
      );
      await settle();
      const element = marked("v1");
      expect(element?.querySelector("video")).not.toBeNull();
      expect(element?.className).toContain("comment-highlight--block");
    });

    it("opens a video's thread when the video is clicked, keeping the open one", async () => {
      const onActivateThread = vi.fn();
      const content = `Intro.\n<video src="${VIDEO}" id="video-demo0001"></video>`;
      const threads = [
        onVideo("v1", "video-demo0001"),
        onVideo("v2", "video-demo0001"),
      ];
      await act(async () =>
        render(content, threads, "seed", true, { onActivateThread }),
      );
      await settle();
      await act(async () =>
        found(found(marked("v1")).querySelector("video")).click(),
      );
      expect(onActivateThread).toHaveBeenLastCalledWith("v1");

      await act(async () =>
        render(content, threads, "seed", true, {
          onActivateThread,
          activeThreadId: "v2",
        }),
      );
      await settle();
      await act(async () =>
        found(found(marked("v2")).querySelector("video")).click(),
      );
      expect(onActivateThread).toHaveBeenLastCalledWith("v2");
    });

    it("writes down the id a new comment names on a video saved without one", async () => {
      const onBlockComment = vi.fn();
      await act(async () =>
        render(
          `Intro.
<video src="${VIDEO}"></video>`,
          [],
          "seed",
          true,
          {
            onBlockComment,
          },
        ),
      );
      await settle();
      const button = container.querySelector<HTMLButtonElement>(
        '[aria-label="editor.media.commentOnVideo"]',
      );
      await act(async () => found(button).click());

      const derived = derivedVideoBlockId(VIDEO, 0);
      expect(onBlockComment).toHaveBeenCalledWith(
        expect.objectContaining({ blockId: derived, blockType: "video" }),
        expect.any(Number),
      );
      const editor = (
        container.querySelector(".ProseMirror") as HTMLElement & {
          editor: Editor;
        }
      ).editor;
      const ids: unknown[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "video") ids.push(node.attrs.blockId);
      });
      expect(ids).toEqual([derived]);
    });

    it("lets a reader who can comment but not edit comment on a video, by the id it goes by", async () => {
      const onBlockComment = vi.fn();
      const content = `Intro.\n<video src="${VIDEO}" id="video-saved001"></video>\n<video src="${VIDEO}"></video>`;
      await act(async () =>
        render(content, [], "seed", true, { editable: false, onBlockComment }),
      );
      await settle();
      expect(
        container.querySelector(
          '[aria-label="editor.media.resizeVideoFromLeft"]',
        ),
        "no media-edit controls",
      ).toBeNull();
      const buttons = container.querySelectorAll<HTMLButtonElement>(
        '[aria-label="editor.media.commentOnVideo"]',
      );
      expect(buttons).toHaveLength(2);
      await act(async () => found(buttons[0]).click());
      await act(async () => found(buttons[1]).click());

      expect(onBlockComment.mock.calls.map(([target]) => target)).toEqual([
        expect.objectContaining({ blockId: "video-saved001" }),
        expect.objectContaining({ blockId: derivedVideoBlockId(VIDEO, 1) }),
      ]);
      const editor = (
        container.querySelector(".ProseMirror") as HTMLElement & {
          editor: Editor;
        }
      ).editor;
      const ids: unknown[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "video") ids.push(node.attrs.blockId);
      });
      expect(ids, "a tab that can't edit writes no id").toEqual([
        "video-saved001",
        null,
      ]);
    });

    it("shows a reader who can't edit no Comment button on a video that goes by no id", async () => {
      const onBlockComment = vi.fn();
      const derived = derivedVideoBlockId(VIDEO, 0);
      const shared = `<video src="https://example.com/other.mp4" id="video-shared01"></video>`;
      await act(async () =>
        render(
          [
            "Intro.",
            `<video src="${VIDEO}"></video>`,
            `<video src="${VIDEO}" id="${derived}"></video>`,
            shared,
            shared,
          ].join("\n"),
          [],
          "seed",
          true,
          { editable: false, onBlockComment },
        ),
      );
      await settle();
      const buttons = [
        ...container.querySelectorAll<HTMLElement>(".ProseMirror video"),
      ].map((video) =>
        video
          .closest(".media-block")
          ?.querySelector<HTMLButtonElement>(
            '[aria-label="editor.media.commentOnVideo"]',
          ),
      );
      expect(
        buttons.map((button) => !!button),
        "only the video with an id of its own",
      ).toEqual([false, true, false, false]);
      await act(async () => found(buttons[1]).click());
      expect(onBlockComment.mock.calls.map(([target]) => target)).toEqual([
        expect.objectContaining({ blockId: derived }),
      ]);
    });

    it("shows no Comment button on a video to a reader who can't comment", async () => {
      await act(async () =>
        render(`Intro.\n<video src="${VIDEO}"></video>`, [], "seed", true, {
          editable: false,
        }),
      );
      await settle();
      expect(
        container.querySelector('[aria-label="editor.media.commentOnVideo"]'),
      ).toBeNull();
    });

    it("gives a video an id of its own before a comment on it, when another video shares its id", async () => {
      const onBlockComment = vi.fn();
      const shared = `<video src="${VIDEO}" id="video-shared01"></video>`;
      await act(async () =>
        render(
          `Intro.\n${shared}\n${shared}`,
          [onVideo("old", "video-shared01")],
          "seed",
          true,
          {
            onBlockComment,
          },
        ),
      );
      await settle();
      expect(marked("old"), "on neither video").toBeNull();

      const buttons = container.querySelectorAll<HTMLButtonElement>(
        '[aria-label="editor.media.commentOnVideo"]',
      );
      await act(async () => found(buttons[1]).click());

      const editor = (
        container.querySelector(".ProseMirror") as HTMLElement & {
          editor: Editor;
        }
      ).editor;
      const ids: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "video") ids.push(node.attrs.blockId);
      });
      expect(ids[0]).toBe("video-shared01");
      expect(ids[1]).toMatch(/^video-/);
      expect(ids[1]).not.toBe("video-shared01");
      expect(onBlockComment).toHaveBeenCalledWith(
        expect.objectContaining({ blockId: ids[1], blockType: "video" }),
        expect.any(Number),
      );
    });

    describe("while two videos share the thread's id", () => {
      const ORIGINAL = `<video src="${VIDEO}" id="video-demo0001"></video>`;
      const open = async () => {
        await act(async () =>
          render(
            `Intro.
${ORIGINAL}
After.`,
            [onVideo("v1", "video-demo0001")],
          ),
        );
        await settle();
        return (
          container.querySelector(".ProseMirror") as HTMLElement & {
            editor: Editor;
          }
        ).editor;
      };
      const videos = (editor: Editor) => {
        const videos: { pos: number; id: string }[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "video")
            videos.push({ pos, id: node.attrs.blockId });
        });
        return videos;
      };
      const fromElsewhere = (
        editor: Editor,
        change: (tr: Editor["state"]["tr"]) => unknown,
      ) =>
        act(async () => {
          const tr = editor.state.tr;
          change(tr);
          editor.view.dispatch(
            tr.setMeta(ySyncPluginKey, { isChangeOrigin: true }),
          );
        });

      it("marks neither video after another tab's copy, and the original again once the copy goes", async () => {
        const editor = await open();
        const original = found(videos(editor)[0]);
        const node = found(editor.state.doc.nodeAt(original.pos));
        await fromElsewhere(editor, (tr) =>
          tr.insert(original.pos + node.nodeSize, node),
        );
        await settle();
        expect(videos(editor).map((video) => video.id)).toEqual([
          "video-demo0001",
          "video-demo0001",
        ]);
        expect(marked("v1"), "on neither video").toBeNull();

        const copy = found(videos(editor)[1]);
        await fromElsewhere(editor, (tr) =>
          tr.delete(copy.pos, copy.pos + node.nodeSize),
        );
        await settle();
        expect(marked("v1")?.querySelector("video")).not.toBeNull();
      });

      it("keeps the mark on the original through this tab's paste of a copy", async () => {
        const editor = await open();
        const original = found(videos(editor)[0]);
        const node = found(editor.state.doc.nodeAt(original.pos));
        const rendered: boolean[] = [];
        const updateState = editor.view.updateState.bind(editor.view);
        vi.spyOn(editor.view, "updateState").mockImplementation((state) => {
          rendered.push(
            found(commentHighlightKey.getState(state)).decorations.find()
              .length > 0,
          );
          updateState(state);
        });
        await act(async () => {
          editor.view.dispatch(
            editor.state.tr.insert(original.pos + node.nodeSize, node),
          );
        });
        await settle();

        const list = videos(editor);
        const kept = found(list[0]);
        const pasted = found(list[1]);
        expect(kept.id).toBe("video-demo0001");
        expect(pasted.id).not.toBe("video-demo0001");
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered, "no state without the mark").not.toContain(false);
        expect(marked("v1")?.querySelector("video"), "on the original").toBe(
          container.querySelectorAll("video")[0],
        );
      });
    });

    it("anchors an old video comment to the page's only video", async () => {
      await act(async () =>
        render(`Video notes.\n<video src="${VIDEO}"></video>`, [legacy("old")]),
      );
      await settle();
      expect(marked("old")?.querySelector("video")).not.toBeNull();
    });

    it("leaves an old video comment as it was when the page has two videos", async () => {
      await act(async () =>
        render(
          `Video notes.\n<video src="${VIDEO}"></video>\n<video src="${VIDEO}"></video>`,
          [legacy("old")],
        ),
      );
      await settle();
      expect(highlighted("old")).toBe("Video");
    });
  });

  describe("threads on an image or audio clip", () => {
    const PNG = "https://example.com/demo.png";
    const MP3 = "https://example.com/demo.mp3";
    const IMAGE_ID = derivedCommentAnchorBlockId("image", PNG, 0);
    const editorOf = () =>
      (
        container.querySelector(".ProseMirror") as HTMLElement & {
          editor: Editor;
        }
      ).editor;
    const savedIds = () => {
      const ids: unknown[] = [];
      editorOf().state.doc.descendants((node) => {
        if (node.type.name === "image" || node.type.name === "audio")
          ids.push(node.attrs.blockId);
      });
      return ids;
    };

    it("starts a thread on the whole image by the id its file gives it, writing nothing", async () => {
      const onBlockComment = vi.fn();
      const onChange = vi.fn();
      await act(async () =>
        render(
          `Intro.
![A painting](${PNG})
After.`,
          [],
          "seed",
          true,
          {
            onBlockComment,
            onChange,
          },
        ),
      );
      await settle();
      onChange.mockClear();
      const button = container.querySelector<HTMLButtonElement>(
        '[aria-label="editor.media.commentOnImage"]',
      );
      await act(async () => found(button).click());
      await settle();

      expect(onBlockComment).toHaveBeenCalledWith(
        expect.objectContaining({ blockId: IMAGE_ID, blockType: "image" }),
        expect.any(Number),
      );
      expect(savedIds()).toEqual([undefined]);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("starts a thread on a second copy of a file by that copy's id", async () => {
      const onBlockComment = vi.fn();
      await act(async () =>
        render(
          `![](${PNG})
Between.
![](${PNG})`,
          [],
          "seed",
          true,
          {
            onBlockComment,
          },
        ),
      );
      await settle();
      const buttons = container.querySelectorAll<HTMLButtonElement>(
        '[aria-label="editor.media.commentOnImage"]',
      );
      await act(async () => found(buttons[1]).click());

      expect(onBlockComment).toHaveBeenCalledWith(
        expect.objectContaining({
          blockId: derivedCommentAnchorBlockId("image", PNG, 1),
          blockType: "image",
        }),
        expect.any(Number),
      );
    });

    it("starts a thread on the whole audio clip", async () => {
      const onBlockComment = vi.fn();
      await act(async () =>
        render(
          `Intro.
<audio src="${MP3}"></audio>`,
          [],
          "seed",
          true,
          {
            onBlockComment,
          },
        ),
      );
      await settle();
      const button = container.querySelector<HTMLButtonElement>(
        '[aria-label="editor.media.commentOnAudio"]',
      );
      await act(async () => found(button).click());

      expect(onBlockComment).toHaveBeenCalledWith(
        expect.objectContaining({
          blockId: derivedCommentAnchorBlockId("audio", MP3, 0),
          blockType: "audio",
        }),
        expect.any(Number),
      );
      expect(savedIds()).toEqual([undefined]);
    });

    it("marks the image a thread is on", async () => {
      await act(async () =>
        render(
          `Intro.
![A painting](${PNG})`,
          [
            {
              ...thread("i1", ""),
              quotedText: null,
              block: { blockId: IMAGE_ID, blockType: "image" },
            },
          ],
        ),
      );
      await settle();
      const element = container.querySelector<HTMLElement>(
        '[data-comment-block-threads~="i1"]',
      );
      expect(element?.querySelector("img")).not.toBeNull();
      expect(element?.className).toContain("comment-highlight--block");
    });

    it("shows no Comment button on an image where threads can't start on blocks", async () => {
      await act(async () => render(`![A painting](${PNG})`, []));
      await settle();
      expect(
        container.querySelector('[aria-label="editor.media.commentOnImage"]'),
      ).toBeNull();
    });
  });
});
