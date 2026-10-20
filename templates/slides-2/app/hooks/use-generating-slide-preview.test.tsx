// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGeneratingSlidePreview } from "./use-generating-slide-preview";

describe("useGeneratingSlidePreview", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("clears the previous query preview and ignores its queued frame", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        const id = ++nextFrameId;
        frames.set(id, callback);
        return id;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });

    const { result, rerender } = renderHook(
      ({ deckId, slideCount }) =>
        useGeneratingSlidePreview({ deckId, slideCount, generating: true }),
      { initialProps: { deckId: "deck-a", slideCount: 1 } },
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            tool: "add-slide",
            phase: "delta",
            id: "call-a",
            argsText: JSON.stringify({ deckId: "deck-a", content: "Old" }),
          },
        }),
      );
    });
    const staleFrame = [...frames.values()][0];
    expect(staleFrame).toBeDefined();

    rerender({ deckId: "deck-b", slideCount: 1 });
    expect(result.current).toBeNull();
    act(() => staleFrame?.(0));
    expect(result.current).toBeNull();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            tool: "add-slide",
            phase: "delta",
            id: "call-a",
            argsText: JSON.stringify({ deckId: "deck-a", content: "Late" }),
          },
        }),
      );
    });
    expect(frames.size).toBe(0);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            tool: "add-slide",
            phase: "delta",
            id: "call-b",
            argsText: JSON.stringify({ deckId: "deck-b", content: "Current" }),
          },
        }),
      );
    });
    const currentFrame = [...frames.entries()][0];
    expect(currentFrame).toBeDefined();
    act(() => currentFrame?.[1](0));
    expect(result.current).toBe("Current");
  });

  it("clears the prior preview on an empty start and matches deltas by deck", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        const id = ++nextFrameId;
        frames.set(id, callback);
        return id;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });

    const { result } = renderHook(() =>
      useGeneratingSlidePreview({
        deckId: "deck-a",
        slideCount: 1,
        generating: true,
      }),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            tool: "add-slide",
            phase: "delta",
            id: "call-a",
            argsText: JSON.stringify({ deckId: "deck-a", content: "Old" }),
          },
        }),
      );
      const frame = [...frames.entries()][0];
      if (frame) {
        frames.delete(frame[0]);
        frame[1](0);
      }
    });
    expect(result.current).toBe("Old");

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            tool: "add-slide",
            phase: "start",
            id: "call-b",
            argsText: "",
          },
        }),
      );
      const frame = [...frames.entries()][0];
      if (frame) {
        frames.delete(frame[0]);
        frame[1](0);
      }
    });
    expect(result.current).toBeNull();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            tool: "add-slide",
            phase: "delta",
            id: "call-b",
            argsText: JSON.stringify({ deckId: "deck-b", content: "Wrong" }),
          },
        }),
      );
    });
    expect(frames.size).toBe(0);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            tool: "add-slide",
            phase: "delta",
            id: "call-b",
            argsText: JSON.stringify({ deckId: "deck-a", content: "New" }),
          },
        }),
      );
      const frame = [...frames.entries()][0];
      if (frame) {
        frames.delete(frame[0]);
        frame[1](0);
      }
    });
    expect(result.current).toBe("New");
  });

  it("clears preview state when the queried slide count changes", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        const id = ++nextFrameId;
        frames.set(id, callback);
        return id;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames.delete(id);
    });

    const { result, rerender } = renderHook(
      ({ slideCount }) =>
        useGeneratingSlidePreview({
          deckId: "deck-a",
          slideCount,
          generating: true,
        }),
      { initialProps: { slideCount: 1 } },
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            tool: "add-slide",
            phase: "delta",
            id: "call-a",
            argsText: JSON.stringify({ deckId: "deck-a", content: "Old" }),
          },
        }),
      );
      const frame = [...frames.entries()][0];
      if (frame) {
        frames.delete(frame[0]);
        frame[1](0);
      }
    });
    expect(result.current).toBe("Old");

    rerender({ slideCount: 2 });
    expect(result.current).toBeNull();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            tool: "add-slide",
            phase: "delta",
            id: "call-a",
            argsText: JSON.stringify({ deckId: "deck-a", content: "Late" }),
          },
        }),
      );
    });
    expect(frames.size).toBe(0);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("agent-native:tool-input", {
          detail: {
            tool: "add-slide",
            phase: "delta",
            id: "call-b",
            argsText: JSON.stringify({ deckId: "deck-a", content: "Current" }),
          },
        }),
      );
    });
    const currentFrame = [...frames.entries()][0];
    expect(currentFrame).toBeDefined();
    if (currentFrame) {
      frames.delete(currentFrame[0]);
      act(() => currentFrame[1](0));
    }
    expect(result.current).toBe("Current");
  });
});
