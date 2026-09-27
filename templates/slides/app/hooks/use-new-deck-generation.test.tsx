// @vitest-environment happy-dom

import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import { createElement, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NEW_DECK_GENERATION_START_TIMEOUT_MS,
  shouldClearNewDeckGeneratingState,
  shouldShowNewDeckGeneratingOverlay,
} from "@/lib/generation-state";

import { CHAT_STOP_DEBOUNCE_MS } from "./use-agent-generating";
import {
  useNewDeckGeneration,
  useNewDeckGenerationRun,
} from "./use-new-deck-generation";

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChatAndConfirm: vi.fn(),
}));

describe("useNewDeckGeneration", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.mocked(sendToAgentChatAndConfirm).mockReset();
    vi.useRealTimers();
  });

  it("revives a timed-out route when its late run starts", () => {
    const initialProps = {
      deckId: "deck-a",
      isNewDeckRoute: true,
      generating: false,
      waitingOnQuestions: false,
    };
    const { result, rerender } = renderHook(
      (props) => useNewDeckGeneration(props),
      { initialProps },
    );

    act(() => {
      vi.advanceTimersByTime(NEW_DECK_GENERATION_START_TIMEOUT_MS);
    });
    expect(result.current.phase).toBe("abandoned");

    rerender({ ...initialProps, isNewDeckRoute: false, generating: true });
    expect(result.current.phase).toBe("started");
    expect(
      shouldClearNewDeckGeneratingState({
        generating: true,
        waitingOnQuestions: false,
        phase: result.current.phase,
      }),
    ).toBe(false);
    expect(
      shouldShowNewDeckGeneratingOverlay({
        generating: true,
        isNewDeckCreation: result.current.isNewDeckCreation,
        slideCount: 0,
        phase: result.current.phase,
      }),
    ).toBe(true);

    rerender({ ...initialProps, isNewDeckRoute: false, generating: false });
    expect(result.current.isNewDeckCreation).toBe(false);
  });

  it("resets lifecycle state on deck navigation and a new-generation route", () => {
    const { result, rerender } = renderHook(
      (props) => useNewDeckGeneration(props),
      {
        initialProps: {
          deckId: "deck-a",
          isNewDeckRoute: true,
          generating: true,
          waitingOnQuestions: false,
        },
      },
    );
    expect(result.current.phase).toBe("started");

    rerender({
      deckId: "deck-b",
      isNewDeckRoute: false,
      generating: false,
      waitingOnQuestions: false,
    });
    expect(result.current.phase).toBe("pending");
    expect(result.current.isNewDeckCreation).toBe(false);

    rerender({
      deckId: "deck-b",
      isNewDeckRoute: true,
      generating: false,
      waitingOnQuestions: false,
    });
    expect(result.current.phase).toBe("pending");
    expect(result.current.isNewDeckCreation).toBe(true);
  });

  it("revives only for the chat run correlated to this deck's submit", () => {
    const submitMessageId = `submit-deck-a-${Math.random()}`;
    const initialProps = {
      deckId: "deck-a",
      isNewDeckRoute: true,
      submitMessageId,
      waitingOnQuestions: false,
    };
    const { result } = renderHook(
      (props) => {
        const { generating } = useNewDeckGenerationRun(
          props.deckId,
          props.isNewDeckRoute,
          props.submitMessageId,
        );
        return {
          generating,
          ...useNewDeckGeneration({
            deckId: props.deckId,
            isNewDeckRoute: props.isNewDeckRoute,
            waitingOnQuestions: props.waitingOnQuestions,
            generating,
          }),
        };
      },
      { initialProps },
    );

    act(() => {
      vi.advanceTimersByTime(NEW_DECK_GENERATION_START_TIMEOUT_MS);
    });
    expect(result.current.phase).toBe("abandoned");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: { submitMessageId: "other-submit", tabId: "other-tab" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "other-tab" },
        }),
      );
    });
    expect(result.current.phase).toBe("abandoned");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: { submitMessageId, tabId: "deck-tab" },
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "other-tab" },
        }),
      );
    });
    expect(result.current.phase).toBe("abandoned");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "deck-tab" },
        }),
      );
    });
    expect(result.current.phase).toBe("started");
    expect(result.current.generating).toBe(true);
  });

  it("keeps run ownership through the guided-question pause and answer turn", () => {
    const submitMessageId = "submit-guided-questions";
    const initialProps = {
      deckId: "deck-guided-questions",
      isNewDeckRoute: true,
      submitMessageId,
      waitingOnQuestions: false,
    };
    const { result, rerender } = renderHook(
      (props) => {
        const generationRun = useNewDeckGenerationRun(
          props.deckId,
          props.isNewDeckRoute,
          props.submitMessageId,
        );
        const generating = generationRun.generating;
        return {
          generating,
          questionContinuationPending:
            generationRun.questionContinuationPending,
          expectQuestionContinuation: generationRun.expectQuestionContinuation,
          ...useNewDeckGeneration({
            deckId: props.deckId,
            isNewDeckRoute: props.isNewDeckRoute,
            waitingOnQuestions:
              props.waitingOnQuestions ||
              generationRun.questionContinuationPending,
            generating,
          }),
        };
      },
      { initialProps },
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: { submitMessageId, tabId: "guided-questions-tab" },
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "guided-questions-tab" },
        }),
      );
    });
    expect(result.current.phase).toBe("started");
    expect(result.current.isNewDeckCreation).toBe(true);

    rerender({ ...initialProps, waitingOnQuestions: true });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "guided-questions-tab" },
        }),
      );
      vi.advanceTimersByTime(CHAT_STOP_DEBOUNCE_MS);
    });

    expect(result.current.generating).toBe(false);
    expect(result.current.isNewDeckCreation).toBe(true);
    expect(
      shouldClearNewDeckGeneratingState({
        generating: false,
        waitingOnQuestions: true,
        phase: result.current.phase,
      }),
    ).toBe(false);

    act(() => {
      result.current.expectQuestionContinuation("answer-submit");
    });
    rerender({ ...initialProps, waitingOnQuestions: false });
    expect(result.current.questionContinuationPending).toBe(true);
    expect(
      shouldClearNewDeckGeneratingState({
        generating: false,
        waitingOnQuestions: result.current.questionContinuationPending,
        phase: result.current.phase,
      }),
    ).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: {
            submitMessageId: "answer-submit",
            tabId: "guided-questions-tab",
          },
        }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "guided-questions-tab" },
        }),
      );
    });
    expect(result.current.generating).toBe(true);
    expect(result.current.questionContinuationPending).toBe(false);
    expect(result.current.isNewDeckCreation).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: false, tabId: "guided-questions-tab" },
        }),
      );
      vi.advanceTimersByTime(CHAT_STOP_DEBOUNCE_MS);
    });
    expect(result.current.isNewDeckCreation).toBe(false);
    expect(
      shouldClearNewDeckGeneratingState({
        generating: false,
        waitingOnQuestions: false,
        phase: result.current.phase,
      }),
    ).toBe(true);
  });

  it.each(["answer", "skip"])(
    "targets the original generation tab for a guided-question %s",
    (choice) => {
      const initialProps = {
        deckId: `deck-guided-${choice}`,
        isNewDeckRoute: true,
        submitMessageId: `submit-guided-${choice}`,
      };
      const { result } = renderHook(() =>
        useNewDeckGenerationRun(
          initialProps.deckId,
          initialProps.isNewDeckRoute,
          initialProps.submitMessageId,
        ),
      );
      vi.mocked(sendToAgentChatAndConfirm).mockResolvedValue({
        tabId: "original-generation-tab",
        delivered: true,
      });

      act(() => {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitTarget", {
            detail: {
              submitMessageId: initialProps.submitMessageId,
              tabId: "original-generation-tab",
            },
          }),
        );
      });
      act(() => {
        result.current.submitQuestionContinuation({
          message: `Guided question ${choice}`,
          context: "Continue the original deck generation.",
        });
      });

      const [request, options] = vi.mocked(sendToAgentChatAndConfirm).mock
        .calls[0];
      expect(request).toMatchObject({
        message: `Guided question ${choice}`,
        context: "Continue the original deck generation.",
        chatTarget: "local",
        submit: true,
        targetTabId: "original-generation-tab",
      });
      expect(options).toMatchObject({ submitMessageId: expect.any(String) });
      const submitMessageId = options?.submitMessageId;
      expect(result.current.questionContinuationPending).toBe(true);

      act(() => {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitTarget", {
            detail: {
              submitMessageId,
              tabId: "original-generation-tab",
            },
          }),
        );
        window.dispatchEvent(
          new CustomEvent("agentNative.chatRunning", {
            detail: { isRunning: true, tabId: "original-generation-tab" },
          }),
        );
      });

      expect(result.current.questionContinuationPending).toBe(false);
    },
  );

  it("matches a synchronous continuation target event before React rerenders", async () => {
    const submitMessageId = "submit-sync-continuation";
    const { result } = renderHook(() =>
      useNewDeckGenerationRun("deck-sync-continuation", true, submitMessageId),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: { submitMessageId, tabId: "original-generation-tab" },
        }),
      );
    });
    vi.mocked(sendToAgentChatAndConfirm).mockImplementation(
      (request, options) => {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitTarget", {
            detail: {
              submitMessageId: options?.submitMessageId,
              tabId: "original-generation-tab",
            },
          }),
        );
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitResult", {
            detail: {
              submitMessageId: options?.submitMessageId,
              delivered: true,
            },
          }),
        );
        return Promise.resolve({
          tabId: request.targetTabId ?? "original-generation-tab",
          delivered: true,
        });
      },
    );

    let submission!: Promise<{ delivered: boolean }>;
    act(() => {
      submission = result.current.submitQuestionContinuation({
        message: "Here are my answers.",
        context: "Continue the original run.",
      });
    });
    expect(result.current.questionContinuationPending).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "original-generation-tab" },
        }),
      );
    });
    expect(result.current.questionContinuationPending).toBe(false);
    await act(async () => submission);
  });

  it("catches the run's first chatRunning event dispatched synchronously with its submit target", () => {
    const submitMessageId = "submit-sync-initial-running";
    const { result } = renderHook(() =>
      useNewDeckGenerationRun(
        "deck-sync-initial-running",
        true,
        submitMessageId,
      ),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: { submitMessageId, tabId: "generation-tab" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: { isRunning: true, tabId: "generation-tab" },
        }),
      );
    });

    expect(result.current.generating).toBe(true);
  });

  it("clears stored run identity when the deck route is left", async () => {
    const submitMessageId = "submit-leaving-route";
    const deckId = "deck-leaving-route";
    const storageKey = `slides:new-deck-generation:${deckId}:${submitMessageId}`;
    const initialProps: {
      deckId: string;
      isNewDeckRoute: boolean;
      submitMessageId: string | null;
    } = {
      deckId,
      isNewDeckRoute: true,
      submitMessageId,
    };
    const { rerender } = renderHook(
      (props) =>
        useNewDeckGenerationRun(
          props.deckId,
          props.isNewDeckRoute,
          props.submitMessageId,
        ),
      { initialProps },
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: { submitMessageId, tabId: "route-chat-tab" },
        }),
      );
    });
    expect(sessionStorage.getItem(storageKey)).toBe("route-chat-tab");

    rerender({
      deckId: "another-deck",
      isNewDeckRoute: false,
      submitMessageId: null,
    });
    await act(async () => Promise.resolve());
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("clears pending continuation state when targeted delivery is rejected", async () => {
    const submitMessageId = "submit-rejected-continuation";
    const { result } = renderHook(() =>
      useNewDeckGenerationRun(
        "deck-rejected-continuation",
        true,
        submitMessageId,
      ),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: { submitMessageId, tabId: "closed-generation-tab" },
        }),
      );
    });
    vi.mocked(sendToAgentChatAndConfirm).mockResolvedValue({
      tabId: "closed-generation-tab",
      delivered: false,
      reason: "target-tab-not-open",
    });

    let submission!: Promise<{ delivered: boolean }>;
    act(() => {
      submission = result.current.submitQuestionContinuation({
        message: "Here are my answers.",
        context: "Continue the original run.",
      });
    });
    await act(async () => submission);

    expect(result.current.questionContinuationPending).toBe(false);
  });

  it("captures the synchronous submit target in the flushSync route commit", () => {
    const deckId = "deck-sync-target";
    const submitMessageId = "submit-sync-target";
    const storageKey = `slides:new-deck-generation:${deckId}:${submitMessageId}`;
    const Route = () => {
      useNewDeckGenerationRun(deckId, true, submitMessageId);
      useLayoutEffect(() => {
        window.dispatchEvent(
          new CustomEvent("agentNative.chatSubmitTarget", {
            detail: { submitMessageId, tabId: "reused-empty-tab" },
          }),
        );
      }, []);
      return createElement("div");
    };
    const Harness = () => {
      const [onRoute, setOnRoute] = useState(false);
      const navigateAndSubmit = () => {
        flushSync(() => setOnRoute(true));
      };
      return onRoute
        ? createElement(Route)
        : createElement(
            "button",
            { onClick: navigateAndSubmit },
            "Create deck",
          );
    };

    const { getByRole } = render(createElement(Harness));
    fireEvent.click(getByRole("button", { name: "Create deck" }));

    expect(window.sessionStorage.getItem(storageKey)).toBe("reused-empty-tab");
  });

  it("retains the run mapping across a route unmount so browser-back can recover it", async () => {
    const submitMessageId = "submit-navigate-away";
    const deckId = "deck-navigate-away";
    const storageKey = `slides:new-deck-generation:${deckId}:${submitMessageId}`;
    const { unmount } = renderHook(() =>
      useNewDeckGenerationRun(deckId, true, submitMessageId),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatSubmitTarget", {
          detail: { submitMessageId, tabId: "still-running-tab" },
        }),
      );
    });

    unmount();
    await act(async () => Promise.resolve());

    expect(sessionStorage.getItem(storageKey)).toBe("still-running-tab");

    vi.mocked(sendToAgentChatAndConfirm).mockResolvedValue({
      tabId: "still-running-tab",
      delivered: true,
    });
    const { result } = renderHook(() =>
      useNewDeckGenerationRun(deckId, true, submitMessageId),
    );
    act(() => {
      result.current.submitQuestionContinuation({
        message: "Here are my answers.",
        context: "Continue the original run.",
      });
    });
    const [request] = vi.mocked(sendToAgentChatAndConfirm).mock.calls.at(-1)!;
    expect(request).toMatchObject({ targetTabId: "still-running-tab" });
  });
});
