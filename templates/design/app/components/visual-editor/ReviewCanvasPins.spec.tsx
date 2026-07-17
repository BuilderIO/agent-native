// @vitest-environment happy-dom

import type { ReviewComment } from "@agent-native/core/review";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMutate: vi.fn(),
  replyMutate: vi.fn(),
  resolveMutate: vi.fn(),
  callAction: vi.fn().mockResolvedValue({ cancelled: true }),
  setClientAppState: vi.fn().mockResolvedValue(undefined),
  sendToAgent: vi.fn().mockResolvedValue({ delivered: true }),
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
  callAction: mocks.callAction,
  buildReviewThreads: (comments: ReviewComment[]) =>
    comments.map((root) => ({ root, replies: [] })),
  ReviewCommentComposer: (props: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (target: "human" | "agent") => void;
    showAgentAction?: boolean;
    commentLabel?: string;
    contextLabel?: string;
    agentAction?: React.ReactNode;
  }) => (
    <div>
      {props.contextLabel ? <span>{props.contextLabel}</span> : null}
      <button
        type="button"
        data-review-test-type
        onClick={() => props.onChange("Make the background darker")}
      />
      <button
        type="button"
        data-review-test-question
        onClick={() => props.onChange("What is this section for?")}
      />
      <button
        type="button"
        data-review-test-submit
        onClick={() => props.onSubmit("human")}
      >
        {props.commentLabel}
      </button>
      {props.showAgentAction
        ? (props.agentAction ?? (
            <button type="button" data-review-test-agent-action />
          ))
        : null}
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
  setClientAppState: mocks.setClientAppState,
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChatAndConfirm: mocks.sendToAgent,
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
    mocks.callAction.mockClear();
    mocks.setClientAppState.mockClear();
    mocks.sendToAgent.mockClear();
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
    expect(document.body.textContent).not.toContain("review.clickToPin");
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
      body: "Make the background darker",
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
          onDispatchCommentToAgent={vi.fn()}
          sourceVersionHash="hash-1"
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
    expect(document.body.textContent).toContain("review.sendToAgent");
    expect(document.body.textContent).toContain(
      "designEditor.nodeRewrite.willPreview",
    );
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

  it("anchors to a bridge-resolved layer selector instead of the body", async () => {
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
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            type: "agent-native:review-anchor-at-point-result",
            correlationId: bridgeRequest?.correlationId,
            targetSelector: "body > main > section:nth-of-type(2)",
            layerName: "Features",
            tagName: "section",
          },
        }),
      );
    });
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

    expect(mocks.createMutate.mock.calls[0]?.[0]).toMatchObject({
      anchor: {
        selector: "body > main > section:nth-of-type(2)",
        point: { xPct: 50, yPct: 50 },
      },
      metadata: {
        targetSelector: "body > main > section:nth-of-type(2)",
        layerName: "Features",
        tagName: "section",
      },
    });
  });

  it("opens a pre-anchored regenerate draft without creating a review comment", async () => {
    const onClose = vi.fn();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    const iframeDocument = document.implementation.createHTMLDocument();
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: iframeDocument,
    });
    iframeDocument.body.innerHTML =
      '<section data-agent-native-node-id="hero">Hero</section>';
    iframe.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(iframe, "clientWidth", { value: 800 });
    Object.defineProperty(iframe, "clientHeight", { value: 600 });
    canvas.appendChild(iframe);

    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active
          onClose={onClose}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          canPost
          canResolve
          sourceType="inline"
          sourceVersionHash="hash-1"
          repromptDraftRequest={{
            nonce: 1,
            fileId: "screen-1",
            target: {
              nodeId: "hero",
              selector: '[data-agent-native-node-id="hero"]',
            },
            point: { xPct: 50, yPct: 40 },
          }}
        />,
      );
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-type]")
        ?.click();
    });
    const send = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) =>
      button.textContent?.includes("designEditor.nodeRewrite.modeRegenerate"),
    );
    expect(document.body.textContent).toContain(
      "designEditor.nodeRewrite.willPreview",
    );
    expect(document.body.textContent).toContain("review.commentMode");
    expect(document.body.textContent).not.toContain("review.clickToPin");
    await act(async () => send?.click());

    expect(mocks.createMutate).not.toHaveBeenCalled();
    expect(mocks.setClientAppState).toHaveBeenCalledWith(
      "design-reprompt-pending:design-1:screen-1",
      expect.objectContaining({
        designId: "design-1",
        fileId: "screen-1",
        baseVersionHash: "hash-1",
        instruction: "Make the background darker",
        target: {
          nodeId: "hero",
          selector: '[data-agent-native-node-id="hero"]',
        },
      }),
    );
    expect(mocks.sendToAgent).toHaveBeenCalledTimes(1);
    expect(mocks.sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Make the background darker",
        context: expect.stringContaining("[Reprompt selection]"),
      }),
      { timeoutMs: 10_000 },
    );
    expect(document.querySelector("[data-review-click-plane]")).toBeNull();
    expect(document.body.textContent).not.toContain("review.clickToPin");

    const pinsBeforePreview = document.querySelectorAll("[data-review-pin]");
    const appStateCalls = mocks.setClientAppState.mock.calls;
    const pending = appStateCalls[appStateCalls.length - 1]?.[1] as {
      repromptId?: string;
    };
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("design:node-reprompt-presented", {
          detail: { repromptId: pending.repromptId },
        }),
      );
    });
    expect(document.querySelectorAll("[data-review-pin]")).toHaveLength(
      pinsBeforePreview.length - 1,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("resets composer-local mode when a reprompt replaces an open comment draft", async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    const iframeDocument = document.implementation.createHTMLDocument();
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: iframeDocument,
    });
    iframeDocument.body.innerHTML =
      '<section data-agent-native-node-id="hero">Hero</section>';
    iframe.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(iframe, "clientWidth", { value: 800 });
    Object.defineProperty(iframe, "clientHeight", { value: 600 });
    Object.defineProperty(iframeDocument, "elementFromPoint", {
      configurable: true,
      value: () => iframeDocument.querySelector("[data-agent-native-node-id]"),
    });
    canvas.appendChild(iframe);

    const renderPins = (repromptDraftRequest?: {
      nonce: number;
      fileId: string;
      target: { nodeId: string; selector: string };
    }) => (
      <ReviewCanvasPins
        active
        onClose={vi.fn()}
        canvasSelector=".review-test-canvas"
        resourceType="design"
        resourceId="design-1"
        targetId="screen-1"
        canPost
        canResolve
        sourceType="inline"
        sourceVersionHash="hash-1"
        onDispatchCommentToAgent={vi.fn()}
        repromptDraftRequest={repromptDraftRequest}
      />
    );

    await act(async () => root.render(renderPins()));
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
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-question]")
        ?.click();
    });
    expect(document.body.textContent).toContain(
      "designEditor.nodeRewrite.willAsk",
    );

    await act(async () => {
      root.render(
        renderPins({
          nonce: 2,
          fileId: "screen-1",
          target: {
            nodeId: "hero",
            selector: '[data-agent-native-node-id="hero"]',
          },
        }),
      );
    });

    expect(document.body.textContent).toContain(
      "designEditor.nodeRewrite.willPreview",
    );
    expect(document.body.textContent).toContain(
      "designEditor.nodeRewrite.modeRegenerate",
    );
  });
});
