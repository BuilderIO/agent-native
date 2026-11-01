// @vitest-environment happy-dom

import {
  TOOL_DONE_EVENT,
  TOOL_INPUT_EVENT,
} from "@agent-native/core/client/generation-stream";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GENERATED_SLIDE_SETTLE_MS,
  useGeneratingSlidePreviews,
} from "./use-generating-slide-preview";

function input(tool: string, id: string, args: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(TOOL_INPUT_EVENT, {
        detail: { tool, phase: "delta", id, argsText: args },
      }),
    );
  });
  // The stream hook applies input once per animation frame.
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

function done(tool: string, id: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(TOOL_DONE_EVENT, {
        detail: { tool, toolCallId: id, isError: false },
      }),
    );
  });
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

describe("useGeneratingSlidePreviews", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows every slide of a call as soon as its content streams in", () => {
    const { result } = renderHook(() =>
      useGeneratingSlidePreviews({ deckId: "deck-a", generating: true }),
    );
    input(
      "create-deck",
      "call-1",
      '{"deckId":"deck-a","slides":[{"content":"<h1>One</h1>"},{"content":"<h1>Tw',
    );

    expect(result.current.slides.map((slide) => slide.content)).toEqual([
      "<h1>One</h1>",
      "<h1>Tw",
    ]);
    expect(result.current.replacesDeck).toBe(true);
  });

  it("keeps a landed slide while its last content drafts, then clears it", () => {
    const { result } = renderHook(() =>
      useGeneratingSlidePreviews({ deckId: "deck-a", generating: true }),
    );
    input("add-slide", "call-1", '{"deckId":"deck-a","content":"<h1>Hi</h1>"}');
    done("add-slide", "call-1");

    expect(result.current.slides).toMatchObject([
      { content: "<h1>Hi</h1>", settling: true, failed: false },
    ]);
    act(() => {
      vi.advanceTimersByTime(GENERATED_SLIDE_SETTLE_MS - 100);
    });
    expect(result.current.slides).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.slides).toEqual([]);
  });

  it("ignores slides written to another deck", () => {
    const { result } = renderHook(() =>
      useGeneratingSlidePreviews({ deckId: "deck-a", generating: true }),
    );
    input("add-slide", "call-1", '{"deckId":"deck-b","content":"<h1>Hi"}');

    expect(result.current.slides).toEqual([]);
  });
});
