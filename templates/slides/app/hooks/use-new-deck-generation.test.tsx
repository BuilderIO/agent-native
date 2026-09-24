// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NEW_DECK_GENERATION_START_TIMEOUT_MS,
  shouldClearNewDeckGeneratingState,
  shouldShowNewDeckGeneratingOverlay,
} from "@/lib/generation-state";

import { useNewDeckGeneration } from "./use-new-deck-generation";

describe("useNewDeckGeneration", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
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
});
