import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Deck } from "@/context/DeckContext";

import { refreshDeckForGenerationOutcome } from "./DeckEditor";

const deckEditorSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "DeckEditor.tsx"),
  "utf8",
);

afterEach(() => vi.useRealTimers());

describe("generation deck refresh", () => {
  it("retries a null refresh and returns the refreshed deck", async () => {
    vi.useFakeTimers();
    const deck = { id: "deck-1" } as unknown as Deck;
    const refreshOpenDeck = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(deck);

    const result = refreshDeckForGenerationOutcome(refreshOpenDeck, "deck-1");
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toEqual({ status: "ready", deck });
    expect(refreshOpenDeck).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable for a rejected refresh", async () => {
    const refreshOpenDeck = vi
      .fn()
      .mockRejectedValue(new Error("refresh failed"));

    await expect(
      refreshDeckForGenerationOutcome(refreshOpenDeck, "deck-1"),
    ).resolves.toEqual({ status: "failed" });
  });

  it("returns unavailable when both refreshes return null", async () => {
    vi.useFakeTimers();
    const refreshOpenDeck = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = refreshDeckForGenerationOutcome(refreshOpenDeck, "deck-1");
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toEqual({ status: "not_ready" });
  });

  it("returns unavailable when the retry also rejects", async () => {
    vi.useFakeTimers();
    const refreshOpenDeck = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("refresh failed"));

    const result = refreshDeckForGenerationOutcome(refreshOpenDeck, "deck-1");
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toEqual({ status: "failed" });
  });
});

describe("generation outcome cleanup", () => {
  it("emits unresolved when refresh is unavailable and resets in finally", () => {
    const settleStart = deckEditorSource.indexOf(
      "generationSettlingAttemptRef.current = generationAttemptId;",
    );
    const settleEnd = deckEditorSource.indexOf("})();", settleStart);
    const settleBody = deckEditorSource.slice(settleStart, settleEnd);

    expect(settleStart).toBeGreaterThanOrEqual(0);
    expect(settleBody).toContain('if (refreshResult.status !== "ready")');
    expect(settleBody).toContain(
      'trackEvent("generation_outcome_unresolved", {',
    );
    expect(settleBody).toContain('"deck_refresh_failed"');
    expect(settleBody).toContain('"deck_not_visible_after_refresh"');
    expect(settleBody).toContain("} finally {");
    expect(settleBody).toContain(
      "clearStartedGenerationAttempt(generationAttemptId, id);",
    );
    expect(settleBody).toContain(
      "generationSettlingAttemptRef.current = null;",
    );
  });

  it("cleans up a submitted attempt on page exit before the run becomes active", () => {
    const recordExitStart = deckEditorSource.indexOf("const recordExit = (");
    const recordExitEnd = deckEditorSource.indexOf(
      "const handlePageHide =",
      recordExitStart,
    );
    const recordExitBody = deckEditorSource.slice(
      recordExitStart,
      recordExitEnd,
    );

    expect(recordExitBody).toContain("!state.sawActive");
    expect(recordExitBody).toContain("`${exitReason}_before_active`");
    expect(recordExitBody).toContain(
      "clearStartedGenerationAttempt(generationAttemptId, id);",
    );
    expect(recordExitBody).toContain(
      "generationRunStartedRef.current = false;",
    );
  });

  it("ignores a bfcache restore instead of treating it as a permanent exit", () => {
    const pageHideStart = deckEditorSource.indexOf(
      "const handlePageHide = (event: PageTransitionEvent) => {",
    );
    const guardReturn = deckEditorSource.indexOf("return;", pageHideStart);
    const guardBody = deckEditorSource.slice(pageHideStart, guardReturn);

    expect(pageHideStart).toBeGreaterThanOrEqual(0);
    expect(guardBody).toContain("event.persisted");
  });

  it("marks a started-but-not-submitted attempt terminal with a distinct exit reason", () => {
    const recordExitStart = deckEditorSource.indexOf("const recordExit = (");
    const recordExitEnd = deckEditorSource.indexOf(
      "const handlePageHide =",
      recordExitStart,
    );
    const recordExitBody = deckEditorSource.slice(
      recordExitStart,
      recordExitEnd,
    );

    const submitStartedIndex = recordExitBody.indexOf(
      "submitStarted: generationRunStartedRef.current,",
    );
    const terminalMarkIndex = recordExitBody.indexOf(
      "generationTerminalAttemptRef.current = generationAttemptId;",
      submitStartedIndex,
    );

    expect(submitStartedIndex).toBeGreaterThanOrEqual(0);
    expect(terminalMarkIndex).toBeGreaterThan(submitStartedIndex);
    expect(recordExitBody).toContain("`${exitReason}_before_submit`");
    expect(recordExitBody).toContain("!state.submitStarted");
  });
});

describe("new-deck generation signal wiring", () => {
  it("uses the attempt-scoped signal for progress, overlay, and URL cleanup", () => {
    const progressStart = deckEditorSource.indexOf(
      "const isNewDeckGenerating =",
    );
    const progressEnd = deckEditorSource.indexOf(
      "const fillingPlaceholderSlideId =",
      progressStart,
    );
    const progressBody = deckEditorSource.slice(progressStart, progressEnd);
    const lifecycleStart = deckEditorSource.indexOf("useNewDeckGeneration({");
    const lifecycleBody = deckEditorSource.slice(lifecycleStart, progressStart);
    const cleanupStart = deckEditorSource.indexOf(
      "shouldClearNewDeckGeneratingState({",
    );
    const cleanupEnd = deckEditorSource.indexOf("\n  }, [", cleanupStart);
    const cleanupBody = deckEditorSource.slice(cleanupStart, cleanupEnd);

    expect(deckEditorSource).toContain("} = useNewDeckGenerationSignal({");
    expect(deckEditorSource).toContain("tabId: generationAttemptTabId");
    expect(lifecycleBody).toContain("generating: newDeckGenerationSignal");
    expect(lifecycleBody).toContain(
      "waitingOnQuestions: waitingOnNewDeckQuestions",
    );
    expect(progressBody).toContain("generating: newDeckGenerationSignal");
    expect(progressBody).toContain("phase: newDeckGenerationPhase");
    expect(cleanupBody).toContain("generating: newDeckGenerationSignal");
    expect(cleanupBody).toContain(
      "waitingOnQuestions: waitingOnNewDeckQuestions",
    );
    expect(cleanupBody).toContain("phase: newDeckGenerationPhase");
    expect(cleanupBody).not.toContain("generating,");
  });
});
