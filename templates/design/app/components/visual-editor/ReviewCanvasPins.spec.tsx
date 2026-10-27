// @vitest-environment happy-dom

import type { ReviewComment, ReviewMention } from "@agent-native/core/review";
import { act, Profiler, useState } from "react";
import type { TextareaHTMLAttributes } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isCanvasOverlayInteractionTarget } from "@/components/design/canvas-interactions/review-overlay-interaction";
import { stubFaithfulWheelEvent } from "@/components/design/canvas-interactions/test-wheel-event";
import { useReviewFocusRequest } from "@/hooks/use-review-focus-request";
import { ReviewAgentProvider } from "@/lib/review-agent/review-agent-context";
import {
  makeReviewAgentRequest,
  REVIEW_AGENT_TEST_NOW,
} from "@/lib/review-agent/test-review-agent-request";
import type { ReviewAgentController } from "@/lib/review-agent/use-review-agent-requests";

const mocks = vi.hoisted(() => ({
  createMutate: vi.fn(),
  replyMutate: vi.fn(),
  reactMutate: vi.fn(),
  resolveMutate: vi.fn(),
  unreadMutate: vi.fn(),
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  callAction: vi.fn().mockResolvedValue({ cancelled: true }),
  setClientAppState: vi.fn().mockResolvedValue(undefined),
  sendToAgent: vi.fn().mockResolvedValue({ delivered: true }),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  agentStart: vi.fn(),
  agentStop: vi.fn(),
  agentRetry: vi.fn(),
  agentOpen: vi.fn(),
  agentMarkSurfaceUsed: vi.fn(),
  useRealComposer: false,
  useRealThreads: false,
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
      canDelete: true,
    }) satisfies ReviewComment,
);

let reviewComments: ReviewComment[] = [comment];

// The composer's ProseMirror root exposes its tiptap editor on the DOM node.
interface Editor {
  state: {
    selection: { empty: boolean; from: number };
    doc: { content: { size: number } };
    tr: { insertText: (text: string) => object };
  };
  view: { dispatch: (transaction: object) => void };
}

function makeReply(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    ...comment,
    id: "reply-1",
    parentCommentId: comment.id,
    body: "A reply",
    authorEmail: "replier@example.com",
    createdAt: "2026-07-13T13:05:00.000Z",
    updatedAt: "2026-07-13T13:05:00.000Z",
    ...overrides,
  };
}

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  setClientAppState: mocks.setClientAppState,
  useAvatarUrl: () => null,
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  uploadEditorImage: mocks.uploadImage,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgMembers: () => ({
    data: {
      members: mocks.useRealComposer
        ? [{ email: "alice@example.com", name: "Alice" }]
        : [],
    },
  }),
}));

vi.mock("@agent-native/toolkit/app/review", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/toolkit/app/review")
  >("@agent-native/toolkit/app/review");

  return {
    ...actual,
    buildReviewThreads: (comments: ReviewComment[]) =>
      mocks.useRealThreads
        ? actual.buildReviewThreads(comments)
        : comments.map((root) => ({ root, replies: [] })),
    ReviewCommentComposer: (
      props: Parameters<typeof actual.ReviewCommentComposer>[0],
    ) =>
      mocks.useRealComposer ? (
        <actual.ReviewCommentComposer {...props} />
      ) : (
        <MockReviewCommentComposer {...props} />
      ),
  };
});

vi.mock("@agent-native/core/client/review", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/client/review")
  >("@agent-native/core/client/review");

  return {
    ...actual,
    useCreateReviewComment: () => ({
      mutate: mocks.createMutate,
      isPending: false,
    }),
    useDeleteReviewComment: () => ({
      mutate: mocks.deleteMutate,
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
  };
});

function MockReviewCommentComposer(props: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (target: "human" | "agent") => void;
  mentions?: readonly ReviewMention[];
  onMentionsChange?: (mentions: ReviewMention[]) => void;
  mentionOptions?: readonly ReviewMention[];
  agentsLabel?: string;
  showCommentAction?: boolean;
  showAgentAction?: boolean;
  showCommentTools?: boolean;
  commentToolsEnd?: React.ReactNode;
  attachments?: React.ReactNode;
  variant?: "expanded" | "reply";
  placeholder?: string;
  commentLabel?: string;
  contextLabel?: string;
  agentAction?: React.ReactNode;
  autoFocus?: boolean;
  disabled?: boolean;
  onEscape?: () => void;
  submitOnEnter?: boolean;
  enterSubmitTarget?: "human" | "agent";
  textareaProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
}) {
  const submit = (target: "human" | "agent") => {
    if (!props.value.trim() || props.disabled) return;
    props.onSubmit(target);
  };
  return (
    <div data-review-test-composer={props.variant ?? "expanded"}>
      {props.contextLabel ? <span>{props.contextLabel}</span> : null}
      <textarea
        {...props.textareaProps}
        data-review-test-textarea
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            props.onEscape?.();
            return;
          }
          if (props.submitOnEnter && event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit(props.enterSubmitTarget ?? "human");
          }
        }}
      />
      {props.attachments}
      <span data-review-test-mention-options>
        {(props.mentionOptions ?? []).map((option) => option.label).join("|")}
      </span>
      <span data-review-test-agents-label>{props.agentsLabel}</span>
      {props.showCommentTools || props.commentToolsEnd ? (
        <div data-review-comment-tools>
          {props.showCommentTools ? (
            <>
              <button type="button" aria-label="review.addEmoji" />
              <button type="button" aria-label="review.mention" />
              <button
                type="button"
                data-review-test-agent-mention
                onClick={() => {
                  props.onChange("@Claude Sonnet 5.5 make it bigger");
                  props.onMentionsChange?.([
                    {
                      label: "Claude Sonnet 5.5",
                      email: null,
                      id: "agent:anthropic:claude-sonnet-5-5",
                    },
                  ]);
                }}
              />
              <button
                type="button"
                data-review-test-mention
                onClick={() => {
                  props.onChange("@Alice");
                  props.onMentionsChange?.([
                    { label: "Alice", email: "alice@example.com" },
                  ]);
                }}
              />
            </>
          ) : null}
          {props.commentToolsEnd ? (
            <div data-review-comment-tools-end>{props.commentToolsEnd}</div>
          ) : null}
        </div>
      ) : null}
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
            <button
              type="button"
              data-review-test-agent-action
              onClick={() => submit("agent")}
            />
          ))
        : null}
    </div>
  );
}

vi.mock("@agent-native/core/client/i18n", async () => {
  const actual = await vi.importActual<
    typeof import("@agent-native/core/client/i18n")
  >("@agent-native/core/client/i18n");
  return {
    ...actual,
    useT: () => (key: string, values?: { count?: number }) =>
      key === "review.pinLabel"
        ? `Comment thread with ${values?.count} ${values?.count === 1 ? "comment" : "comments"}`
        : key,
  };
});

vi.mock("@agent-native/core/client/use-avatar", () => ({
  useAvatarUrl: () => null,
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

const SONNET = {
  model: "claude-sonnet-5-5",
  engine: "anthropic",
  provider: "Anthropic",
};

function makeAgentController(
  overrides: Partial<ReviewAgentController> = {},
): ReviewAgentController {
  return {
    enabled: true,
    requests: [],
    requestForThread: () => undefined,
    isThreadBusy: () => false,
    startingThreadIds: new Set(),
    startingAgentName: () => null,
    stoppingRequestIds: new Set(),
    start: mocks.agentStart,
    stop: mocks.agentStop,
    retry: mocks.agentRetry,
    open: mocks.agentOpen,
    models: { ready: true, options: [SONNET], selected: SONNET },
    mentionOptions: [
      {
        id: "agent:anthropic:claude-sonnet-5-5",
        label: "Claude Sonnet 5.5",
        email: null,
        description: "Anthropic",
      },
    ],
    resolveMention: (mention) =>
      mention.id === "agent:anthropic:claude-sonnet-5-5" ? SONNET : null,
    markSurfaceUsed: mocks.agentMarkSurfaceUsed,
    ...overrides,
  };
}

describe("ReviewCanvasPins persisted thread popover", () => {
  let container: HTMLDivElement;
  let canvas: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    mocks.useRealComposer = false;
    mocks.useRealThreads = false;
    mocks.createMutate.mockReset();
    mocks.replyMutate.mockReset();
    mocks.reactMutate.mockReset();
    mocks.resolveMutate.mockReset();
    mocks.unreadMutate.mockReset();
    mocks.updateMutate.mockReset();
    mocks.deleteMutate.mockReset();
    mocks.callAction.mockClear();
    mocks.setClientAppState.mockClear();
    mocks.sendToAgent.mockClear();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.agentStart.mockReset().mockResolvedValue("started");
    mocks.agentStop.mockReset().mockResolvedValue(undefined);
    mocks.agentRetry.mockReset().mockResolvedValue("started");
    mocks.agentOpen.mockReset();
    mocks.agentMarkSurfaceUsed.mockReset();
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

  it("does not retry hidden pin mode when its close callback changes", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active
          hidden
          onClose={onClose}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          canPost
          canResolve
        />,
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    const nextOnClose = vi.fn();
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active
          hidden
          onClose={nextOnClose}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          canPost
          canResolve
        />,
      );
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(nextOnClose).not.toHaveBeenCalled();
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

  it("opens the thread card with the reply box collapsed until it is focused", async () => {
    mocks.useRealComposer = true;
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
          canResolve={false}
        />,
      );
    });

    const pin = document.querySelector<HTMLButtonElement>("[data-review-pin]");
    pin?.focus();
    await act(async () => pin?.click());

    const replyInput = document.querySelector<HTMLElement>(
      "[data-review-reply-input]",
    );
    expect(replyInput).not.toBeNull();
    expect(document.activeElement).not.toBe(replyInput);
    const replyField = replyInput?.closest("[data-review-composer-field]");
    expect(replyField).not.toBeNull();
    expect(replyField?.hasAttribute("data-expanded")).toBe(false);

    await act(async () => replyInput?.focus());

    expect(document.activeElement).toBe(replyInput);
    expect(replyField?.hasAttribute("data-expanded")).toBe(true);
  });

  describe("Escape", () => {
    // Design's global hotkeys listen on window before the review surfaces
    // mount, preventDefault() every Escape, and re-render the editor in the
    // same keydown. A re-render there gives the surface a fresh `onClose`, so a
    // listener that re-subscribes on it is gone before it runs.
    let rerenderHost: (() => void) | null = null;
    const hotkeysLikeDesign = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      flushSync(() => rerenderHost?.());
    };

    // happy-dom still calls a listener that was removed during the dispatch;
    // browsers skip it. Skip it here too, for window keydown listeners.
    const skipRemovedKeydownListeners = () => {
      type Registration = {
        listener: EventListenerOrEventListenerObject;
        capture: boolean;
        wrapper: EventListener;
        removed: boolean;
      };
      const registrations: Registration[] = [];
      const captureOf = (options?: boolean | AddEventListenerOptions) =>
        typeof options === "boolean" ? options : Boolean(options?.capture);
      const add = window.addEventListener.bind(window);
      const remove = window.removeEventListener.bind(window);
      const addSpy = vi
        .spyOn(window, "addEventListener")
        .mockImplementation((type, listener, options) => {
          if (type !== "keydown" || !listener) {
            return add(type, listener, options);
          }
          const registration: Registration = {
            listener,
            capture: captureOf(options),
            removed: false,
            wrapper: (event) => {
              if (registration.removed) return;
              if (typeof listener === "function") listener(event);
              else listener.handleEvent(event);
            },
          };
          registrations.push(registration);
          add(type, registration.wrapper, options);
        });
      const removeSpy = vi
        .spyOn(window, "removeEventListener")
        .mockImplementation((type, listener, options) => {
          const registration = registrations.find(
            (candidate) =>
              !candidate.removed &&
              candidate.listener === listener &&
              candidate.capture === captureOf(options),
          );
          if (type !== "keydown" || !registration) {
            return remove(type, listener, options);
          }
          registration.removed = true;
          remove(type, registration.wrapper, options);
        });
      return () => {
        addSpy.mockRestore();
        removeSpy.mockRestore();
        for (const registration of registrations) {
          if (registration.removed) continue;
          registration.removed = true;
          remove("keydown", registration.wrapper, registration.capture);
        }
      };
    };
    let restoreListeners: (() => void) | null = null;

    beforeEach(() => {
      mocks.useRealComposer = true;
      restoreListeners = skipRemovedKeydownListeners();
      window.addEventListener("keydown", hotkeysLikeDesign);
    });

    afterEach(() => {
      window.removeEventListener("keydown", hotkeysLikeDesign);
      restoreListeners?.();
      rerenderHost = null;
    });

    function EscapeHost({
      onClose,
      surfaces = 1,
      ...props
    }: Partial<React.ComponentProps<typeof ReviewCanvasPins>> & {
      surfaces?: number;
    }) {
      const [, setTick] = useState(0);
      rerenderHost = () => setTick((tick) => tick + 1);
      return (
        <>
          {Array.from({ length: surfaces }, (_, index) => (
            <ReviewCanvasPins
              key={index}
              active={false}
              onClose={() => onClose?.()}
              canvasSelector=".review-test-canvas"
              resourceType="design"
              resourceId="design-1"
              targetId="screen-1"
              canPost
              canResolve={false}
              currentUserEmail="reviewer@example.com"
              {...props}
            />
          ))}
        </>
      );
    }

    const renderEscapeCase = async (
      props: React.ComponentProps<typeof EscapeHost> = {},
    ) => {
      await act(async () => {
        root.render(<EscapeHost {...props} />);
      });
    };
    const openFirstThread = async () => {
      await act(async () => {
        document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click();
      });
    };
    const openMenuFrom = async (label: string) => {
      await act(async () => {
        document
          .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
          ?.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              pointerType: "mouse",
            }),
          );
      });
    };
    const openThreadMenu = () => openMenuFrom("review.moreActions");
    // Dispatched outside act(): act holds passive effects until it exits, which
    // hides a listener being re-subscribed between the capture and bubble
    // phases of the one keydown.
    const pressEscape = async (target?: Element | null) => {
      vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", false);
      try {
        (target ?? document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      } finally {
        vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
      }
      await act(async () => {});
    };
    const cardOpen = () =>
      document.body.textContent?.includes("Keep this popover open") ?? false;
    const placeDraft = async () => {
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
        document.querySelector("[data-review-thread-card]"),
      ).not.toBeNull();
      await act(async () =>
        (document.activeElement as HTMLElement | null)?.blur(),
      );
    };

    it("closes the thread card on a plain Escape from the page body", async () => {
      await renderEscapeCase();
      await openFirstThread();
      expect(cardOpen()).toBe(true);

      await pressEscape(document.body);
      expect(cardOpen()).toBe(false);
    });

    it("closes only the open thread menu on the first Escape, then the card", async () => {
      await renderEscapeCase();
      await openFirstThread();
      await openThreadMenu();
      expect(
        document.querySelector('[role="menu"][data-review-popover]'),
      ).not.toBeNull();

      await pressEscape();
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(cardOpen()).toBe(true);

      await pressEscape(document.body);
      expect(cardOpen()).toBe(false);
    });

    it("closes only the open reaction picker on the first Escape, then the card", async () => {
      mocks.useRealThreads = true;
      reviewComments = [comment, makeReply({ id: "reply-1" })];
      await renderEscapeCase({ canResolve: true });
      await openFirstThread();
      await openMenuFrom("review.addReaction");
      expect(
        document.querySelector('[role="menu"][data-review-popover]'),
      ).not.toBeNull();

      await pressEscape();
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(cardOpen()).toBe(true);

      await pressEscape(document.body);
      expect(cardOpen()).toBe(false);
    });

    it("closes only the delete confirmation on the first Escape, then the card", async () => {
      await renderEscapeCase();
      await openFirstThread();
      await openThreadMenu();
      await act(async () => {
        Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
          .find((item) => item.textContent?.trim() === "review.deleteThread")
          ?.click();
      });
      expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();

      await pressEscape();
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(cardOpen()).toBe(true);

      await pressEscape(document.body);
      expect(cardOpen()).toBe(false);
    });

    it("closes the card when Escape is pressed in the reply editor", async () => {
      await renderEscapeCase();
      await openFirstThread();
      const editor = document.querySelector<HTMLElement>(
        '[data-review-thread-card] [contenteditable="true"]',
      );
      expect(editor).not.toBeNull();
      await act(async () => editor?.focus());

      await pressEscape(editor);
      expect(cardOpen()).toBe(false);
    });

    it("cancels an open draft on the first Escape and exits comment mode on the second", async () => {
      const onClose = vi.fn();
      await renderEscapeCase({ active: true, onClose });
      await placeDraft();

      await pressEscape(document.body);
      expect(document.querySelector("[data-review-thread-card]")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      await pressEscape(document.body);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("keeps comment mode on while another mounted surface cancels its draft", async () => {
      const onClose = vi.fn();
      await renderEscapeCase({ active: true, onClose, surfaces: 2 });
      await placeDraft();

      await pressEscape(document.body);
      expect(document.querySelector("[data-review-thread-card]")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      await pressEscape(document.body);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("confirms deleting a thread in thread wording", async () => {
    mocks.useRealComposer = true;
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
          canResolve={false}
          currentUserEmail="reviewer@example.com"
        />,
      );
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click();
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="review.moreActions"]',
        )
        ?.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
    });
    const deleteItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "review.deleteThread");
    await act(async () => deleteItem?.click());

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("review.deleteThreadTitle");
    expect(dialog?.textContent).toContain("review.deleteThreadDescription");
    expect(dialog?.textContent).not.toContain("review.deleteCommentTitle");
    const confirm = Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === "review.deleteThread");
    expect(confirm).toBeDefined();
    await act(async () => confirm?.click());
    expect(mocks.deleteMutate).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: "comment-1" }),
      expect.any(Object),
    );
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
    expect(
      reviewChrome?.closest("[data-review-overlay-root]")?.parentElement,
    ).toBe(document.body);
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
          screenId="screen-1"
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
    ).not.toBeNull();
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
      document
        .querySelector("[data-review-comment-tools]")
        ?.querySelector("[data-review-attachment-button]"),
    ).not.toBeNull();
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-submit]")
        ?.click();
    });

    expect(mocks.createMutate).toHaveBeenCalledTimes(1);
    expect(mocks.createMutate.mock.calls[0]?.[0]).toMatchObject({
      body: "Make the background darker",
      anchor: {
        point: { xPct: 37.5, yPct: 40 },
        screenId: "screen-1",
        screenPoint: { xPct: 37.5, yPct: 40 },
      },
      resolutionTarget: "human",
    });
  });

  it("repositions a screen pin when its owning frame shell moves", async () => {
    const frameShell = document.createElement("div");
    frameShell.setAttribute("data-frame-shell", "");
    let canvasLeft = 0;
    canvas.getBoundingClientRect = () =>
      ({
        x: canvasLeft,
        y: 0,
        left: canvasLeft,
        top: 0,
        right: canvasLeft + 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }) as DOMRect;
    canvas.remove();
    frameShell.appendChild(canvas);
    document.body.appendChild(frameShell);

    try {
      await act(async () => {
        root.render(
          <ReviewCanvasPins
            active={false}
            onClose={vi.fn()}
            canvasSelector=".review-test-canvas"
            resourceType="design"
            resourceId="design-1"
            targetId="screen-1"
            screenId="screen-1"
            canPost
            canResolve
          />,
        );
      });
      const pinOwner =
        document.querySelector<HTMLElement>("[data-review-pin]")?.parentElement;
      expect(pinOwner?.style.left).toBe("200px");

      await act(async () => {
        canvasLeft = 500;
        frameShell.style.left = "500px";
        await new Promise((resolve) => window.setTimeout(resolve, 40));
      });
      expect(pinOwner?.style.left).toBe("700px");
    } finally {
      frameShell.remove();
    }
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
    expect(mocks.createMutate.mock.calls[0]?.[0]?.anchor).not.toHaveProperty(
      "screenId",
    );
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

  it("retires a focus request once the overlay has opened its thread", async () => {
    const onConsumed = vi.fn();
    await act(async () => {
      root.render(
        <ReviewCanvasPins
          active={false}
          onClose={vi.fn()}
          canvasSelector=".review-test-canvas"
          resourceType="design"
          resourceId="design-1"
          targetId="screen-1"
          focusRequest={{
            nonce: 1,
            anchor: comment.anchor,
            targetId: "screen-1",
            threadId: "thread-1",
            onConsumed,
          }}
          canPost
          canResolve
        />,
      );
    });
    expect(document.body.textContent).toContain("Keep this popover open");
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not replay a handled focus request when another overlay mounts later", async () => {
    // Creating the first frame on an empty board swaps the board's overlay for a
    // new one while the editor still holds the request the user made earlier.
    const boardAnchor = {
      point: { xPct: 90, yPct: 90 },
      worldPoint: { x: 7200, y: 8100 },
    };
    reviewComments = [{ ...comment, targetId: null, anchor: boardAnchor }];
    const boardCanvas = document.createElement("div");
    boardCanvas.id = "board-review-test-canvas";
    boardCanvas.getBoundingClientRect = canvas.getBoundingClientRect;
    document.body.appendChild(boardCanvas);
    let issue!: ReturnType<typeof useReviewFocusRequest>[1];
    function Editor({ overlay }: { overlay: "empty-board" | "board-frame" }) {
      const [request, issueRequest] = useReviewFocusRequest();
      issue = issueRequest;
      return (
        <ReviewCanvasPins
          key={overlay}
          active={false}
          onClose={vi.fn()}
          canvasSelector={
            overlay === "empty-board"
              ? ".review-test-canvas"
              : "#board-review-test-canvas"
          }
          resourceType="design"
          resourceId="design-1"
          targetId={null}
          boardGeometry={{ x: 0, y: 0, width: 800, height: 600 }}
          onFocusBoardPoint={vi.fn()}
          focusRequest={request}
          canPost
          canResolve
        />
      );
    }
    const requestThread = {
      anchor: boardAnchor,
      targetId: null,
      threadId: "thread-1",
    };
    try {
      await act(async () => root.render(<Editor overlay="empty-board" />));
      expect(document.body.textContent).not.toContain("Keep this popover open");

      await act(async () => issue(requestThread));
      expect(document.body.textContent).toContain("Keep this popover open");

      await act(async () => root.render(<Editor overlay="board-frame" />));
      expect(document.body.textContent).not.toContain("Keep this popover open");

      await act(async () => issue(requestThread));
      expect(document.body.textContent).toContain("Keep this popover open");
    } finally {
      boardCanvas.remove();
    }
  });

  describe("wheel over the comment overlay", () => {
    beforeEach(stubFaithfulWheelEvent);

    const wheel = (init: WheelEventInit) =>
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 150,
        deltaY: -120,
        ...init,
      });

    async function renderWithCanvasThatTakesWheels(active = false) {
      const seen: WheelEvent[] = [];
      // Stands in for the canvas, which zooms on a pinch and pans on a scroll.
      canvas.addEventListener("wheel", (event) => {
        seen.push(event);
        event.preventDefault();
      });
      await act(async () => {
        root.render(
          <ReviewCanvasPins
            active={active}
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
      return seen;
    }

    it("hands a pinch over a pin to the canvas so the browser does not zoom", async () => {
      const seen = await renderWithCanvasThatTakesWheels();
      const pin = document.querySelector<HTMLElement>("[data-review-pin]")!;

      const pinch = wheel({ ctrlKey: true });
      pin.dispatchEvent(pinch);

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ ctrlKey: true, deltaY: -120 });
      expect(pinch.defaultPrevented).toBe(true);
    });

    it("hands a two-finger scroll over a pin to the canvas to pan", async () => {
      const seen = await renderWithCanvasThatTakesWheels();
      const pin = document.querySelector<HTMLElement>("[data-review-pin]")!;

      const scroll = wheel({ deltaX: 8, deltaY: 60 });
      pin.dispatchEvent(scroll);

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ ctrlKey: false, deltaY: 60 });
      expect(scroll.defaultPrevented).toBe(true);
    });

    it("hands a pinch over the open thread card to the canvas but leaves its scroll to the card", async () => {
      const seen = await renderWithCanvasThatTakesWheels();
      await act(async () =>
        document.querySelector<HTMLElement>("[data-review-pin]")?.click(),
      );
      const card = document.querySelector<HTMLElement>(
        "[data-review-thread-card]",
      )!;
      expect(card).not.toBeNull();

      const pinch = wheel({ ctrlKey: true });
      card.dispatchEvent(pinch);
      expect(seen).toHaveLength(1);
      expect(pinch.defaultPrevented).toBe(true);

      const scroll = wheel({ deltaY: 60 });
      card.dispatchEvent(scroll);
      expect(seen).toHaveLength(1);
      expect(scroll.defaultPrevented).toBe(false);
    });

    it("hands a pinch over the new-comment draft card to the canvas", async () => {
      const seen = await renderWithCanvasThatTakesWheels(true);
      await act(async () =>
        document
          .querySelector<HTMLElement>("[data-review-click-plane]")
          ?.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              clientX: 320,
              clientY: 180,
            }),
          ),
      );
      const card = document.querySelector<HTMLElement>(
        "[data-review-thread-card]",
      )!;
      expect(card).not.toBeNull();

      const pinch = wheel({ ctrlKey: true });
      card.dispatchEvent(pinch);
      expect(seen).toHaveLength(1);
      expect(pinch.defaultPrevented).toBe(true);
    });

    it("hands a scroll over the placement plane to the canvas to pan", async () => {
      const seen = await renderWithCanvasThatTakesWheels(true);
      const plane = document.querySelector<HTMLElement>(
        "[data-review-click-plane]",
      )!;

      const scroll = wheel({ deltaY: 60 });
      plane.dispatchEvent(scroll);

      expect(seen).toHaveLength(1);
      expect(scroll.defaultPrevented).toBe(true);
    });
  });

  it("renders the valid pin when an earlier anchor is malformed", async () => {
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
    ).toBe("Comment thread with 1 comment");
  });

  describe("pin badge", () => {
    const reply = (id: string, authorEmail: string): ReviewComment => ({
      ...comment,
      id,
      parentCommentId: "comment-1",
      authorEmail,
      authorName: null,
      body: `Reply ${id}`,
    });
    const renderPinsOnly = async () => {
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
    };
    const pin = () =>
      document.querySelector<HTMLButtonElement>("[data-review-pin]");

    beforeEach(() => {
      mocks.useRealThreads = true;
    });

    afterEach(() => {
      mocks.useRealThreads = false;
    });

    it("shows one avatar and no count for a single-comment thread", async () => {
      await renderPinsOnly();

      expect(pin()?.textContent).toBe("R");
      expect(pin()?.getAttribute("aria-label")).toBe(
        "Comment thread with 1 comment",
      );
    });

    it("stacks unique authors and counts every comment in the thread", async () => {
      reviewComments = [
        comment,
        reply("reply-1", "second@example.com"),
        reply("reply-2", "reviewer@example.com"),
      ];
      await renderPinsOnly();

      // The root author replied too, so two avatars and a total of three.
      expect(pin()?.textContent).toBe("RS3");
      expect(pin()?.getAttribute("aria-label")).toBe(
        "Comment thread with 3 comments",
      );
    });

    it("shows at most three authors but still counts every comment", async () => {
      reviewComments = [
        comment,
        reply("reply-1", "second@example.com"),
        reply("reply-2", "third@example.com"),
        reply("reply-3", "fourth@example.com"),
      ];
      await renderPinsOnly();

      expect(pin()?.textContent).toBe("RST4");
    });

    it("draws an agent author with its brand mark instead of an initial", async () => {
      reviewComments = [
        {
          ...comment,
          authorEmail: null,
          authorName: "Claude",
          createdBy: "agent",
        },
      ];
      await renderPinsOnly();

      expect(pin()?.querySelector("svg")).not.toBeNull();
      expect(pin()?.textContent).toBe("");
    });

    it("rings the pin of the open thread in the editor accent color", async () => {
      await renderPinsOnly();
      expect(pin()?.className).not.toContain(
        "ring-[var(--design-editor-accent-color)]",
      );

      await act(async () => pin()?.click());

      expect(pin()?.className).toContain(
        "ring-[var(--design-editor-accent-color)]",
      );
    });

    it("counts the threads in a cluster by thread, not by comment", async () => {
      reviewComments = [
        comment,
        {
          ...comment,
          id: "comment-2",
          threadId: "thread-2",
          anchor: { point: { xPct: 26, yPct: 30 } },
        },
      ];
      await renderPinsOnly();

      expect(
        document.querySelector("[data-review-pin-cluster]")?.textContent,
      ).toBe("R2");
    });
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

  it("keeps the portaled reaction menu from closing the thread", async () => {
    mocks.useRealThreads = true;
    reviewComments = [comment, makeReply({ id: "reply-1" })];
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
    const reactionPicker = document.querySelector<HTMLButtonElement>(
      'button[aria-label="review.addReaction"]',
    );
    expect(reactionPicker).not.toBeNull();
    await act(async () => {
      reactionPicker?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      reactionPicker?.click();
    });

    const reactionMenu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(reactionMenu).not.toBeNull();
    await act(async () => {
      reactionMenu?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    expect(document.body.textContent).toContain("Keep this popover open");
  });

  it("keeps the portaled thread menu from closing the thread, and only that menu", async () => {
    mocks.useRealThreads = true;
    reviewComments = [comment, makeReply({ id: "reply-1" })];
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
    const moreActions = document.querySelector<HTMLButtonElement>(
      'button[aria-label="review.moreActions"]',
    );
    await act(async () => {
      moreActions?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      moreActions?.click();
    });
    const copyLink = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("review.copyLink"));
    expect(copyLink).not.toBeUndefined();
    expect(isCanvasOverlayInteractionTarget(copyLink!)).toBe(true);
    await act(async () => {
      copyLink!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    expect(document.body.textContent).toContain("Keep this popover open");

    // A Radix popper that is not review UI still counts as outside the thread.
    const unrelatedWrapper = document.createElement("div");
    unrelatedWrapper.setAttribute("data-radix-popper-content-wrapper", "");
    const unrelatedMenu = document.createElement("div");
    unrelatedMenu.setAttribute("role", "menu");
    unrelatedWrapper.append(unrelatedMenu);
    document.body.append(unrelatedWrapper);
    await act(async () => {
      unrelatedMenu.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    expect(document.body.textContent).not.toContain("Keep this popover open");
    unrelatedWrapper.remove();
  });

  it("marks the portaled delete dialog and its backdrop as review UI", async () => {
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
    const moreActions = document.querySelector<HTMLButtonElement>(
      'button[aria-label="review.moreActions"]',
    );
    expect(moreActions).not.toBeNull();
    await act(async () => {
      moreActions?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
      moreActions?.click();
    });
    const deleteAction = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("review.deleteThread"));
    expect(deleteAction).not.toBeUndefined();
    await act(async () => deleteAction?.click());

    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    const overlay = document.querySelector<HTMLElement>(
      "[data-review-confirmation-overlay]",
    );
    expect(dialog?.hasAttribute("data-review-popover")).toBe(true);
    expect(overlay?.hasAttribute("data-review-popover")).toBe(true);
    expect(isCanvasOverlayInteractionTarget(dialog)).toBe(true);
    expect(isCanvasOverlayInteractionTarget(overlay)).toBe(true);
    await act(async () => {
      dialog?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    expect(document.body.textContent).toContain("Keep this popover open");
  });

  it("skips rerendering when a hover reply leaves the target unchanged", async () => {
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
    iframe.contentDocument!.body.innerHTML = "<button>Hover target</button>";
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, "postMessage", {
      configurable: true,
      value: postMessage,
    });
    const onRender = vi.fn();

    await act(async () => {
      root.render(
        <Profiler id="review-pins" onRender={onRender}>
          <ReviewCanvasPins
            active
            onClose={vi.fn()}
            canvasSelector=".review-test-canvas"
            resourceType="design"
            resourceId="design-1"
            targetId="screen-1"
            canPost
            canResolve
          />
        </Profiler>,
      );
    });
    const clickPlane = document.querySelector<HTMLElement>(
      "[data-review-click-plane]",
    );
    expect(clickPlane).not.toBeNull();
    const sendHoverReply = async () => {
      await act(async () => {
        clickPlane?.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: 100,
            clientY: 100,
          }),
        );
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
      });
      const requests = postMessage.mock.calls
        .map(([message]) => message as Record<string, unknown>)
        .filter(
          (message) => message.type === "agent-native:review-anchor-at-point",
        );
      const request = requests[requests.length - 1];
      expect(request?.correlationId).toBeTruthy();
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: iframe.contentWindow,
            data: {
              type: "agent-native:review-anchor-at-point-result",
              correlationId: request?.correlationId,
              nodeId: "hover-target",
              hitSelector: "source-equivalent:v1:body > button:nth-of-type(1)",
              rect: { left: 10, top: 20, width: 50, height: 30 },
              viewportWidth: 800,
              viewportHeight: 600,
            },
          }),
        );
      });
    };

    await sendHoverReply();
    const renderCount = onRender.mock.calls.length;
    expect(renderCount).toBeGreaterThan(1);
    await sendHoverReply();
    expect(onRender).toHaveBeenCalledTimes(renderCount);
  });

  it("skips unchanged selector-box replies and updates changed geometry", async () => {
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
    iframe.contentDocument!.body.innerHTML = "<main>Review target</main>";
    reviewComments = [
      {
        ...comment,
        anchor: {
          selector: "source-equivalent:v1:body > main:nth-of-type(1)",
          point: { xPct: 25, yPct: 30 },
        },
      },
    ];
    const postMessage = vi.fn();
    Object.defineProperty(iframe.contentWindow, "postMessage", {
      configurable: true,
      value: postMessage,
    });
    const onRender = vi.fn();

    await act(async () => {
      root.render(
        <Profiler id="review-pins" onRender={onRender}>
          <ReviewCanvasPins
            active={false}
            onClose={vi.fn()}
            canvasSelector=".review-test-canvas"
            resourceType="design"
            resourceId="design-1"
            targetId="screen-1"
            canPost
            canResolve
          />
        </Profiler>,
      );
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click();
    });

    const selectorRequests = () =>
      postMessage.mock.calls
        .map(([message]) => message as Record<string, unknown>)
        .filter(
          (message) => message.type === "agent-native:review-selector-rects",
        );
    const sendSelectorReply = async (
      request: Record<string, unknown>,
      left: number,
    ) => {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: iframe.contentWindow,
            data: {
              type: "agent-native:review-selector-rects-result",
              correlationId: request.correlationId,
              selectorStatus: "matched",
              rect: { left, top: 20, width: 50, height: 30 },
              viewportWidth: 800,
              viewportHeight: 600,
            },
          }),
        );
      });
    };
    const sendLayoutTick = async () => {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: iframe.contentWindow,
            data: { type: "agent-native:review-layout" },
          }),
        );
      });
    };

    const firstRequests = selectorRequests();
    const firstRequest = firstRequests[firstRequests.length - 1];
    expect(firstRequest).toBeDefined();
    await sendSelectorReply(firstRequest!, 10);

    await sendLayoutTick();
    const identicalReplyRenderCount = onRender.mock.calls.length;
    const secondRequests = selectorRequests();
    const secondRequest = secondRequests[secondRequests.length - 1];
    expect(secondRequest?.correlationId).not.toBe(firstRequest?.correlationId);
    await sendSelectorReply(secondRequest!, 10);
    expect(onRender).toHaveBeenCalledTimes(identicalReplyRenderCount);

    await sendLayoutTick();
    const changedReplyRenderCount = onRender.mock.calls.length;
    const thirdRequests = selectorRequests();
    const thirdRequest = thirdRequests[thirdRequests.length - 1];
    expect(thirdRequest?.correlationId).not.toBe(secondRequest?.correlationId);
    await sendSelectorReply(thirdRequest!, 40);
    expect(onRender.mock.calls.length).toBeGreaterThan(changedReplyRenderCount);
  });

  it("does not reuse a sibling hover box for a repeated node-ID popover", async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    iframe.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
      }) as DOMRect;
    Object.defineProperty(iframe, "clientWidth", { value: 800 });
    Object.defineProperty(iframe, "clientHeight", { value: 600 });
    canvas.appendChild(iframe);
    iframe.contentDocument!.body.innerHTML =
      '<main><section data-loc="src:repeated">First</section><section data-loc="src:repeated">Second</section></main>';
    reviewComments = [
      {
        ...comment,
        anchor: {
          nodeId: "src:repeated",
          relativePoint: { xPct: 50, yPct: 50 },
          point: { xPct: 50, yPct: 50 },
        },
      },
    ];
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
    const clickPlane = document.querySelector<HTMLElement>(
      "[data-review-click-plane]",
    );
    expect(clickPlane).not.toBeNull();
    await act(async () => {
      clickPlane?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      );
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    });
    const request = postMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .find(
        (message) => message.type === "agent-native:review-anchor-at-point",
      );
    expect(request?.correlationId).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            type: "agent-native:review-anchor-at-point-result",
            correlationId: request?.correlationId,
            nodeId: "src:repeated",
            rect: { left: 10, top: 20, width: 50, height: 30 },
            viewportWidth: 800,
            viewportHeight: 600,
          },
        }),
      );
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click();
    });

    expect(document.querySelector("[data-review-hover-highlight]")).toBeNull();
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
          screenId="screen-1"
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
        anchor: {
          point: { xPct: 37.5, yPct: 40 },
          screenId: "screen-1",
          screenPoint: { xPct: 37.5, yPct: 40 },
        },
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
        anchor: {
          point: { xPct: 38.5, yPct: 40 },
          screenId: "screen-1",
          screenPoint: { xPct: 38.5, yPct: 40 },
        },
      }),
      expect.any(Object),
    );
  });

  it("keeps a moved repeated-source pin anchored through its saved selector", async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    const iframeDocument = document.implementation.createHTMLDocument();
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: iframeDocument,
    });
    iframeDocument.body.innerHTML =
      '<main><section data-loc="src:1">First</section><section data-loc="src:1">Second</section></main>';
    const selectedElement = iframeDocument.querySelectorAll("section")[1];
    if (!selectedElement)
      throw new Error("Expected the second source instance");
    selectedElement.getBoundingClientRect = () =>
      ({
        left: 400,
        top: 100,
        right: 500,
        bottom: 180,
        width: 100,
        height: 80,
      }) as DOMRect;
    iframe.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
      }) as DOMRect;
    Object.defineProperty(iframe, "clientWidth", { value: 800 });
    Object.defineProperty(iframe, "clientHeight", { value: 600 });
    canvas.appendChild(iframe);
    reviewComments = [
      {
        ...comment,
        anchor: {
          nodeId: "src:1",
          selector: "body > main > section:nth-of-type(2)",
          point: { xPct: 56.25, yPct: 23.3333 },
          relativePoint: { xPct: 50, yPct: 50 },
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
          targetId="screen-1"
          screenId="screen-1"
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
          clientX: 450,
          clientY: 140,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", {
          bubbles: true,
          clientX: 470,
          clientY: 150,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", {
          bubbles: true,
          clientX: 470,
          clientY: 150,
        }),
      );
    });

    expect(mocks.updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: "comment-1",
        anchor: expect.objectContaining({
          selector: "body > main > section:nth-of-type(2)",
          point: { xPct: 58.75, yPct: 25 },
          relativePoint: { xPct: 70, yPct: 62.5 },
        }),
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
    expect(
      document.querySelector(
        '[data-review-attachment-button][aria-label="review.attachImage"]',
      ),
    ).not.toBeNull();
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

  it("keeps comment actions disabled until an image upload settles", async () => {
    let resolveUpload: ((value: { src: string }) => void) | undefined;
    mocks.uploadImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
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
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-type]")
        ?.click();
    });

    const input = document.querySelector<HTMLInputElement>(
      "[data-review-attachment-input]",
    );
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        new File(["image"], "pending.png", {
          type: "image/png",
        }),
      ],
    });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    const submit = document.querySelector<HTMLButtonElement>(
      "[data-review-test-submit]",
    );
    expect(submit?.disabled).toBe(true);
    expect(
      document.querySelector<HTMLTextAreaElement>("[data-review-test-textarea]")
        ?.disabled,
    ).toBe(true);

    await act(async () => {
      resolveUpload?.({ src: "https://cdn.example.com/pending.png" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(submit?.disabled).toBe(false);
  });

  it("persists selected mentions through draft and reply submissions", async () => {
    mocks.useRealComposer = true;
    const typeInto = async (
      editor: HTMLElement & { editor: Editor },
      text: string,
    ) => {
      await act(async () => {
        const { state, view } = editor.editor;
        view.dispatch(state.tr.insertText(text));
      });
    };
    const selectAlice = async (
      editor: HTMLElement & { editor: Editor },
      prefix: string,
    ) => {
      await typeInto(editor, prefix);
      await act(async () => {
        editor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "@",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await typeInto(editor, "Ali");
      const alice = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item) => item.textContent?.includes("Alice"));
      expect(alice).toBeTruthy();
      await act(async () => alice?.click());
      expect(
        editor.querySelector("[data-review-mention-chip]")?.textContent,
      ).toBe("Alice");
    };

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
    const draftEditor = document.querySelector<
      HTMLElement & { editor: Editor }
    >('[data-review-popover] [role="textbox"]');
    expect(draftEditor).not.toBeNull();
    await selectAlice(draftEditor!, "Draft ");
    await act(async () => {
      draftEditor
        ?.closest("form")
        ?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click();
    });
    expect(mocks.createMutate.mock.calls[0]?.[0]).toMatchObject({
      body: "Draft @Alice",
      mentions: [{ label: "Alice", email: "alice@example.com" }],
    });

    mocks.replyMutate.mockReset();
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
    const replyEditor = document.querySelector<
      HTMLElement & { editor: Editor }
    >("[data-review-reply-input]");
    expect(replyEditor).not.toBeNull();
    await selectAlice(replyEditor!, "Reply ");
    await act(async () => {
      replyEditor
        ?.closest("form")
        ?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click();
    });
    expect(mocks.replyMutate.mock.calls[0]?.[0]).toMatchObject({
      body: "Reply @Alice",
      mentions: [{ label: "Alice", email: "alice@example.com" }],
    });
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
        .querySelector<HTMLButtonElement>('button[aria-label="👍 2"]')
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
    const tools = document.querySelector<HTMLElement>(
      "[data-review-comment-tools]",
    );
    expect(
      tools
        ?.querySelector("[data-review-comment-tools-end]")
        ?.querySelector("[data-review-attachment-button]"),
    ).not.toBeNull();
    expect(
      tools?.querySelector('[aria-label="review.mention"]'),
    ).not.toBeNull();
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
      document
        .querySelector<HTMLButtonElement>('button[aria-label="review.resolve"]')
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
    expect(
      document.querySelector('[aria-label="review.addReaction"]'),
    ).toBeNull();
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
      expect(pin?.className).toContain("h-7");

      await act(async () => {
        world.style.transform = "translate(100px, 50px) scale(1)";
        await new Promise((resolve) => window.setTimeout(resolve, 40));
      });

      expect(popover?.style.left).toBe("240px");
      expect(popover?.style.top).toBe("140px");
      expect(pin?.className).toContain("h-7");
    } finally {
      comment.anchor = previousAnchor;
    }
  });

  it("keeps agent controls out of the draft card even when the host can dispatch", async () => {
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
    ).toBeNull();
    expect(document.body.textContent).not.toContain("review.sendToAgent");
  });

  it("clears a structural guess when the bridge resolves a source-location ID", async () => {
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
    iframe.contentDocument!.body.innerHTML =
      '<h1 data-loc="src:hero-title">Hello</h1>';
    const heroTitle = iframe.contentDocument!.querySelector("h1");
    if (!heroTitle) throw new Error("Expected the source-location heading");
    heroTitle.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
      }) as DOMRect;
    Object.defineProperty(iframe.contentDocument, "elementsFromPoint", {
      configurable: true,
      value: () => [heroTitle],
    });
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
            nodeId: "src:hero-title",
            hitSelector: "source-equivalent:v1:body > h1:nth-of-type(1)",
            layerName: "Hero title",
            tagName: "h1",
          },
        }),
      );
      document
        .querySelector<HTMLButtonElement>("[data-review-test-type]")
        ?.click();
    });
    expect(document.body.textContent).not.toContain("review.sendToAgent");
    expect(document.body.textContent).not.toContain(
      "designEditor.nodeRewrite.willPreview",
    );
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-submit]")
        ?.click();
    });

    expect(mocks.createMutate.mock.calls[0]?.[0]).toMatchObject({
      anchor: {
        nodeId: "src:hero-title",
        point: { xPct: 50, yPct: 50 },
        relativePoint: { xPct: 50, yPct: 50 },
      },
      metadata: { layerName: "Hero title", tagName: "h1" },
    });
    expect(mocks.createMutate.mock.calls[0]?.[0]?.anchor).toHaveProperty(
      "selector",
      "source-equivalent:v1:body > h1:nth-of-type(1)",
    );
    expect(mocks.createMutate.mock.calls[0]?.[0]?.metadata).not.toHaveProperty(
      "targetSelector",
    );
  });

  it("keeps a canvas point when the bridge returns an ambiguous repeated node ID", async () => {
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
    iframe.contentDocument!.body.innerHTML =
      '<main><section data-loc="src:repeated">First</section><section data-loc="src:repeated">Second</section></main>';
    const repeatedNodes = iframe.contentDocument!.querySelectorAll("section");
    const hit = repeatedNodes.item(1);
    expect(hit).not.toBeNull();
    if (!hit) throw new Error("Expected a repeated source-location node");
    hit.getBoundingClientRect = () =>
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
    Object.defineProperty(iframe.contentDocument, "elementsFromPoint", {
      configurable: true,
      value: () => [hit],
    });
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
    expect(bridgeRequest?.correlationId).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            type: "agent-native:review-anchor-at-point-result",
            correlationId: bridgeRequest?.correlationId,
            nodeId: "src:repeated",
            hitSelector: "",
            tagName: "section",
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

    const submitted = mocks.createMutate.mock.calls[0]?.[0];
    expect(submitted?.anchor).toMatchObject({
      point: { xPct: 50, yPct: 50 },
    });
    expect(submitted?.anchor).toHaveProperty("nodeId", "src:repeated");
    expect(submitted?.anchor).not.toHaveProperty("selector");
    expect(submitted?.anchor).not.toHaveProperty("relativePoint");
    expect(submitted?.metadata).not.toHaveProperty("targetSelector");
  });

  it("measures a data-loc hit relative to its matching ancestor", async () => {
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
    const iframeDocument = iframe.contentDocument!;
    iframeDocument.body.innerHTML =
      '<main data-loc="src:hero"><span>Child</span></main>';
    const ancestor = iframeDocument.querySelector("main");
    const child = iframeDocument.querySelector("span");
    if (!ancestor || !child) throw new Error("Expected the hit-test elements");
    ancestor.getBoundingClientRect = () =>
      ({
        left: 200,
        top: 100,
        right: 600,
        bottom: 400,
        width: 400,
        height: 300,
      }) as DOMRect;
    child.getBoundingClientRect = () =>
      ({
        left: 300,
        top: 175,
        right: 400,
        bottom: 225,
        width: 100,
        height: 50,
      }) as DOMRect;
    Object.defineProperty(iframeDocument, "elementsFromPoint", {
      configurable: true,
      value: () => [child],
    });
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
            clientY: 250,
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
            nodeId: "src:hero",
            hitSelector: "body > main:nth-of-type(1)",
            tagName: "main",
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
        nodeId: "src:hero",
        relativePoint: { xPct: 50, yPct: 50 },
      },
    });
  });

  it("clears the parent hit relative point when the bridge refines a clone to its ancestor", async () => {
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
    const iframeDocument = iframe.contentDocument!;
    iframeDocument.body.innerHTML =
      '<main><section data-loc="src:card"><button data-loc="src:button">First clone</button></section><section data-loc="src:card"><button data-loc="src:button">Second clone</button></section></main>';
    const secondClone = iframeDocument.querySelectorAll("button")[1];
    if (!secondClone) throw new Error("Expected the second source clone");
    secondClone.getBoundingClientRect = () =>
      ({
        left: 320,
        top: 200,
        right: 400,
        bottom: 240,
        width: 80,
        height: 40,
      }) as DOMRect;
    Object.defineProperty(iframeDocument, "elementsFromPoint", {
      configurable: true,
      value: () => [secondClone],
    });
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
            clientX: 360,
            clientY: 220,
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
            nodeId: "src:card",
            hitSelector: "body > main:nth-of-type(1) > section:nth-of-type(2)",
            tagName: "section",
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

    const submitted = mocks.createMutate.mock.calls[0]?.[0];
    expect(submitted).toMatchObject({
      anchor: {
        nodeId: "src:card",
        selector: "body > main:nth-of-type(1) > section:nth-of-type(2)",
        point: { xPct: 45, yPct: 36.666666666666664 },
      },
    });
    expect(submitted?.anchor).not.toHaveProperty("relativePoint");
  });

  it("falls back to the stored point when a persisted legacy selector is malformed", async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    const iframeDocument = document.implementation.createHTMLDocument();
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: iframeDocument,
    });
    iframeDocument.body.innerHTML = "<main>Preview</main>";
    canvas.appendChild(iframe);
    reviewComments = [
      {
        ...comment,
        anchor: {
          selector: "[",
          point: { xPct: 37.5, yPct: 40 },
          relativePoint: { xPct: 50, yPct: 50 },
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
          targetId="screen-1"
          canPost
          canResolve
        />,
      );
    });

    const pin = document.querySelector<HTMLButtonElement>("[data-review-pin]");
    expect(pin).not.toBeNull();
    expect(pin?.parentElement?.style.left).toBe("300px");
    expect(pin?.parentElement?.style.top).toBe("240px");
  });

  it("saves a bridge selector when a source-location ID is ambiguous", async () => {
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
    iframe.contentDocument!.body.innerHTML =
      '<main><section data-loc="src:1">First</section><section data-loc="src:1">Second</section></main>';
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
            nodeId: "src:1",
            hitSelector: "body > main > section:nth-of-type(2)",
            tagName: "section",
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
        nodeId: "src:1",
        selector: "body > main > section:nth-of-type(2)",
      },
    });
  });

  it.each([
    {
      identityCase: "a source location collides with a plain id",
      html: '<main><h1 id="hero">By id</h1><section data-loc="hero">By source</section></main>',
      hitSelector: "body > main > section:nth-of-type(1)",
      expectedSelector: true,
    },
    {
      identityCase: "only repeated plain ids match",
      html: '<main><section id="hero">First</section><section id="hero">Second</section></main>',
      hitSelector: "body > main > section:nth-of-type(2)",
      expectedSelector: true,
    },
  ])(
    "keeps bridge selector behavior when $identityCase",
    async ({ html, hitSelector, expectedSelector }) => {
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
      iframe.contentDocument!.body.innerHTML = html;
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
              nodeId: "hero",
              hitSelector,
              tagName: "section",
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

      const anchor = mocks.createMutate.mock.calls[0]?.[0]?.anchor;
      expect(anchor).toMatchObject({ nodeId: "hero" });
      if (expectedSelector) {
        expect(anchor).toMatchObject({ selector: hitSelector });
      } else {
        expect(anchor).not.toHaveProperty("selector");
      }
    },
  );

  it("sends a reprompt through the saved instance selector of a repeated source", async () => {
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
    iframe.contentDocument!.body.innerHTML =
      '<main><section data-loc="src:1">First</section><section data-loc="src:1">Second</section></main>';
    Object.defineProperty(iframe.contentDocument, "elementsFromPoint", {
      configurable: true,
      value: () => [],
    });
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
          sourceType="inline"
          sourceVersionHash="hash-1"
          repromptDraftRequest={{
            nonce: 1,
            fileId: "screen-1",
            target: {
              nodeId: "src:1",
              selector:
                "source-equivalent:v1:body > main:nth-of-type(1) > section:nth-of-type(2)",
            },
            point: { xPct: 50, yPct: 50 },
          }}
        />,
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

    expect(mocks.createMutate).not.toHaveBeenCalled();
    expect(mocks.callAction).toHaveBeenCalledWith(
      "begin-node-rewrite-request",
      expect.objectContaining({
        target: {
          nodeId: "src:1",
          selector:
            "source-equivalent:v1:body > main:nth-of-type(1) > section:nth-of-type(2)",
        },
      }),
    );
    expect(mocks.sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.stringContaining(
          '<section data-loc="src:1">Second</section>',
        ),
      }),
      { timeoutMs: 10_000 },
    );
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
    iframeDocument.body.innerHTML = '<section data-loc="src:1">Hero</section>';
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
              nodeId: "stale-node",
              selector: '[data-loc="src:1"]',
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
    const send = document.querySelector<HTMLButtonElement>(
      "[data-review-test-submit]",
    );
    expect(document.body.textContent).toContain(
      "designEditor.nodeRewrite.willPreview",
    );
    expect(document.body.textContent).toContain(
      "designEditor.nodeRewrite.composerTitle",
    );
    expect(document.body.textContent).not.toContain("review.threadTitle");
    expect(document.body.textContent).not.toContain("review.sendToAgent");
    expect(document.body.textContent).not.toContain("review.clickToPin");
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
          nodeId: "stale-node",
          selector: '[data-loc="src:1"]',
        },
      }),
    );
    expect(mocks.sendToAgent).toHaveBeenCalledTimes(1);
    expect(mocks.sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Make the background darker",
        context: expect.stringContaining(
          '<section data-loc="src:1">Hero</section>',
        ),
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

  it("clears a failed reprompt and keeps its draft available for retry", async () => {
    const onClose = vi.fn();
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-design-preview-iframe", "");
    const iframeDocument = document.implementation.createHTMLDocument();
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      value: iframeDocument,
    });
    iframeDocument.body.innerHTML = '<section data-loc="src:1">Hero</section>';
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
              nodeId: "stale-node",
              selector: '[data-loc="src:1"]',
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
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>("[data-review-test-submit]")
        ?.click();
    });

    const beginCall = mocks.callAction.mock.calls.find(
      ([name]) => name === "begin-node-rewrite-request",
    );
    const pending = beginCall?.[1] as {
      fileId: string;
      repromptId: string;
    };
    const pins = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-review-pin]"),
    );
    const pin = pins[pins.length - 1];
    expect(pin?.querySelector("svg")).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("design:node-reprompt-preview-failed", {
          detail: {
            repromptId: pending.repromptId,
            fileId: pending.fileId,
            reason: "future-bridge-reason",
          },
        }),
      );
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "designEditor.nodeRewrite.previewFailed",
    );
    const retryPins = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-review-pin]"),
    );
    const retryPin = retryPins[retryPins.length - 1];
    expect(retryPin?.querySelector("svg")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => retryPin?.click());
    expect(
      document.querySelector<HTMLTextAreaElement>("[data-review-test-textarea]")
        ?.value,
    ).toBe("Make the background darker");
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

  it("replaces an open comment draft with the reprompt composer", async () => {
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
    Object.defineProperty(iframeDocument, "elementsFromPoint", {
      configurable: true,
      value: () => [
        iframeDocument.querySelector("[data-agent-native-node-id]"),
      ],
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
    expect(document.body.textContent).toContain("review.threadTitle");
    expect(document.body.textContent).not.toContain(
      "designEditor.nodeRewrite.willPreview",
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
      "designEditor.nodeRewrite.composerTitle",
    );
    expect(document.body.textContent).not.toContain("review.threadTitle");
  });

  describe("thread card and draft card", () => {
    const renderPins = async (
      props: Partial<React.ComponentProps<typeof ReviewCanvasPins>> = {},
      agent: ReviewAgentController | null = null,
    ) => {
      await act(async () => {
        root.render(
          <ReviewAgentProvider controller={agent}>
            <ReviewCanvasPins
              active={false}
              onClose={vi.fn()}
              canvasSelector=".review-test-canvas"
              resourceType="design"
              resourceId="design-1"
              targetId="screen-1"
              canPost
              canResolve
              {...props}
            />
          </ReviewAgentProvider>,
        );
      });
    };
    const openFirstThread = async () => {
      await act(async () => {
        document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click();
      });
    };

    const openCardMenu = async () => {
      const moreActions = document.querySelector<HTMLButtonElement>(
        'button[aria-label="review.moreActions"]',
      );
      await act(async () => {
        moreActions?.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        );
        moreActions?.click();
      });
    };
    const menuLayout = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="separator"]',
        ),
      ).map((item) =>
        item.getAttribute("role") === "separator"
          ? "---"
          : item.textContent?.trim(),
      );
    const menuItem = (label: string) =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item) => item.textContent?.trim() === label);

    it("titles the thread card and lists the agent menu in the Figma order for an editor on an open thread", async () => {
      mocks.discussion.canSetThreadPreferences = true;
      await renderPins(
        {
          currentUserEmail: "reviewer@example.com",
          onSendThreadToAgent: vi.fn(),
        },
        makeAgentController(),
      );
      await openFirstThread();

      const card = document.querySelector<HTMLElement>(
        "[data-review-thread-card]",
      );
      expect(card?.closest("[data-review-popover]")).not.toBeNull();
      expect(card?.textContent).toContain("review.threadTitle");
      expect(
        card?.querySelector('button[aria-label="review.closeThread"]'),
      ).not.toBeNull();
      expect(
        card?.querySelector('button[aria-label="review.resolve"]'),
      ).not.toBeNull();

      await openCardMenu();
      expect(menuLayout()).toEqual([
        "review.sendToAgent",
        "review.suggestChanges",
        "review.replyInThread",
        "---",
        "review.applyChangesAndResolve",
        "---",
        "review.copyLink",
        "review.deleteThread",
      ]);
      // The author could edit and the viewer may set preferences, yet neither
      // item belongs in the card menu.
      expect(document.body.textContent).not.toContain("review.editComment");
      expect(document.body.textContent).not.toContain("review.markUnread");
      expect(document.body.textContent).not.toContain("review.markRead");
    });

    it("keeps the agent items away from viewers who cannot edit the design", async () => {
      await renderPins({
        canResolve: false,
        currentUserEmail: "reviewer@example.com",
        onSendThreadToAgent: vi.fn(),
      });
      await openFirstThread();
      await openCardMenu();
      expect(menuLayout()).toEqual(["review.copyLink", "review.deleteThread"]);
    });

    it("keeps the agent items away when the host offers no agent hand-off", async () => {
      await renderPins({ currentUserEmail: "reviewer@example.com" });
      await openFirstThread();
      await openCardMenu();
      expect(menuLayout()).toEqual(["review.copyLink", "review.deleteThread"]);
    });

    it("hides the agent items once the thread is resolved", async () => {
      reviewComments = [{ ...comment, status: "resolved" }];
      await renderPins({
        currentUserEmail: "reviewer@example.com",
        onSendThreadToAgent: vi.fn(),
      });
      await openFirstThread();
      await openCardMenu();
      expect(menuLayout()).toEqual(["review.copyLink", "review.deleteThread"]);
    });

    it("hands the thread and the chosen action to the host", async () => {
      const onSendThreadToAgent = vi.fn();
      await renderPins(
        {
          currentUserEmail: "reviewer@example.com",
          onSendThreadToAgent,
        },
        makeAgentController(),
      );
      await openFirstThread();
      const choices = [
        ["review.sendToAgent", "send"],
        ["review.suggestChanges", "suggest"],
        ["review.replyInThread", "reply"],
        ["review.applyChangesAndResolve", "apply"],
      ] as const;
      for (const [label, action] of choices) {
        await openCardMenu();
        await act(async () => menuItem(label)?.click());
        expect(onSendThreadToAgent).toHaveBeenLastCalledWith(
          expect.objectContaining({
            root: expect.objectContaining({ threadId: "thread-1" }),
          }),
          action,
        );
      }
      expect(onSendThreadToAgent).toHaveBeenCalledTimes(choices.length);
    });

    it("disables the agent items, but not Copy link, while a hand-off is in flight", async () => {
      const onSendThreadToAgent = vi.fn();
      await renderPins(
        {
          currentUserEmail: "reviewer@example.com",
          onSendThreadToAgent,
          sendingThreadId: "thread-1",
        },
        makeAgentController(),
      );
      await openFirstThread();
      await openCardMenu();
      const disabled = (label: string) =>
        menuItem(label)?.getAttribute("aria-disabled") === "true";
      expect(disabled("review.sendToAgent")).toBe(true);
      expect(disabled("review.suggestChanges")).toBe(true);
      expect(disabled("review.replyInThread")).toBe(true);
      expect(disabled("review.applyChangesAndResolve")).toBe(true);
      expect(disabled("review.copyLink")).toBe(false);
      await act(async () => menuItem("review.sendToAgent")?.click());
      expect(onSendThreadToAgent).not.toHaveBeenCalled();
    });

    it("ends the card with a collapsed-style reply row for the current user", async () => {
      await renderPins({ currentUserEmail: "reviewer@example.com" });
      await openFirstThread();
      const row = document
        .querySelector("[data-review-reply-input]")
        ?.closest("[data-review-test-composer]");
      expect(row?.getAttribute("data-review-test-composer")).toBe("reply");
      expect(
        row
          ?.querySelector("[data-review-reply-input]")
          ?.getAttribute("placeholder"),
      ).toBe("review.reply");
    });

    it("gives the draft card a title bar and no agent control", async () => {
      await renderPins({
        active: true,
        onDispatchCommentToAgent: vi.fn(),
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
      const card = document.querySelector<HTMLElement>(
        "[data-review-thread-card]",
      );
      expect(card?.textContent).toContain("review.threadTitle");
      expect(
        card?.querySelector('button[aria-label="designEditor.close"]'),
      ).not.toBeNull();
      expect(
        card?.querySelector('button[aria-label="review.moreActions"]'),
      ).toBeNull();
      expect(
        card?.querySelector('button[aria-label="review.resolve"]'),
      ).toBeNull();
      expect(
        card
          ?.querySelector("[data-review-test-composer]")
          ?.getAttribute("data-review-test-composer"),
      ).toBe("expanded");
      expect(
        document.querySelector("[data-review-test-agent-action]"),
      ).toBeNull();
      expect(document.body.textContent).not.toContain("review.sendToAgent");
    });

    it("reports the open thread id, and null once it closes or unmounts", async () => {
      const onActiveThreadChange = vi.fn();
      await renderPins({ onActiveThreadChange });
      expect(onActiveThreadChange).not.toHaveBeenCalled();

      await openFirstThread();
      expect(onActiveThreadChange).toHaveBeenLastCalledWith("thread-1");

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(onActiveThreadChange).toHaveBeenLastCalledWith(null);
      expect(onActiveThreadChange).toHaveBeenCalledTimes(2);

      await openFirstThread();
      expect(onActiveThreadChange).toHaveBeenLastCalledWith("thread-1");
      await act(async () => root.unmount());
      expect(onActiveThreadChange).toHaveBeenLastCalledWith(null);
      root = createRoot(container);
    });

    it("shows the Agent badge on an agent's reply", async () => {
      mocks.useRealThreads = true;
      reviewComments = [
        comment,
        makeReply({
          id: "reply-agent",
          createdBy: "agent",
          authorName: "Claude",
          authorEmail: null,
          body: "Done, the heading is bigger.",
        }),
      ];
      await renderPins();
      await openFirstThread();
      const reply = document.querySelector<HTMLElement>(
        '[data-review-comment="reply-agent"]',
      );
      expect(reply?.getAttribute("data-review-comment-variant")).toBe("reply");
      expect(reply?.textContent).toContain("Claude");
      expect(reply?.textContent).toContain("review.agentBadge");
      expect(reply?.textContent).toContain("Done, the heading is bigger.");
    });

    describe("agent runs", () => {
      const savedComment = (overrides: Partial<ReviewComment> = {}) => ({
        ...comment,
        id: "comment-new",
        threadId: "thread-new",
        ...overrides,
      });
      const click = (selector: string) =>
        act(async () => {
          document.querySelector<HTMLElement>(selector)?.click();
        });
      const openDraftComposer = async () => {
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
      };
      const succeed = (
        mutate: typeof mocks.createMutate,
        saved: ReviewComment,
      ) =>
        act(async () => {
          const handlers = mutate.mock.calls[0]?.[1] as
            | { onSuccess?: (comment: ReviewComment) => void }
            | undefined;
          handlers?.onSuccess?.(saved);
        });
      const mentionOptionLabels = () =>
        Array.from(
          document.querySelectorAll("[data-review-test-mention-options]"),
        ).map((node) => node.textContent);
      const statusRow = () =>
        document.querySelector<HTMLElement>("[data-review-agent-status]");

      describe("composer and submit", () => {
        it("offers the connected models in the picker, under the Agents heading, after the people", async () => {
          mocks.useRealComposer = false;
          await renderPins({ active: true }, makeAgentController());
          await openDraftComposer();
          expect(mentionOptionLabels()).toEqual(["Claude Sonnet 5.5"]);
          expect(
            document.querySelector("[data-review-test-agents-label]")
              ?.textContent,
          ).toBe("review.agent.sectionLabel");
        });

        it("lists the people before the agents", async () => {
          mocks.useRealComposer = true;
          await renderPins({ active: true }, makeAgentController());
          await openDraftComposer();
          const editor = document.querySelector<
            HTMLElement & { editor: Editor }
          >('[data-review-popover] [role="textbox"]');
          expect(editor).not.toBeNull();
          await act(async () => {
            editor?.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "@",
                bubbles: true,
                cancelable: true,
              }),
            );
          });
          const items = Array.from(
            document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
          ).map((item) => item.textContent);
          const alice = items.findIndex((text) => text?.includes("Alice"));
          const claude = items.findIndex((text) =>
            text?.includes("Claude Sonnet 5.5"),
          );
          expect(alice).toBeGreaterThanOrEqual(0);
          expect(claude).toBeGreaterThan(alice);
          expect(document.body.textContent).toContain(
            "review.agent.sectionLabel",
          );
        });

        it("offers no agents without a controller, or to someone who cannot edit", async () => {
          await renderPins({ active: true });
          await openDraftComposer();
          expect(mentionOptionLabels()).toEqual([""]);
          expect(
            document.querySelector("[data-review-test-agent-mention]"),
          ).not.toBeNull();
          await act(async () => root.unmount());
          root = createRoot(container);

          await renderPins(
            { active: true, canResolve: false },
            makeAgentController(),
          );
          await openDraftComposer();
          expect(mentionOptionLabels()).toEqual([""]);
        });

        it("starts an automatic run for a new thread only after the comment is saved", async () => {
          await renderPins({ active: true }, makeAgentController());
          await openDraftComposer();
          await click("[data-review-test-agent-mention]");
          await click("[data-review-test-submit]");

          expect(mocks.createMutate.mock.calls[0]?.[0]).toMatchObject({
            body: "@Claude Sonnet 5.5 make it bigger",
            mentions: [
              {
                label: "Claude Sonnet 5.5",
                id: "agent:anthropic:claude-sonnet-5-5",
              },
            ],
          });
          expect(mocks.agentStart).not.toHaveBeenCalled();

          await succeed(mocks.createMutate, savedComment());
          expect(mocks.agentStart).toHaveBeenCalledExactlyOnceWith({
            threadId: "thread-new",
            mode: "auto",
            triggerCommentId: "comment-new",
            selection: SONNET,
          });
        });

        it("does not start a run when the comment fails to save", async () => {
          await renderPins({ active: true }, makeAgentController());
          await openDraftComposer();
          await click("[data-review-test-agent-mention]");
          await click("[data-review-test-submit]");
          await act(async () => {
            const handlers = mocks.createMutate.mock.calls[0]?.[1] as
              | { onError?: () => void }
              | undefined;
            handlers?.onError?.();
          });
          expect(mocks.agentStart).not.toHaveBeenCalled();
          expect(mocks.toastError).toHaveBeenCalledWith("review.postFailed");
        });

        it("starts no run for a comment that mentions only people", async () => {
          await renderPins({ active: true }, makeAgentController());
          await openDraftComposer();
          await click("[data-review-test-mention]");
          await click("[data-review-test-submit]");
          await succeed(mocks.createMutate, savedComment());
          expect(mocks.agentStart).not.toHaveBeenCalled();
        });

        it("starts a run for a reply with an agent chip, keyed to the reply", async () => {
          await renderPins({}, makeAgentController());
          await openFirstThread();
          await click(
            '[data-review-test-composer="reply"] [data-review-test-agent-mention]',
          );
          await click(
            '[data-review-test-composer="reply"] [data-review-test-submit]',
          );

          expect(mocks.replyMutate.mock.calls[0]?.[0]).toMatchObject({
            commentId: "comment-1",
            mentions: [{ id: "agent:anthropic:claude-sonnet-5-5" }],
          });
          expect(mocks.agentStart).not.toHaveBeenCalled();

          await succeed(
            mocks.replyMutate,
            savedComment({ id: "reply-new", threadId: "thread-1" }),
          );
          expect(mocks.agentStart).toHaveBeenCalledExactlyOnceWith({
            threadId: "thread-1",
            mode: "auto",
            triggerCommentId: "reply-new",
            selection: SONNET,
          });
        });

        it("starts no run for a reply without an agent chip", async () => {
          await renderPins({}, makeAgentController());
          await openFirstThread();
          await click(
            '[data-review-test-composer="reply"] [data-review-test-type]',
          );
          await click(
            '[data-review-test-composer="reply"] [data-review-test-submit]',
          );
          await succeed(mocks.replyMutate, savedComment({ id: "reply-new" }));
          expect(mocks.agentStart).not.toHaveBeenCalled();
        });

        it("starts no run for a commenter even when the comment carries an agent chip", async () => {
          await renderPins({ canResolve: false }, makeAgentController());
          await openFirstThread();
          await click(
            '[data-review-test-composer="reply"] [data-review-test-agent-mention]',
          );
          await click(
            '[data-review-test-composer="reply"] [data-review-test-submit]',
          );
          await succeed(mocks.replyMutate, savedComment({ id: "reply-new" }));
          expect(mocks.agentStart).not.toHaveBeenCalled();
        });

        it("tells the person when the chip's model is no longer connected, and starts nothing", async () => {
          await renderPins(
            {},
            makeAgentController({ resolveMention: () => null }),
          );
          await openFirstThread();
          await click(
            '[data-review-test-composer="reply"] [data-review-test-agent-mention]',
          );
          await click(
            '[data-review-test-composer="reply"] [data-review-test-submit]',
          );
          await succeed(mocks.replyMutate, savedComment({ id: "reply-new" }));
          expect(mocks.agentStart).not.toHaveBeenCalled();
          expect(mocks.toastError).toHaveBeenCalledWith(
            "review.agent.startFailed",
          );
        });
      });

      describe("card menu", () => {
        const itemLabels = [
          "review.sendToAgent",
          "review.suggestChanges",
          "review.replyInThread",
          "review.applyChangesAndResolve",
        ];
        const agentItems = () =>
          menuLayout().filter((label) => itemLabels.includes(label ?? ""));

        it("offers every item to an editor on an inline screen's thread", async () => {
          await renderPins(
            {
              currentUserEmail: "reviewer@example.com",
              onSendThreadToAgent: vi.fn(),
              sourceType: "inline",
            },
            makeAgentController(),
          );
          await openFirstThread();
          await openCardMenu();
          expect(agentItems()).toEqual(itemLabels);
        });

        it("keeps only Send to agent without a controller", async () => {
          await renderPins({
            currentUserEmail: "reviewer@example.com",
            onSendThreadToAgent: vi.fn(),
          });
          await openFirstThread();
          await openCardMenu();
          expect(agentItems()).toEqual(["review.sendToAgent"]);
        });

        it("keeps only Send to agent when the controller is not enabled for this person", async () => {
          await renderPins(
            {
              currentUserEmail: "reviewer@example.com",
              onSendThreadToAgent: vi.fn(),
            },
            makeAgentController({ enabled: false }),
          );
          await openFirstThread();
          await openCardMenu();
          expect(agentItems()).toEqual(["review.sendToAgent"]);
        });

        it.each([
          ["a localhost screen", { sourceType: "localhost" as const }],
          ["a fusion screen", { sourceType: "fusion" as const }],
        ])(
          "hides Apply for %s but keeps Suggest and Reply",
          async (_name, props) => {
            await renderPins(
              {
                currentUserEmail: "reviewer@example.com",
                onSendThreadToAgent: vi.fn(),
                ...props,
              },
              makeAgentController(),
            );
            await openFirstThread();
            await openCardMenu();
            expect(agentItems()).toEqual([
              "review.sendToAgent",
              "review.suggestChanges",
              "review.replyInThread",
            ]);
          },
        );

        it("hides Apply for a board-level thread", async () => {
          reviewComments = [{ ...comment, targetId: null }];
          await renderPins(
            {
              currentUserEmail: "reviewer@example.com",
              onSendThreadToAgent: vi.fn(),
              targetId: null,
            },
            makeAgentController(),
          );
          await openFirstThread();
          await openCardMenu();
          expect(agentItems()).toEqual([
            "review.sendToAgent",
            "review.suggestChanges",
            "review.replyInThread",
          ]);
        });

        it("hands each choice to the host: the three run modes and Send to agent", async () => {
          const onSendThreadToAgent = vi.fn();
          await renderPins(
            { currentUserEmail: "reviewer@example.com", onSendThreadToAgent },
            makeAgentController(),
          );
          await openFirstThread();
          const choices = [
            ["review.suggestChanges", "suggest"],
            ["review.replyInThread", "reply"],
            ["review.applyChangesAndResolve", "apply"],
            ["review.sendToAgent", "send"],
          ] as const;
          for (const [label, action] of choices) {
            await openCardMenu();
            await act(async () => menuItem(label)?.click());
            expect(onSendThreadToAgent).toHaveBeenLastCalledWith(
              expect.objectContaining({
                root: expect.objectContaining({ threadId: "thread-1" }),
              }),
              action,
            );
          }
          // The host starts the run; the card itself never starts one from the menu.
          expect(mocks.agentStart).not.toHaveBeenCalled();
        });

        it("disables the agent items while an agent works on the thread, but not Copy link", async () => {
          const onSendThreadToAgent = vi.fn();
          await renderPins(
            { currentUserEmail: "reviewer@example.com", onSendThreadToAgent },
            makeAgentController({
              isThreadBusy: (threadId) => threadId === "thread-1",
            }),
          );
          await openFirstThread();
          await openCardMenu();
          const disabled = (label: string) =>
            menuItem(label)?.getAttribute("aria-disabled") === "true";
          for (const label of itemLabels) expect(disabled(label)).toBe(true);
          expect(disabled("review.copyLink")).toBe(false);
          await act(async () => menuItem("review.suggestChanges")?.click());
          expect(onSendThreadToAgent).not.toHaveBeenCalled();
        });

        it("leaves the items enabled when the agent works on another thread", async () => {
          await renderPins(
            {
              currentUserEmail: "reviewer@example.com",
              onSendThreadToAgent: vi.fn(),
            },
            makeAgentController({
              isThreadBusy: (threadId) => threadId === "thread-2",
            }),
          );
          await openFirstThread();
          await openCardMenu();
          expect(
            menuItem("review.suggestChanges")?.getAttribute("aria-disabled"),
          ).not.toBe("true");
        });
      });

      describe("status row", () => {
        const recent = () =>
          new Date(REVIEW_AGENT_TEST_NOW - 5_000).toISOString();

        beforeEach(() => {
          vi.useFakeTimers({ toFake: ["Date"] });
          vi.setSystemTime(REVIEW_AGENT_TEST_NOW);
        });
        afterEach(() => {
          vi.useRealTimers();
        });

        it("shows the run's status in the card, between the comments and the reply box", async () => {
          const request = makeReviewAgentRequest({
            status: "running",
            updatedAt: recent(),
          });
          await renderPins(
            {},
            makeAgentController({ requestForThread: () => request }),
          );
          await openFirstThread();
          const row = statusRow();
          expect(row?.getAttribute("data-review-agent-status")).toBe("running");
          expect(row?.textContent).toContain("review.agent.working");
          const card = document.querySelector("[data-review-thread-card]");
          const nodes = Array.from(card?.querySelectorAll("*") ?? []);
          const comments = card?.querySelector(
            '[data-review-comment="comment-1"]',
          );
          const reply = card?.querySelector("[data-review-test-composer]");
          expect(comments && row && reply).toBeTruthy();
          expect(nodes.indexOf(row as Element)).toBeGreaterThan(
            nodes.indexOf(comments as Element),
          );
          expect(nodes.indexOf(row as Element)).toBeLessThan(
            nodes.indexOf(reply as Element),
          );
        });

        it("shows nothing when the thread has no run, or there is no controller", async () => {
          await renderPins({}, makeAgentController());
          await openFirstThread();
          expect(statusRow()).toBeNull();
          await act(async () => root.unmount());
          root = createRoot(container);

          await renderPins({});
          await openFirstThread();
          expect(statusRow()).toBeNull();
        });

        it("acknowledges a start at once, before the request exists", async () => {
          await renderPins(
            {},
            makeAgentController({
              startingThreadIds: new Set(["thread-1"]),
              startingAgentName: () => "Claude Sonnet 5.5",
            }),
          );
          await openFirstThread();
          expect(statusRow()?.getAttribute("data-review-agent-status")).toBe(
            "starting",
          );
        });

        it("wires Open chat and Cancel to the controller with the request", async () => {
          const request = makeReviewAgentRequest({
            status: "running",
            updatedAt: recent(),
          });
          await renderPins(
            {},
            makeAgentController({ requestForThread: () => request }),
          );
          await openFirstThread();
          const press = (label: string) =>
            act(async () =>
              Array.from(statusRow()?.querySelectorAll("button") ?? [])
                .find((button) => button.textContent === label)
                ?.click(),
            );
          await press("review.agent.openChat");
          expect(mocks.agentOpen).toHaveBeenCalledExactlyOnceWith(request);
          await press("review.agent.cancel");
          expect(mocks.agentStop).toHaveBeenCalledExactlyOnceWith(request);
        });

        it("wires Try again to the controller for a failed run", async () => {
          const request = makeReviewAgentRequest({
            status: "failed",
            errorCode: "run_failed",
            updatedAt: recent(),
          });
          await renderPins(
            {},
            makeAgentController({ requestForThread: () => request }),
          );
          await openFirstThread();
          await act(async () =>
            Array.from(statusRow()?.querySelectorAll("button") ?? [])
              .find((button) => button.textContent === "review.agent.retry")
              ?.click(),
          );
          expect(mocks.agentRetry).toHaveBeenCalledExactlyOnceWith(request);
        });

        it("disables Cancel while that request's stop is in flight", async () => {
          const request = makeReviewAgentRequest({
            status: "running",
            updatedAt: recent(),
          });
          await renderPins(
            {},
            makeAgentController({
              requestForThread: () => request,
              stoppingRequestIds: new Set([request.requestId]),
            }),
          );
          await openFirstThread();
          const cancel = Array.from(
            statusRow()?.querySelectorAll("button") ?? [],
          ).find((button) => button.textContent === "review.agent.cancel");
          expect(cancel?.disabled).toBe(true);
        });

        it("keeps the status on a resolved thread too, where the reply box is gone", async () => {
          reviewComments = [{ ...comment, status: "resolved" }];
          const request = makeReviewAgentRequest({
            status: "applied",
            updatedAt: recent(),
          });
          await renderPins(
            {},
            makeAgentController({ requestForThread: () => request }),
          );
          await openFirstThread();
          expect(statusRow()?.textContent).toContain("review.agent.applied");
        });
      });

      describe("model list", () => {
        it("asks for the model list once a comment surface is open, and not before", async () => {
          await renderPins({ active: false }, makeAgentController());
          expect(mocks.agentMarkSurfaceUsed).not.toHaveBeenCalled();

          await openFirstThread();
          expect(mocks.agentMarkSurfaceUsed).toHaveBeenCalled();
        });

        it("asks for it while comment mode is on", async () => {
          await renderPins({ active: true }, makeAgentController());
          expect(mocks.agentMarkSurfaceUsed).toHaveBeenCalled();
        });

        it("does not ask for it while the comments are hidden, or without agent access", async () => {
          await renderPins(
            { active: true, hidden: true },
            makeAgentController(),
          );
          expect(mocks.agentMarkSurfaceUsed).not.toHaveBeenCalled();
          await renderPins(
            { active: true, canResolve: false },
            makeAgentController(),
          );
          expect(mocks.agentMarkSurfaceUsed).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe("editor chrome and hidden comments", () => {
    const chrome: HTMLElement[] = [];
    const addChrome = (
      attribute: string,
      rect: { left: number; top: number; right: number; bottom: number },
    ) => {
      const element = document.createElement("div");
      const [name, value = ""] = attribute.split("=");
      element.setAttribute(name!, value);
      element.getBoundingClientRect = () =>
        ({
          ...rect,
          x: rect.left,
          y: rect.top,
          width: rect.right - rect.left,
          height: rect.bottom - rect.top,
          toJSON: () => ({}),
        }) as DOMRect;
      document.body.appendChild(element);
      chrome.push(element);
    };
    const commentAt = (id: number, xPct: number, yPct: number) => ({
      ...comment,
      id: `comment-${id}`,
      threadId: `thread-${id}`,
      anchor: { point: { xPct, yPct } },
    });
    const renderPins = async (props: { active?: boolean; hidden?: boolean }) =>
      act(async () => {
        root.render(
          <ReviewCanvasPins
            active={props.active ?? false}
            hidden={props.hidden}
            onClose={vi.fn()}
            canvasSelector=".review-test-canvas"
            resourceType="design"
            resourceId="design-1"
            targetId="screen-1"
            screenId="screen-1"
            canPost
            canResolve
          />,
        );
      });
    const pinLabels = () =>
      [...document.querySelectorAll("[data-review-pin]")].map((pin) =>
        pin.getAttribute("aria-label"),
      );

    afterEach(() => {
      chrome.splice(0).forEach((element) => element.remove());
    });

    it("renders no pins, thread popover or placement plane while hidden", async () => {
      await renderPins({ active: true });
      await act(async () =>
        document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click(),
      );
      expect(document.body.textContent).toContain("Keep this popover open");
      expect(
        document.querySelector("[data-review-click-plane]"),
      ).not.toBeNull();

      await renderPins({ active: true, hidden: true });

      expect(document.querySelector("[data-review-pin]")).toBeNull();
      expect(document.querySelector("[data-review-pin-cluster]")).toBeNull();
      expect(document.querySelector("[data-review-popover]")).toBeNull();
      expect(document.querySelector("[data-review-click-plane]")).toBeNull();
      expect(document.body.textContent).not.toContain("Keep this popover open");
    });

    // The canvas is 800x600 at the origin, so an anchor of (xPct, yPct) sits
    // at (8 * xPct, 6 * yPct) in the viewport; the in-view pin is at (400, 300).
    it.each([
      {
        name: "the left panel",
        attribute: "data-design-chrome-region=left-shell",
        rect: { left: 0, top: 0, right: 300, bottom: 768 },
        covered: { xPct: 25, yPct: 30 },
      },
      {
        name: "the top bar",
        attribute: "data-design-chrome-region=top-bar",
        rect: { left: 0, top: 0, right: 1024, bottom: 48 },
        covered: { xPct: 50, yPct: 5 },
      },
      {
        name: "the inspector",
        attribute: "data-design-chrome-region=right-panel",
        rect: { left: 650, top: 0, right: 1024, bottom: 768 },
        covered: { xPct: 90, yPct: 50 },
      },
      {
        name: "the bottom toolbar",
        attribute: "data-design-bottom-toolbar=",
        rect: { left: 250, top: 520, right: 550, bottom: 580 },
        covered: { xPct: 50, yPct: 94 },
      },
    ])(
      "does not render a pin anchored under $name",
      async ({ attribute, rect, covered }) => {
        addChrome(attribute, rect);
        reviewComments = [
          commentAt(1, 50, 50),
          commentAt(2, covered.xPct, covered.yPct),
        ];
        await renderPins({});

        expect(pinLabels()).toEqual(["Comment thread with 1 comment"]);
      },
    );

    it("renders every pin that sits inside the working area", async () => {
      addChrome("data-design-chrome-region=left-shell", {
        left: 0,
        top: 0,
        right: 200,
        bottom: 768,
      });
      reviewComments = [commentAt(1, 30, 30), commentAt(2, 60, 60)];
      await renderPins({});

      expect(pinLabels()).toEqual([
        "Comment thread with 1 comment",
        "Comment thread with 1 comment",
      ]);
    });

    it("renders only the in-view pin when an earlier pin is off the working area", async () => {
      addChrome("data-design-chrome-region=left-shell", {
        left: 0,
        top: 0,
        right: 300,
        bottom: 768,
      });
      reviewComments = [commentAt(1, 25, 30), commentAt(2, 60, 30)];
      await renderPins({});

      expect(pinLabels()).toEqual(["Comment thread with 1 comment"]);
      const wrapper =
        document.querySelector<HTMLElement>("[data-review-pin]")?.parentElement;
      expect(Number.parseFloat(wrapper?.style.left ?? "")).toBeGreaterThan(300);
    });

    it("renders a cluster in view and none for pins under chrome", async () => {
      addChrome("data-design-chrome-region=left-shell", {
        left: 0,
        top: 0,
        right: 300,
        bottom: 768,
      });
      reviewComments = [
        commentAt(1, 25, 30),
        commentAt(2, 26, 30),
        commentAt(3, 70, 30),
        commentAt(4, 71, 30),
      ];
      await renderPins({});

      expect(
        document.querySelectorAll("[data-review-pin-cluster]"),
      ).toHaveLength(1);
      expect(document.querySelector("[data-review-pin]")).toBeNull();
    });

    it("clips the layer to the area chrome leaves and keeps an open thread inside it", async () => {
      addChrome("data-design-chrome-region=left-shell", {
        left: 0,
        top: 0,
        right: 300,
        bottom: 768,
      });
      addChrome("data-design-chrome-region=right-panel", {
        left: 800,
        top: 0,
        right: 1024,
        bottom: 768,
      });
      // The pin is at x=500: a 360px popover opening right would end at 872.
      reviewComments = [commentAt(1, 62.5, 30)];
      await renderPins({});
      await act(async () =>
        document.querySelector<HTMLButtonElement>("[data-review-pin]")?.click(),
      );

      expect(
        document.querySelector<HTMLElement>("[data-review-layer]")?.style
          .clipPath,
      ).toBe("polygon(300px 0px, 800px 0px, 800px 768px, 300px 768px)");
      const popover = document.querySelector<HTMLElement>(
        "[data-review-popover] [data-review-popover]",
      );
      expect(popover).not.toBeNull();
      const left = 500 + Number.parseFloat(popover!.style.left);
      const width = Number.parseFloat(popover!.style.width);
      expect(left).toBeGreaterThanOrEqual(300);
      expect(left + width).toBeLessThanOrEqual(800);
    });

    describe("popovers beside the bottom toolbar", () => {
      // happy-dom does no layout, so give an open popover a content height.
      const POPOVER_HEIGHT = 200;
      const TOOLBAR = { left: 250, top: 520, right: 550, bottom: 580 };
      const scrollHeight = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        "scrollHeight",
      );

      beforeEach(() => {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
          configurable: true,
          get(this: HTMLElement) {
            return this.hasAttribute("data-review-popover") &&
              this.parentElement?.hasAttribute("data-review-popover")
              ? POPOVER_HEIGHT
              : 0;
          },
        });
        addChrome("data-design-bottom-toolbar=", TOOLBAR);
      });

      afterEach(() => {
        if (scrollHeight) {
          Object.defineProperty(
            HTMLElement.prototype,
            "scrollHeight",
            scrollHeight,
          );
        } else {
          Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
        }
      });

      // The canvas is 800x600 and the viewport region 1024x768, so a pin at
      // (xPct, yPct) sits at (8 * xPct, 6 * yPct).
      const openPopoverRect = (pin: { x: number; y: number }) => {
        const popover = document.querySelector<HTMLElement>(
          "[data-review-popover] [data-review-popover]",
        );
        expect(popover).not.toBeNull();
        const top = pin.y + Number.parseFloat(popover!.style.top);
        const maxHeight = Number.parseFloat(popover!.style.maxHeight);
        return {
          left: pin.x + Number.parseFloat(popover!.style.left),
          right:
            pin.x +
            Number.parseFloat(popover!.style.left) +
            Number.parseFloat(popover!.style.width),
          top,
          bottom: top + Math.min(POPOVER_HEIGHT, maxHeight),
        };
      };
      const clearsToolbar = (rect: {
        left: number;
        right: number;
        bottom: number;
      }) =>
        rect.right <= TOOLBAR.left ||
        rect.left >= TOOLBAR.right ||
        rect.bottom <= TOOLBAR.top;

      it("opens a thread above a pin whose below placement would run into the toolbar", async () => {
        reviewComments = [commentAt(1, 40, 78)];
        await renderPins({});
        await act(async () =>
          document
            .querySelector<HTMLButtonElement>("[data-review-pin]")
            ?.click(),
        );

        // Below would span y 472..672: inside the viewport, but through the
        // toolbar that starts at 520. The whole box has to stay above it.
        const rect = openPopoverRect({ x: 320, y: 468 });
        expect(rect.bottom).toBeLessThanOrEqual(TOOLBAR.top);
        expect(rect.top).toBeGreaterThanOrEqual(0);
        expect(clearsToolbar(rect)).toBe(true);
      });

      it("opens a draft composer above a pin whose below placement would run into the toolbar", async () => {
        await renderPins({ active: true });
        await act(async () =>
          document
            .querySelector<HTMLElement>("[data-review-click-plane]")
            ?.dispatchEvent(
              new MouseEvent("click", {
                bubbles: true,
                clientX: 320,
                clientY: 468,
              }),
            ),
        );

        expect(
          document.querySelector("[data-review-test-textarea]"),
        ).not.toBeNull();
        const rect = openPopoverRect({ x: 320, y: 468 });
        expect(rect.bottom).toBeLessThanOrEqual(TOOLBAR.top);
        expect(rect.top).toBeGreaterThanOrEqual(0);
        expect(clearsToolbar(rect)).toBe(true);
      });

      it("keeps a thread popover below a pin that is far from the toolbar", async () => {
        reviewComments = [commentAt(1, 40, 30)];
        await renderPins({});
        await act(async () =>
          document
            .querySelector<HTMLButtonElement>("[data-review-pin]")
            ?.click(),
        );

        const popover = document.querySelector<HTMLElement>(
          "[data-review-popover] [data-review-popover]",
        );
        expect(popover?.style.top).toBe("4px");
        expect(popover?.style.left).toBe("12px");
      });

      it("keeps a draft composer below a pin that is far from the toolbar", async () => {
        await renderPins({ active: true });
        await act(async () =>
          document
            .querySelector<HTMLElement>("[data-review-click-plane]")
            ?.dispatchEvent(
              new MouseEvent("click", {
                bubbles: true,
                clientX: 320,
                clientY: 180,
              }),
            ),
        );

        const popover = document.querySelector<HTMLElement>(
          "[data-review-popover] [data-review-popover]",
        );
        expect(popover?.style.top).toBe("4px");
        expect(popover?.style.left).toBe("12px");
      });
    });
  });
});
