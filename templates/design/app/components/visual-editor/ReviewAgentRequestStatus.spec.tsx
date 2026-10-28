// @vitest-environment happy-dom

import type { ReviewComment } from "@agent-native/core/review";
import type { ReviewAgentStatus } from "@shared/review-agent";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REVIEW_AGENT_FRESH_RESULT_WINDOW_MS } from "@/lib/review-agent/review-agent-status";
import {
  makePendingSession,
  makeReviewAgentRequest,
} from "@/lib/review-agent/test-review-agent-request";

import { ReviewAgentRequestStatus } from "./ReviewAgentRequestStatus";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { agent?: string }) =>
    values?.agent ? `${key}|${values.agent}` : key,
}));

// Radix opens a tooltip on hover or focus-visible, neither of which happens here.
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span data-test-tooltip>{children}</span>
  ),
}));

const root: ReviewComment = {
  id: "comment-1",
  resourceType: "design",
  resourceId: "design-1",
  threadId: "thread-1",
  parentCommentId: null,
  targetId: "screen-1",
  kind: "comment",
  status: "open",
  anchor: null,
  body: "Make it bigger",
  authorEmail: "sam@example.com",
  authorName: "Sam",
  createdBy: "human",
  resolutionTarget: "human",
  mentions: [],
  ownerEmail: null,
  orgId: null,
  visibility: "private",
  resolvedBy: null,
  resolvedAt: null,
  consumedAt: null,
  deletedBy: null,
  deletedAt: null,
  createdAt: "2026-10-27T11:00:00.000Z",
  updatedAt: "2026-10-27T11:00:00.000Z",
  metadata: null,
};
const thread = { root, replies: [] };

describe("ReviewAgentRequestStatus", () => {
  let container: HTMLDivElement;
  let reactRoot: Root;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    reactRoot = createRoot(container);
  });

  afterEach(() => {
    act(() => reactRoot.unmount());
    container.remove();
    vi.useRealTimers();
  });

  const render = async (
    props: Partial<React.ComponentProps<typeof ReviewAgentRequestStatus>> = {},
  ) => {
    await act(async () => {
      reactRoot.render(
        <ReviewAgentRequestStatus
          className={undefined}
          request={makeReviewAgentRequest({
            updatedAt: new Date(Date.now() - 5_000).toISOString(),
          })}
          thread={thread}
          {...props}
        />,
      );
    });
  };
  const row = () =>
    container.querySelector<HTMLElement>("[data-review-agent-status]");
  const buttons = () =>
    Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
  const fresh = (status: ReviewAgentStatus, ageMs = 5_000) =>
    makeReviewAgentRequest({
      status,
      updatedAt: new Date(Date.now() - ageMs).toISOString(),
    });

  it("names the model in a working status with a spinner, Open chat and Cancel", async () => {
    await render({
      request: fresh("running"),
      onStop: vi.fn(),
      onOpen: vi.fn(),
    });
    expect(row()?.getAttribute("role")).toBe("status");
    expect(row()?.getAttribute("data-review-agent-status")).toBe("running");
    expect(row()?.textContent).toContain(
      "review.agent.working|Claude Sonnet 5.5",
    );
    expect(buttons()).toEqual(["review.agent.openChat", "review.agent.cancel"]);
  });

  it("falls back to the generic name when no model is known", async () => {
    await render({
      request: makeReviewAgentRequest({
        model: null,
        submitted: null,
        updatedAt: new Date(Date.now() - 5_000).toISOString(),
      }),
    });
    expect(row()?.textContent).toContain(
      "review.agent.working|review.agent.fallbackName",
    );
  });

  it("offers only Cancel while queued", async () => {
    await render({
      request: fresh("queued"),
      onStop: vi.fn(),
      onOpen: vi.fn(),
    });
    expect(row()?.textContent).toContain("review.agent.queued|");
    expect(buttons()).toEqual(["review.agent.cancel"]);
  });

  it("calls back with the request when a button is pressed", async () => {
    const request = fresh("failed");
    const onStop = vi.fn();
    const onOpen = vi.fn();
    const onRetry = vi.fn();
    await render({ request, onStop, onOpen, onRetry });
    const press = (label: string) =>
      act(async () =>
        Array.from(container.querySelectorAll("button"))
          .find((b) => b.textContent === label)
          ?.click(),
      );
    await press("review.agent.retry");
    await press("review.agent.openChat");
    expect(onRetry).toHaveBeenCalledExactlyOnceWith(request);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(request);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("disables Cancel while the stop is in flight", async () => {
    await render({
      request: fresh("running"),
      onStop: vi.fn(),
      stopping: true,
    });
    const cancel = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "review.agent.cancel",
    );
    expect(cancel?.disabled).toBe(true);
  });

  it("shows a stopped run with no agent name and no buttons", async () => {
    await render({ request: fresh("cancelled"), onOpen: vi.fn() });
    expect(row()?.textContent).toBe("review.agent.cancelled");
    expect(buttons()).toEqual([]);
  });

  it("gives someone else's active run the label and no buttons", async () => {
    await render({
      request: makeReviewAgentRequest({
        requesterIsMe: false,
        agentThreadId: null,
        agentTurnId: null,
        updatedAt: new Date(Date.now() - 5_000).toISOString(),
      }),
      onStop: vi.fn(),
      onOpen: vi.fn(),
    });
    expect(row()?.textContent).toContain("review.agent.working");
    expect(buttons()).toEqual([]);
  });

  it("explains a failure in a tooltip, not in visible text", async () => {
    await render({
      request: makeReviewAgentRequest({
        status: "failed",
        errorCode: "engine_not_configured",
        updatedAt: new Date(Date.now() - 5_000).toISOString(),
      }),
    });
    expect(container.querySelector("[data-test-tooltip]")?.textContent).toBe(
      "review.agent.error.engineNotConfigured",
    );
    expect(row()?.querySelector("[tabindex='0']")?.textContent).toContain(
      "review.agent.failed",
    );
  });

  it("adds no tooltip to a status that has no error", async () => {
    await render({ request: fresh("replied") });
    expect(container.querySelector("[data-test-tooltip]")).toBeNull();
  });

  it("shows a starting run at once, before any request exists", async () => {
    await render({
      request: undefined,
      starting: true,
      startingAgentName: "Claude Sonnet 5.5",
    });
    expect(row()?.getAttribute("data-review-agent-status")).toBe("starting");
    expect(row()?.textContent).toContain(
      "review.agent.working|Claude Sonnet 5.5",
    );
    expect(buttons()).toEqual([]);
  });

  it("lets a starting run take over from the failed one it replaces", async () => {
    await render({
      request: fresh("failed"),
      starting: true,
      onRetry: vi.fn(),
    });
    expect(row()?.getAttribute("data-review-agent-status")).toBe("starting");
    expect(buttons()).toEqual([]);
  });

  it("renders nothing without a request, or once a finished run's window has passed", async () => {
    await render({ request: undefined });
    expect(row()).toBeNull();
    await render({
      request: fresh("replied", REVIEW_AGENT_FRESH_RESULT_WINDOW_MS + 1_000),
    });
    expect(row()).toBeNull();
  });

  it("removes a finished run's status when its fresh window ends", async () => {
    await render({ request: fresh("applied", 30_000) });
    expect(row()?.textContent).toContain("review.agent.applied");
    await act(async () => {
      vi.advanceTimersByTime(
        REVIEW_AGENT_FRESH_RESULT_WINDOW_MS - 30_000 + 100,
      );
    });
    expect(row()).toBeNull();
  });

  it("hides a needs-input status once a person replies after it", async () => {
    const request = makeReviewAgentRequest({
      status: "needs-input",
      updatedAt: "2026-10-27T11:30:00.000Z",
    });
    await render({ request });
    expect(row()?.textContent).toContain("review.agent.needsInput");
    await render({
      request,
      thread: {
        root,
        replies: [
          {
            ...root,
            id: "reply-1",
            parentCommentId: root.id,
            createdAt: "2026-10-27T11:45:00.000Z",
          },
        ],
      },
    });
    expect(row()).toBeNull();
  });

  it("keeps the pending-session classifier's chat reachable while classifying", async () => {
    const onOpen = vi.fn();
    const request = makeReviewAgentRequest({
      status: "classifying",
      agentThreadId: null,
      agentTurnId: null,
      pendingSession: makePendingSession({
        phase: "classification",
        threadId: "classifier-thread",
      }),
      updatedAt: new Date(Date.now() - 5_000).toISOString(),
    });
    await render({ request, onOpen });
    expect(buttons()).toContain("review.agent.openChat");
  });
});
