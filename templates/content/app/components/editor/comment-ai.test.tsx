// @vitest-environment happy-dom

import type { CommentAiRequest } from "@shared/comment-ai";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  commentAiRequestsRefetchInterval,
  CommentAiThreadActions,
  type CommentAiController,
  useCommentAiRequests,
} from "./comment-ai";

const api = vi.hoisted(() => ({
  callAction: vi.fn(),
  refetch: vi.fn(),
  sendToAgentChat: vi.fn(),
  requests: [] as CommentAiRequest[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => api.callAction(...args),
  useActionQuery: () => ({
    data: { requests: api.requests },
    refetch: api.refetch,
  }),
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: (...args: unknown[]) => api.sendToAgentChat(...args),
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

function request(overrides: Partial<CommentAiRequest> = {}): CommentAiRequest {
  return {
    requestId: "request-1",
    documentId: "document-1",
    threadId: "thread-1",
    rootCommentId: "comment-1",
    intent: "suggest",
    status: "failed",
    runId: null,
    agentThreadId: null,
    result: null,
    error: "The request failed",
    createdAt: "2026-09-08T12:00:00.000Z",
    updatedAt: "2026-09-08T12:00:00.000Z",
    ...overrides,
  };
}

describe("comment AI controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    api.requests = [];
    api.refetch.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function renderControls(
    props: Partial<Parameters<typeof CommentAiThreadActions>[0]> = {},
  ) {
    const onStart = vi.fn().mockResolvedValue(undefined);
    act(() =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            "div",
            null,
            createElement("textarea", { defaultValue: "unfinished reply" }),
            createElement(CommentAiThreadActions, {
              "aria-label": "comments.askAi",
              starting: false,
              canSuggest: true,
              canReply: true,
              canApply: true,
              onStart,
              ...props,
            }),
          ),
        ),
      ),
    );
    return onStart;
  }

  async function openMenu(trigger: HTMLButtonElement) {
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
    });
  }

  it("opens and dismisses the ordered menu without dispatching", async () => {
    const onStart = renderControls();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="comments.askAi"]',
    )!;
    await openMenu(trigger);
    const items = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ];
    expect(items.map((item) => item.textContent)).toEqual([
      "comments.aiSuggestChanges",
      "comments.aiReplyInThread",
      "comments.aiApplyAndResolve",
    ]);
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onStart).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")?.value).toBe("unfinished reply");
  });

  it("supports keyboard selection and labels unavailable suggestions", async () => {
    const onStart = renderControls();
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="comments.askAi"]',
    )!;
    await act(async () =>
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    const first = document.querySelector<HTMLElement>("[role=menuitem]")!;
    await act(async () =>
      first.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(onStart).toHaveBeenCalledWith("suggest", undefined);

    act(() => root.unmount());
    root = createRoot(container);
    renderControls({ canSuggest: false });
    await openMenu(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="comments.askAi"]',
      )!,
    );
    expect(document.body.textContent).toContain("comments.aiUnavailable");
  });

  it("shows actionable errors and retries with the same request id", async () => {
    const failed = request();
    const onStart = renderControls({ request: failed });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "comments.aiFailed",
    );
    expect(
      document.querySelector('[role="alert"]')?.getAttribute("title"),
    ).toBe(failed.error);
    await act(async () =>
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "comments.retry")!
        .click(),
    );
    expect(onStart).toHaveBeenCalledWith(failed.intent, failed.requestId);
  });

  it("prevents duplicate starts and sends localized text with hidden scoped context", async () => {
    const requestId = "00000000-0000-4000-8000-000000000001";
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    api.callAction.mockResolvedValue({
      ...request({ status: "queued", error: null }),
      dispatch: true,
      prompt: "Handle the source comment",
      context: "Hidden comment AI instructions",
      actionScope: { kind: "content-comment-ai", requestId },
    });
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(requestId);
    act(() => root.render(createElement(Probe)));

    const input = {
      threadId: "thread-1",
      rootCommentId: "comment-1",
      intent: "suggest" as const,
    };
    await act(async () => {
      await Promise.all([controller!.start(input), controller!.start(input)]);
    });

    expect(api.callAction).toHaveBeenCalledOnce();
    expect(api.callAction).toHaveBeenCalledWith("start-comment-ai-request", {
      documentId: "document-1",
      threadId: "thread-1",
      rootCommentId: "comment-1",
      intent: "suggest",
      requestId,
    });
    expect(api.sendToAgentChat).toHaveBeenCalledWith({
      message: "comments.aiPromptSuggest",
      context: "Hidden comment AI instructions",
      submit: true,
      openSidebar: true,
      actionScope: { kind: "content-comment-ai", requestId },
    });
  });

  it("does not dispatch an active request returned by a racing start", async () => {
    let controller: CommentAiController;
    function Probe() {
      controller = useCommentAiRequests("document-1", { enabled: true });
      return null;
    }
    api.callAction.mockResolvedValue({
      ...request({ status: "running", error: null }),
      dispatch: false,
      prompt: "Reply in thread for this comment.",
      context: "Hidden comment AI instructions",
      actionScope: { kind: "content-comment-ai", requestId: "request-1" },
    });
    act(() => root.render(createElement(Probe)));

    await act(async () => {
      await controller!.start({
        threadId: "thread-1",
        rootCommentId: "comment-1",
        intent: "reply",
      });
    });

    expect(api.callAction).toHaveBeenCalledOnce();
    expect(api.sendToAgentChat).not.toHaveBeenCalled();
    expect(api.refetch).toHaveBeenCalledOnce();
  });

  it("polls only while a saved request is queued or running", () => {
    expect(
      commentAiRequestsRefetchInterval({
        requests: [request({ status: "queued" })],
      }),
    ).toBe(2_000);
    expect(
      commentAiRequestsRefetchInterval({
        requests: [request({ status: "running" })],
      }),
    ).toBe(2_000);
    expect(
      commentAiRequestsRefetchInterval({
        requests: [request({ status: "replied" })],
      }),
    ).toBe(false);
    expect(commentAiRequestsRefetchInterval(undefined)).toBe(false);
  });
});
