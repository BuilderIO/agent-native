import { afterEach, describe, expect, it, vi } from "vitest";

import {
  flushMobileSlidesDeckSave,
  MobileDeckSaveFlushError,
  registerMobileSlidesWebView,
} from "./mobile-deck-save-bridge";

type FlushRequest = { requestId: string; deckId: string };

function flushRequestFromScript(script: string): FlushRequest | null {
  const detail = script.match(/detail:(\{.*\})\}\)\); true;$/)?.[1];
  return detail ? (JSON.parse(detail) as FlushRequest) : null;
}

function createAcknowledgingBridge(
  acknowledge: (request: FlushRequest) => Record<string, unknown>,
) {
  let bridge!: ReturnType<typeof registerMobileSlidesWebView>;
  bridge = registerMobileSlidesWebView((script) => {
    const request = flushRequestFromScript(script);
    if (!request) return;
    queueMicrotask(() =>
      bridge.receiveAck({
        type: "agentNative.mobileDeckSaveFlush.ack",
        ...acknowledge(request),
        requestId: request.requestId,
      }),
    );
  });
  return bridge;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("mobile Slides save bridge", () => {
  it("flushes only after a matching editor acknowledges the exact deck", async () => {
    const bridge = createAcknowledgingBridge((request) => ({
      requestedDeckId: request.deckId,
      activeDeckId: "deck-1",
      status: "flushed",
    }));

    try {
      await expect(
        flushMobileSlidesDeckSave("deck-1"),
      ).resolves.toBeUndefined();
    } finally {
      bridge.dispose();
    }
  });

  it("fails closed when no mounted Slides WebView can confirm the deck", async () => {
    await expect(flushMobileSlidesDeckSave("deck-1")).rejects.toBeInstanceOf(
      MobileDeckSaveFlushError,
    );
  });

  it("fails closed when a WebView has no matching deck route", async () => {
    const bridge = createAcknowledgingBridge((request) => ({
      requestedDeckId: request.deckId,
      activeDeckId: "another-deck",
      status: "not-target",
    }));

    try {
      await expect(flushMobileSlidesDeckSave("deck-1")).rejects.toBeInstanceOf(
        MobileDeckSaveFlushError,
      );
    } finally {
      bridge.dispose();
    }
  });

  it("fails closed on mismatched acknowledgements and flush errors", async () => {
    const wrongDeck = createAcknowledgingBridge(() => ({
      requestedDeckId: "other-deck",
      activeDeckId: "deck-1",
      status: "flushed",
    }));
    const failedFlush = createAcknowledgingBridge((request) => ({
      requestedDeckId: request.deckId,
      activeDeckId: "deck-1",
      status: "failed",
    }));

    try {
      await expect(flushMobileSlidesDeckSave("deck-1")).rejects.toBeInstanceOf(
        MobileDeckSaveFlushError,
      );
    } finally {
      wrongDeck.dispose();
      failedFlush.dispose();
    }
  });

  it("fails closed when the mounted editor never acknowledges", async () => {
    vi.useFakeTimers();
    const bridge = registerMobileSlidesWebView(() => {});
    const flush = flushMobileSlidesDeckSave("deck-1");
    const rejected = expect(flush).rejects.toBeInstanceOf(
      MobileDeckSaveFlushError,
    );
    await vi.advanceTimersByTimeAsync(15_000);

    try {
      await rejected;
    } finally {
      bridge.dispose();
    }
  });
});
