// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

import { VisualEditor } from "./VisualEditor";

const BEFORE = "Intro.\nThe team ships every Friday afternoon, so it lands.";
const AFTER = "Intro.\nThe team ships every Friday at 2 pm, so it lands.";

function thread(threadId: string): CommentThread {
  return {
    threadId,
    quotedText: "ships every Friday afternoon",
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
  });
});
