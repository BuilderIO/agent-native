// @vitest-environment happy-dom

import type { ReviewComment } from "@agent-native/core/review";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMutate: vi.fn(),
  replyMutate: vi.fn(),
  resolveMutate: vi.fn(),
}));

const comment = vi.hoisted(
  () =>
    ({
      id: "comment-1",
      resourceType: "design",
      resourceId: "design-1",
      threadId: "thread-1",
      parentCommentId: null,
      targetId: "screen-1",
      kind: "annotation",
      status: "open",
      anchor: { point: { xPct: 25, yPct: 30 } },
      body: "Keep this popover open",
      authorEmail: "reviewer@example.com",
      authorName: null,
      createdBy: "human",
      resolutionTarget: "human",
      mentions: [],
      ownerEmail: "owner@example.com",
      orgId: null,
      visibility: "private",
      resolvedBy: null,
      resolvedAt: null,
      consumedAt: null,
      deletedBy: null,
      deletedAt: null,
      createdAt: "2026-07-13T13:00:00.000Z",
      updatedAt: "2026-07-13T13:00:00.000Z",
      metadata: null,
    }) satisfies ReviewComment,
);

vi.mock("@agent-native/core/client", () => ({
  buildReviewThreads: (comments: ReviewComment[]) =>
    comments.map((root) => ({ root, replies: [] })),
  ReviewCommentComposer: (props: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (target: "human" | "agent") => void;
    showAgentAction?: boolean;
  }) => (
    <div>
      <button
        type="button"
        data-review-test-type
        onClick={() => props.onChange("Pinned feedback")}
      />
      <button
        type="button"
        data-review-test-submit
        onClick={() => props.onSubmit("human")}
      />
      {props.showAgentAction ? (
        <button type="button" data-review-test-agent-action />
      ) : null}
    </div>
  ),
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  useCreateReviewComment: () => ({
    mutate: mocks.createMutate,
    isPending: false,
  }),
  useReplyReviewComment: () => ({
    mutate: mocks.replyMutate,
    isPending: false,
  }),
  useResolveReviewThread: () => ({
    mutate: mocks.resolveMutate,
    isPending: false,
  }),
  useReviewComments: () => ({ data: { comments: [comment] } }),
  useT: () => (key: string) => key,
}));

import { ReviewCanvasPins } from "./ReviewCanvasPins";

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

describe("ReviewCanvasPins persisted thread popover", () => {
  let container: HTMLDivElement;
  let canvas: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    mocks.createMutate.mockReset();
    mocks.replyMutate.mockReset();
    mocks.resolveMutate.mockReset();
    canvas = document.createElement("div");
    canvas.className = "review-test-canvas";
    canvas.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(canvas);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    canvas.remove();
    vi.unstubAllGlobals();
  });

  it("keeps a clicked persisted thread open outside pin-placement mode", async () => {
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active={false}
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          canPost
          canResolve
        />,
      );
    });

    const pin = document.querySelector<HTMLButtonElement>("[data-review-pin]");
    expect(pin).not.toBeNull();
    await act(async () => pin?.click());

    expect(document.body.textContent).toContain("Keep this popover open");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.body.textContent).not.toContain("Keep this popover open");
  });

  it("moves one empty draft and persists only after feedback is entered", async () => {
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          canPost
          canResolve
        />,
      );
    });

    const clickPlane = document.querySelector<HTMLElement>(
      "[data-review-click-plane]",
    );
    expect(clickPlane).not.toBeNull();
    await act(async () => {
      clickPlane?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 200,
          clientY: 180,
        }),
      );
    });
    await act(async () => {
      clickPlane?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 300,
          clientY: 240,
        }),
      );
    });

    expect(document.querySelectorAll("[data-review-pin]")).toHaveLength(2);
    expect(mocks.createMutate).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-review-test-agent-action]"),
    ).toBeNull();

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-type]")
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-submit]")
        ?.click();
    });

    expect(mocks.createMutate).toHaveBeenCalledTimes(1);
    expect(mocks.createMutate.mock.calls[0]?.[0]).toMatchObject({
      body: "Pinned feedback",
      anchor: { point: { xPct: 37.5, yPct: 40 } },
      resolutionTarget: "human",
    });
  });

  it("shows agent dispatch only when the host provides that capability", async () => {
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          canPost
          canResolve
          onDispatchCommentToAgent={vi.fn()}
        />,
      );
    });

    await act(async () => {
      document
        .querySelector<HTMLElement>("[data-review-click-plane]")
        ?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: 200,
            clientY: 180,
          }),
        );
    });

    expect(
      document.querySelector("[data-review-test-agent-action]"),
    ).not.toBeNull();
  });

  it("enriches opaque iframe clicks with a bridge-resolved node anchor", async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(iframe, "clientWidth", { value: 800 });
    Object.defineProperty(iframe, "clientHeight", { value: 600 });
    canvas.appendChild(iframe);
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, "postMessage", {
      configurable: true,
      value: postMessage,
    });
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          canPost
          canResolve
        />,
      );
    });
    await act(async () => {
      document
        .querySelector<HTMLElement>("[data-review-click-plane]")
        ?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            clientX: 400,
            clientY: 300,
          }),
        );
    });

    const bridgeRequest = postMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .find(
        (message) => message.type === "agent-native:review-anchor-at-point",
      );
    expect(bridgeRequest).toMatchObject({ x: 400, y: 300 });

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            type: "agent-native:review-anchor-at-point-result",
            correlationId: bridgeRequest?.correlationId,
            nodeId: "hero-title",
            layerName: "Hero title",
            tagName: "h1",
          },
        }),
      );
      document
        .querySelector<HTMLButtonElement>("[data-review-test-type]")
        ?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-submit]")
        ?.click();
    });

    expect(mocks.createMutate.mock.calls[0]?.[0]).toMatchObject({
      anchor: {
        nodeId: "hero-title",
        point: { xPct: 50, yPct: 50 },
      },
      metadata: { layerName: "Hero title", tagName: "h1" },
    });
  });
});
