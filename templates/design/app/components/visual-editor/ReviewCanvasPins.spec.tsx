// @vitest-environment happy-dom

import type { ReviewComment } from "@agent-native/core/review";
import { act } from "react";
import type { TextareaHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMutate: vi.fn(),
  replyMutate: vi.fn(),
  reactMutate: vi.fn(),
  resolveMutate: vi.fn(),
  unreadMutate: vi.fn(),
  updateMutate: vi.fn(),
  callAction: vi.fn().mockResolvedValue({ cancelled: true }),
  setClientAppState: vi.fn().mockResolvedValue(undefined),
  sendToAgent: vi.fn().mockResolvedValue({ delivered: true }),
  uploadImage: vi.fn().mockResolvedValue({
    src: "https://cdn.example.com/review.png",
  }),
  discussion: {
    reactions: {
      "comment-1": [{ reaction: "👍", count: 2, reactedByMe: true }],
    },
    threadPreferences: {},
    canReact: true,
    canSetThreadPreferences: false,
  },
}));

const comment: ReviewComment = vi.hoisted(
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

let reviewComments: ReviewComment[] = [comment];

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  setClientAppState: mocks.setClientAppState,
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: mocks.uploadImage,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgMembers: () => ({ data: { members: [] } }),
}));

vi.mock("@agent-native/core/client/review", () => ({
  buildReviewThreads: (comments: ReviewComment[]) =>
    comments.map((root) => ({ root, replies: [] })),
  ReviewCommentComposer: (props: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (target: "human" | "agent") => void;
    showCommentAction?: boolean;
    showAgentAction?: boolean;
    commentLabel?: string;
    contextLabel?: string;
    agentAction?: React.ReactNode;
    autoFocus?: boolean;
    disabled?: boolean;
    onEscape?: () => void;
    submitOnEnter?: boolean;
    enterSubmitTarget?: "human" | "agent";
    textareaProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
  }) => {
    const submit = (target: "human" | "agent") => {
      if (!props.value.trim() || props.disabled) return;
      props.onSubmit(target);
    };
    return (
      <div>
        {props.contextLabel ? <span>{props.contextLabel}</span> : null}
        <textarea
          {...props.textareaProps}
          data-review-test-textarea
          autoFocus={props.autoFocus}
          disabled={props.disabled}
          value={props.value}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              props.onEscape?.();
              return;
            }
            if (
              props.submitOnEnter &&
              event.key === "Enter" &&
              !event.shiftKey
            ) {
              event.preventDefault();
              submit(props.enterSubmitTarget ?? "human");
            }
          }}
        />
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
        {props.showCommentAction !== false ? (
          <button
            type="button"
            data-review-test-submit
            aria-label={props.commentLabel}
            disabled={!props.value.trim() || props.disabled}
            onClick={() => submit("human")}
          >
            {props.commentLabel}
          </button>
        ) : null}
        {props.showAgentAction
          ? (props.agentAction ?? (
              <button type="button" data-review-test-agent-action />
            ))
          : null}
      </div>
    );
  },
  useCreateReviewComment: () => ({
    mutate: mocks.createMutate,
    isPending: false,
  }),
  useDeleteReviewComment: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useReplyReviewComment: () => ({
    mutate: mocks.replyMutate,
    isPending: false,
  }),
  useReactToReviewComment: () => ({
    mutate: mocks.reactMutate,
    isPending: false,
    variables: undefined,
  }),
  useResolveReviewThread: () => ({
    mutate: mocks.resolveMutate,
    isPending: false,
  }),
  useSetReviewThreadUnread: () => ({
    mutate: mocks.unreadMutate,
    isPending: false,
  }),
  useUpdateReviewComment: () => ({
    mutate: mocks.updateMutate,
    isPending: false,
  }),
  useReviewComments: () => ({
    data: { comments: reviewComments, discussion: mocks.discussion },
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { count?: number }) =>
    key === "review.commentNumber"
      ? `Review comment ${values?.count ?? ""}`
      : key,
}));

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChatAndConfirm: mocks.sendToAgent,
}));

import {
  materializeBoardReviewAnchor,
  ReviewCanvasPins,
} from "./ReviewCanvasPins";

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
    mocks.reactMutate.mockReset();
    mocks.resolveMutate.mockReset();
    mocks.unreadMutate.mockReset();
    mocks.updateMutate.mockReset();
    mocks.callAction.mockClear();
    mocks.setClientAppState.mockClear();
    mocks.sendToAgent.mockClear();
    mocks.uploadImage.mockReset().mockResolvedValue({
      src: "https://cdn.example.com/review.png",
    });
    mocks.discussion.canReact = true;
    mocks.discussion.canSetThreadPreferences = false;
    mocks.discussion.threadPreferences = {};
    mocks.discussion.reactions = {
      "comment-1": [{ reaction: "👍", count: 2, reactedByMe: true }],
    };
    reviewComments = [comment];
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

  it("portals review chrome outside a transformed canvas owner", async () => {
    container.style.transform = "scale(0.2)";
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

    const reviewChrome = document.querySelector<HTMLElement>(
      "[data-review-popover]",
    );
    expect(reviewChrome).not.toBeNull();
    expect(reviewChrome?.parentElement).toBe(document.body);
  });

  it("marks an unread thread as read when its pin opens", async () => {
    mocks.discussion.canSetThreadPreferences = true;
    mocks.discussion.threadPreferences = {
      "thread-1": { muted: false, unread: true },
    };
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
    expect(
      document
        .querySelector<HTMLButtonElement>("[data-review-pin]")
        ?.getAttribute("data-review-unread"),
    ).toBe("true");
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click();
    });
    expect(mocks.unreadMutate).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", unread: false }),
      expect.any(Object),
    );
    expect(
      document
        .querySelector<HTMLButtonElement>("[data-review-pin]")
        ?.getAttribute("data-review-unread"),
    ).toBeNull();
  });

  it("lets a successful unread mutation reveal refreshed server state", async () => {
    mocks.discussion.canSetThreadPreferences = true;
    mocks.discussion.threadPreferences = {
      "thread-1": { muted: false, unread: true },
    };
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
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click();
    });
    const mutationOptions = mocks.unreadMutate.mock.calls[0]?.[1] as {
      onSuccess?: () => void;
    };
    await act(async () => mutationOptions.onSuccess?.());
    mocks.discussion.threadPreferences = {
      "thread-1": { muted: false, unread: false },
    };
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
    expect(
      document
        .querySelector<HTMLButtonElement>("[data-review-pin]")
        ?.getAttribute("data-review-unread"),
    ).toBeNull();
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
    expect(
      document.querySelector<HTMLTextAreaElement>(
        "[data-review-test-textarea]",
      ),
    ).toBe(document.activeElement);
    expect(
      document.querySelector<HTMLButtonElement>("[data-review-test-submit]")
        ?.disabled,
    ).toBe(true);
    expect(
      document.querySelector("[data-review-attachment-button]"),
    ).toBeNull();
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
    expect(
      document.querySelector("[data-review-attachment-button]"),
    ).not.toBeNull();
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

  it("supports a board-scoped region comment from a drag gesture", async () => {
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId={null}
          boardGeometry={{ x: 0, y: 0, width: 800, height: 600 }}
          canPost
          canResolve
        />,
      );
    });
    const plane = document.querySelector<HTMLElement>(
      "[data-review-click-plane]",
    );
    expect(plane).not.toBeNull();
    await act(async () => {
      plane?.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
        }),
      );
      plane?.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          button: 0,
          clientX: 300,
          clientY: 250,
        }),
      );
      plane?.dispatchEvent(
        new MouseEvent("pointerup", {
          bubbles: true,
          button: 0,
          clientX: 300,
          clientY: 250,
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
      targetId: null,
      anchor: {
        point: { xPct: 25, yPct: expect.any(Number) },
        region: {
          xPct: 12.5,
          yPct: expect.any(Number),
          widthPct: 25,
          heightPct: expect.any(Number),
        },
      },
    });
  });

  it("opens the composer for an overview canvas pin request", async () => {
    const world = document.createElement("div");
    world.setAttribute("data-multi-screen-canvas-world", "");
    world.style.transform = "translate(50px, 25px) scale(2)";
    canvas.appendChild(world);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
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
          showPlacementPlane={false}
          resourceType="design"
          resourceId="design-1"
          targetId={null}
          pinRequest={{ nonce: 1, canvasPoint: { x: -100, y: -150 } }}
          canPost
          canResolve
        />,
      );
    });

    expect(document.querySelector("[data-review-click-plane]")).toBeNull();
    expect(document.querySelector("[data-review-test-submit]")).not.toBeNull();
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
      targetId: null,
      anchor: {
        canvasPoint: { x: -100, y: -150 },
        point: { xPct: 41.25, yPct: (205 / 600) * 100 },
      },
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("keeps a board point fixed when the render window origin shifts", async () => {
    reviewComments = [
      {
        ...comment,
        targetId: null,
        anchor: {
          point: { xPct: 25, yPct: 50 },
          worldPoint: { x: 200, y: 300 },
        },
      },
    ];
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active={false}
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId={null}
          boardGeometry={{ x: 0, y: 0, width: 800, height: 600 }}
          canPost
          canResolve
        />,
      );
    });
    let popover = document.querySelector<HTMLElement>("[data-review-popover]");
    expect(popover?.style.left).toBe("200px");
    expect(popover?.style.top).toBe("300px");

    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active={false}
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId={null}
          boardGeometry={{ x: 100, y: 100, width: 800, height: 600 }}
          canPost
          canResolve
        />,
      );
    });
    popover = document.querySelector<HTMLElement>("[data-review-popover]");
    expect(popover?.style.left).toBe("100px");
    expect(popover?.style.top).toBe("200px");
  });

  it("materializes a legacy board point before the render window shifts", async () => {
    const legacyAnchor = { point: { xPct: 25, yPct: 50 } };
    reviewComments = [
      {
        ...comment,
        canDelete: true,
        targetId: null,
        anchor: legacyAnchor,
      },
    ];
    const firstGeometry = { x: 0, y: 0, width: 800, height: 600 };
    const secondGeometry = { x: 100, y: 100, width: 800, height: 600 };
    expect(materializeBoardReviewAnchor(legacyAnchor, firstGeometry)).toEqual({
      point: { xPct: 25, yPct: 50 },
      worldPoint: { x: 200, y: 300 },
    });
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active={false}
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId={null}
          boardGeometry={firstGeometry}
          canPost
          canResolve
        />,
      );
    });
    expect(mocks.callAction).toHaveBeenCalledWith(
      "update-review-comment",
      expect.objectContaining({
        commentId: "comment-1",
        anchor: {
          point: { xPct: 25, yPct: 50 },
          worldPoint: { x: 200, y: 300 },
        },
      }),
    );
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active={false}
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId={null}
          boardGeometry={secondGeometry}
          canPost
          canResolve
        />,
      );
    });
    const popover = document.querySelector<HTMLElement>(
      "[data-review-popover]",
    );
    expect(popover?.style.left).toBe("100px");
    expect(popover?.style.top).toBe("200px");
  });

  it("retries a failed legacy board-anchor migration after review refresh", async () => {
    const legacyAnchor = { point: { xPct: 25, yPct: 50 } };
    reviewComments = [
      {
        ...comment,
        canDelete: true,
        targetId: null,
        anchor: legacyAnchor,
      },
    ];
    mocks.callAction
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue({});
    const renderBoard = () => (
      <ReviewCanvasPins
        active={false}
        onClose={vi.fn()}
        canvasSelector=".review-test-canvas"
        resourceType="design"
        resourceId="design-1"
        targetId={null}
        boardGeometry={{ x: 0, y: 0, width: 800, height: 600 }}
        canPost
        canResolve
      />
    );

    await act(async () => root.render(renderBoard()));
    expect(mocks.callAction).toHaveBeenCalledTimes(1);

    reviewComments = reviewComments.map((entry) => ({ ...entry }));
    await act(async () => root.render(renderBoard()));
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
  });

  it("drops a failed migration anchor after an external board-anchor update", async () => {
    const legacyAnchor = { point: { xPct: 25, yPct: 50 } };
    reviewComments = [
      {
        ...comment,
        canDelete: true,
        targetId: null,
        anchor: legacyAnchor,
      },
    ];
    mocks.callAction.mockRejectedValueOnce(new Error("temporary failure"));
    const renderBoard = () => (
      <ReviewCanvasPins
        active={false}
        onClose={vi.fn()}
        canvasSelector=".review-test-canvas"
        resourceType="design"
        resourceId="design-1"
        targetId={null}
        boardGeometry={{ x: 0, y: 0, width: 800, height: 600 }}
        canPost
        canResolve
      />
    );

    await act(async () => root.render(renderBoard()));
    expect(mocks.callAction).toHaveBeenCalledTimes(1);

    reviewComments = [
      {
        ...reviewComments[0],
        anchor: {
          point: { xPct: 75, yPct: 25 },
          worldPoint: { x: 600, y: 150 },
        },
      },
    ];
    await act(async () => root.render(renderBoard()));

    const popover = document.querySelector<HTMLElement>(
      "[data-review-popover]",
    );
    expect(popover?.style.left).toBe("600px");
    expect(popover?.style.top).toBe("150px");
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });

  it("waits for board migration permission before marking it complete", async () => {
    reviewComments = [
      {
        ...comment,
        canDelete: true,
        targetId: null,
        anchor: { point: { xPct: 25, yPct: 50 } },
      },
    ];
    const renderBoard = (canPost: boolean) => (
      <ReviewCanvasPins
        active={false}
        onClose={vi.fn()}
        canvasSelector=".review-test-canvas"
        resourceType="design"
        resourceId="design-1"
        targetId={null}
        boardGeometry={{ x: 0, y: 0, width: 800, height: 600 }}
        canPost={canPost}
        canResolve
      />
    );

    await act(async () => root.render(renderBoard(false)));
    expect(mocks.callAction).not.toHaveBeenCalled();

    await act(async () => root.render(renderBoard(true)));
    expect(mocks.callAction).toHaveBeenCalledTimes(1);

    await act(async () => root.render(renderBoard(true)));
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });

  it("requests camera focus and opens an off-window board deep link", async () => {
    const boardAnchor = {
      point: { xPct: 90, yPct: 90 },
      worldPoint: { x: 7200, y: 8100 },
    };
    reviewComments = [{ ...comment, targetId: null, anchor: boardAnchor }];
    const onFocusBoardPoint = vi.fn();
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active={false}
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId={null}
          boardGeometry={{ x: 0, y: 0, width: 800, height: 600 }}
          onFocusBoardPoint={onFocusBoardPoint}
          focusRequest={{
            nonce: 1,
            anchor: boardAnchor,
            targetId: null,
            threadId: "thread-1",
          }}
          canPost
          canResolve
        />,
      );
    });
    expect(onFocusBoardPoint).toHaveBeenCalledWith({ x: 7200, y: 8100 });
    expect(document.body.textContent).toContain("Keep this popover open");
  });

  it("routes a nullable board focus only to the board surface", async () => {
    const boardCanvas = document.createElement("div");
    boardCanvas.id = "board-review-test-canvas";
    boardCanvas.getBoundingClientRect = canvas.getBoundingClientRect;
    document.body.appendChild(boardCanvas);
    reviewComments = [
      {
        ...comment,
        targetId: null,
        anchor: {
          point: { xPct: 90, yPct: 90 },
          worldPoint: { x: 7200, y: 8100 },
        },
      },
    ];
    const onScreenFocus = vi.fn();
    const onBoardFocus = vi.fn();
    try {
      await act(async () => {
        root.render(
          <>
            <ReviewCanvasPins
              active={false}
              onClose={vi.fn()}
              canvasSelector=".review-test-canvas"
              resourceType="design"
              resourceId="design-1"
              targetId="screen-1"
              onFocusBoardPoint={onScreenFocus}
              focusRequest={{
                nonce: 1,
                anchor: {
                  point: { xPct: 90, yPct: 90 },
                  worldPoint: { x: 7200, y: 8100 },
                },
                targetId: null,
                threadId: "thread-1",
              }}
              canPost
              canResolve
            />
            <ReviewCanvasPins
              active={false}
              onClose={vi.fn()}
              canvasSelector="#board-review-test-canvas"
              resourceType="design"
              resourceId="design-1"
              targetId={null}
              boardGeometry={{ x: 0, y: 0, width: 800, height: 600 }}
              onFocusBoardPoint={onBoardFocus}
              focusRequest={{
                nonce: 1,
                anchor: {
                  point: { xPct: 90, yPct: 90 },
                  worldPoint: { x: 7200, y: 8100 },
                },
                targetId: null,
                threadId: "thread-1",
              }}
              canPost
              canResolve
            />
          </>,
        );
      });
      expect(onScreenFocus).not.toHaveBeenCalled();
      expect(onBoardFocus).toHaveBeenCalledWith({ x: 7200, y: 8100 });
    } finally {
      boardCanvas.remove();
    }
  });

  it("keeps pin numbering contiguous when an earlier anchor is malformed", async () => {
    reviewComments = [
      { ...comment, id: "broken", threadId: "broken", anchor: null },
      {
        ...comment,
        id: "comment-2",
        threadId: "thread-2",
        anchor: { point: { xPct: 70, yPct: 70 } },
      },
    ];
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
    expect(
      document
        .querySelector<HTMLButtonElement>("[data-review-pin]")
        ?.getAttribute("aria-label"),
    ).toBe("Review comment 1");
  });

  it("clusters close pins, opens the first thread, and dismisses on outside click", async () => {
    reviewComments = [
      comment,
      {
        ...comment,
        id: "comment-2",
        threadId: "thread-2",
        anchor: { point: { xPct: 26, yPct: 30 } },
      },
    ];
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
    const cluster = document.querySelector<HTMLButtonElement>(
      "[data-review-pin-cluster]",
    );
    expect(cluster).not.toBeNull();
    await act(async () => cluster?.click());
    expect(document.querySelector("[data-review-pin-cluster]")).toBeNull();
    expect(document.body.textContent).toContain("Keep this popover open");
    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(document.body.textContent).not.toContain("Keep this popover open");
  });

  it("persists drag and keyboard relocation for an editable pin", async () => {
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
    await act(async () => {
      pin?.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 200,
          clientY: 180,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 300,
          clientY: 240,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", {
          bubbles: true,
          clientX: 300,
          clientY: 240,
        }),
      );
    });
    expect(mocks.updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: "comment-1",
        anchor: { point: { xPct: 37.5, yPct: 40 } },
      }),
      expect.any(Object),
    );
    mocks.updateMutate.mockClear();
    await act(async () => {
      pin?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(mocks.updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: { point: { xPct: 38.5, yPct: 40 } },
      }),
      expect.any(Object),
    );
  });

  it("keeps Shift+Enter in the draft and caps uploaded image handles at five", async () => {
    mocks.uploadImage.mockImplementation(async (file: File) => ({
      src: `https://cdn.example.com/${file.name}`,
    }));
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
            clientX: 200,
            clientY: 180,
          }),
        );
    });

    const textarea = document.querySelector<HTMLTextAreaElement>(
      "[data-review-test-textarea]",
    );
    expect(textarea).not.toBeNull();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-type]")
        ?.click();
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Enter",
          shiftKey: true,
        }),
      );
    });
    expect(mocks.createMutate).not.toHaveBeenCalled();

    const input = document.querySelector<HTMLInputElement>(
      "[data-review-attachment-input]",
    );
    const files = Array.from(
      { length: 6 },
      (_, index) =>
        new File([`image-${index}`], `image-${index}.png`, {
          type: "image/png",
        }),
    );
    Object.defineProperty(input, "files", {
      configurable: true,
      value: files,
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.uploadImage).toHaveBeenCalledTimes(5);
    expect(document.querySelectorAll("[data-review-attachment]")).toHaveLength(
      5,
    );
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-submit]")
        ?.click();
    });
    const payload = mocks.createMutate.mock.calls[0]?.[0] as {
      metadata?: { attachments?: Array<{ url: string }> };
    };
    expect(payload.metadata?.attachments).toHaveLength(5);
    expect(
      payload.metadata?.attachments?.every(
        ({ url }) => !url.startsWith("data:"),
      ),
    ).toBe(true);
  });

  it("supports replies, reactions, and reopening a resolved thread", async () => {
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
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click();
    });

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-review-reaction="👍"]')
        ?.click();
    });
    expect(mocks.reactMutate.mock.calls[0]?.[0]).toMatchObject({
      commentId: "comment-1",
      reaction: "👍",
      active: false,
    });

    const replyInput = document.querySelector<HTMLTextAreaElement>(
      "[data-review-reply-input]",
    );
    expect(replyInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(replyInput, "A useful reply");
      replyInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const replyButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="review.reply"]',
    );
    expect(replyButton?.disabled).toBe(false);
    await act(async () => replyButton?.click());
    expect(mocks.replyMutate.mock.calls[0]?.[0]).toMatchObject({
      commentId: "comment-1",
      body: "A useful reply",
    });

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("review.resolve"))
        ?.click();
    });
    expect(mocks.resolveMutate.mock.calls[0]?.[0]).toMatchObject({
      threadId: "thread-1",
      status: "resolved",
    });

    reviewComments = [
      {
        ...comment,
        status: "resolved",
        resolvedBy: "reviewer@example.com",
        resolvedAt: "2026-07-13T14:00:00.000Z",
      },
    ];
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
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click();
    });
    const reopen = document.querySelector<HTMLButtonElement>(
      'button[aria-label="review.reopen"]',
    );
    expect(reopen).not.toBeUndefined();
    await act(async () => reopen?.click());
    expect(mocks.resolveMutate.mock.calls[1]?.[0]).toMatchObject({
      threadId: "thread-1",
      status: "open",
    });
  });

  it("hides placement and discussion write affordances in read-only mode", async () => {
    mocks.discussion.canReact = false;
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active={false}
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          canPost={false}
          canResolve={false}
        />,
      );
    });
    expect(document.querySelector("[data-review-click-plane]")).toBeNull();
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click();
    });
    expect(document.querySelector("[data-review-reply-input]")).toBeNull();
    expect(document.querySelector("[data-review-reaction-picker]")).toBeNull();
  });

  it("projects stored canvas pins through camera changes without scaling the marker", async () => {
    const previousAnchor = comment.anchor;
    comment.anchor = {
      point: { xPct: 41.25, yPct: (205 / 600) * 100 },
      canvasPoint: { x: -100, y: -150 },
    } as ReviewComment["anchor"];
    const world = document.createElement("div");
    world.setAttribute("data-multi-screen-canvas-world", "");
    world.style.transform = "translate(50px, 25px) scale(2)";
    canvas.appendChild(world);

    try {
      await act(async () => {
        root.render(
          <ReviewCanvasPins
            active={false}
            onClose={vi.fn()}
            canvasSelector=".review-test-canvas"
            resourceType="design"
            resourceId="design-1"
            targetId={null}
            canPost
            canResolve
          />,
        );
      });

      const pin =
        document.querySelector<HTMLButtonElement>("[data-review-pin]");
      const popover = pin?.parentElement;
      expect(popover?.style.left).toBe("330px");
      expect(popover?.style.top).toBe("205px");
      expect(pin?.className).toContain("size-6");

      await act(async () => {
        world.style.transform = "translate(100px, 50px) scale(1)";
        root.render(
          <ReviewCanvasPins
            active={false}
            onClose={vi.fn()}
            canvasSelector=".review-test-canvas"
            resourceType="design"
            resourceId="design-1"
            targetId={null}
            canPost
            canResolve
          />,
        );
      });

      expect(popover?.style.left).toBe("240px");
      expect(popover?.style.top).toBe("140px");
      expect(pin?.className).toContain("size-6");
    } finally {
      comment.anchor = previousAnchor;
    }
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

  it("opens a dedicated Edit with AI draft without creating a review comment", async () => {
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
    expect(document.body.textContent).not.toContain("review.commentMode");
    expect(document.body.textContent).not.toContain("review.clickToPin");
    const modeMenuTrigger = document.querySelector<HTMLButtonElement>(
      '[aria-label="designEditor.nodeRewrite.agentModeOptions"]',
    );
    await act(async () => {
      modeMenuTrigger?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      modeMenuTrigger?.click();
    });
    expect(
      document
        .querySelector("[data-review-mode-menu]")
        ?.hasAttribute("data-review-popover"),
    ).toBe(true);
    await act(async () => send?.click());

    expect(mocks.createMutate).not.toHaveBeenCalled();
    expect(mocks.callAction).toHaveBeenCalledWith(
      "begin-node-rewrite-request",
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
    const beginCall = mocks.callAction.mock.calls.find(
      ([name]) => name === "begin-node-rewrite-request",
    );
    const pending = beginCall?.[1] as {
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

  it("leaves an overview reprompt for the active visible canvas to consume", async () => {
    const onConsumed = vi.fn();
    const onClose = vi.fn();
    const request = {
      nonce: 3,
      fileId: "screen-1",
      target: {
        nodeId: "hero",
        selector: '[data-agent-native-node-id="hero"]',
      },
      point: { xPct: 50, yPct: 40 },
    };
    const renderPins = (active: boolean, hidden: boolean) => (
      <ReviewCanvasPins
        active={active}
        hidden={hidden}
        onClose={onClose}
        canvasSelector=".review-test-canvas"
        resourceType="design"
        resourceId="design-1"
        targetId="screen-1"
        canPost
        canResolve
        sourceType="inline"
        repromptDraftRequest={request}
        onRepromptDraftConsumed={onConsumed}
      />
    );

    await act(async () => root.render(renderPins(false, true)));
    expect(onConsumed).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(
      "designEditor.nodeRewrite.composerTitle",
    );

    await act(async () => root.render(renderPins(true, false)));
    expect(onConsumed).toHaveBeenCalledWith(3);
    expect(document.body.textContent).toContain(
      "designEditor.nodeRewrite.composerTitle",
    );
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
    expect(document.querySelector("[data-review-test-submit]")).toBeNull();
  });
});
