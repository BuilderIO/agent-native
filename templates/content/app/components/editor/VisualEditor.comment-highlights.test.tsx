// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
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
});
