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

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import { derivedVideoBlockId } from "@shared/comment-block-anchor";

import { commentHighlightKey } from "./extensions/CommentHighlight";
import { VisualEditor } from "./VisualEditor";

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
      await act(async () => marked("v1")!.querySelector("video")!.click());
      expect(onActivateThread).toHaveBeenLastCalledWith("v1");

      await act(async () =>
        render(content, threads, "seed", true, {
          onActivateThread,
          activeThreadId: "v2",
        }),
      );
      await settle();
      await act(async () => marked("v2")!.querySelector("video")!.click());
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
      await act(async () => button!.click());

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
      await act(async () => buttons[0]!.click());
      await act(async () => buttons[1]!.click());

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
      await act(async () => buttons[1]!.click());
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
      await act(async () => buttons[1]!.click());

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
        const found: { pos: number; id: string }[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "video")
            found.push({ pos, id: node.attrs.blockId });
        });
        return found;
      };
      const fromElsewhere = (editor: Editor, change: (tr: any) => unknown) =>
        act(async () => {
          const tr = editor.state.tr;
          change(tr);
          editor.view.dispatch(
            tr.setMeta(ySyncPluginKey, { isChangeOrigin: true }),
          );
        });

      it("marks neither video after another tab's copy, and the original again once the copy goes", async () => {
        const editor = await open();
        const [original] = videos(editor);
        const node = editor.state.doc.nodeAt(original.pos)!;
        await fromElsewhere(editor, (tr) =>
          tr.insert(original.pos + node.nodeSize, node),
        );
        await settle();
        expect(videos(editor).map((video) => video.id)).toEqual([
          "video-demo0001",
          "video-demo0001",
        ]);
        expect(marked("v1"), "on neither video").toBeNull();

        const copy = videos(editor)[1];
        await fromElsewhere(editor, (tr) =>
          tr.delete(copy.pos, copy.pos + node.nodeSize),
        );
        await settle();
        expect(marked("v1")?.querySelector("video")).not.toBeNull();
      });

      it("keeps the mark on the original through this tab's paste of a copy", async () => {
        const editor = await open();
        const [original] = videos(editor);
        const node = editor.state.doc.nodeAt(original.pos)!;
        const rendered: boolean[] = [];
        const updateState = editor.view.updateState.bind(editor.view);
        vi.spyOn(editor.view, "updateState").mockImplementation((state) => {
          rendered.push(
            commentHighlightKey.getState(state)!.decorations.find().length > 0,
          );
          updateState(state);
        });
        await act(async () => {
          editor.view.dispatch(
            editor.state.tr.insert(original.pos + node.nodeSize, node),
          );
        });
        await settle();

        const [kept, pasted] = videos(editor);
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
});
