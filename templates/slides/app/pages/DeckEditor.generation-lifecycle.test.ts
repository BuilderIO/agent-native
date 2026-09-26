import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Deck } from "@/context/DeckContext";

import {
  refreshDeckForGenerationOutcome,
  resolveGenerationAttemptId,
} from "./DeckEditor";

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

describe("generation attempt URL fallback", () => {
  it("uses a validated persisted id before the query fallback", () => {
    expect(resolveGenerationAttemptId("persisted_attempt-1", "query-2")).toBe(
      "persisted_attempt-1",
    );
  });

  it("accepts a query fallback only when this deck issued that attempt", () => {
    expect(resolveGenerationAttemptId(undefined, "query_attempt-2", true)).toBe(
      "query_attempt-2",
    );
    expect(resolveGenerationAttemptId(undefined, "query_attempt-2")).toBeNull();
  });

  it("rejects a syntactically valid query without a same-deck registry match", () => {
    expect(
      resolveGenerationAttemptId(undefined, "query_attempt-2", false),
    ).toBe(null);
  });

  it.each(["bad id", "x".repeat(65), "éclair", ""])(
    "rejects malformed query fallback %j",
    (queryValue) => {
      expect(resolveGenerationAttemptId(undefined, queryValue)).toBeNull();
    },
  );
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

  it("reports editor exit as nonterminal UI telemetry and preserves the attempt", () => {
    const recordExitStart = deckEditorSource.indexOf("const recordExit = (");
    const recordExitEnd = deckEditorSource.indexOf(
      "const handlePageHide =",
      recordExitStart,
    );
    const recordExitBody = deckEditorSource.slice(
      recordExitStart,
      recordExitEnd,
    );

    expect(recordExitBody).toContain('trackEvent("generation_ui_exited", {');
    expect(recordExitBody).toContain("exit_reason: exitReason");
    expect(recordExitBody).toContain("exit_stage: exitStage");
    expect(recordExitBody).not.toContain(
      "generationTerminalAttemptRef.current = generationAttemptId;",
    );
    expect(recordExitBody).not.toContain("clearStartedGenerationAttempt");
    expect(recordExitBody).not.toContain('trackEvent("generation_abandoned"');
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

  it("deduplicates pagehide and route-exit signals without marking terminal", () => {
    const recordExitStart = deckEditorSource.indexOf("const recordExit = (");
    const recordExitEnd = deckEditorSource.indexOf(
      "const handlePageHide =",
      recordExitStart,
    );
    const recordExitBody = deckEditorSource.slice(
      recordExitStart,
      recordExitEnd,
    );

    expect(recordExitBody).toContain(
      "generationUiExitAttemptRef.current === generationAttemptId",
    );
    expect(recordExitBody).toContain(
      "generationUiExitAttemptRef.current = generationAttemptId;",
    );
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
