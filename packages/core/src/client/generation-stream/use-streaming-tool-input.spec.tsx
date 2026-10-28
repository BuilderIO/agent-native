// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isJsonStringComplete,
  readJsonPath,
  type PartialJson,
} from "./partial-json";
import { TOOL_DONE_EVENT, TOOL_INPUT_EVENT } from "./tool-input-events";
import {
  useStreamingToolInput,
  useStreamingToolInputs,
} from "./use-streaming-tool-input";

const frames = new Map<number, FrameRequestCallback>();
const roots: Root[] = [];

function renderHook<P, R>(
  hook: (props: P) => R,
  options: { initialProps?: P } = {},
) {
  const result: { current: R | undefined } = { current: undefined };
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  function Probe({ props }: { props: P }) {
    result.current = hook(props);
    return null;
  }
  const render = (props: P) => act(() => root.render(<Probe props={props} />));
  render(options.initialProps as P);
  return { result, rerender: render };
}

function flushFrames() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(0)));
}

function input(id: string, args: string, phase: "start" | "delta" = "delta") {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(TOOL_INPUT_EVENT, {
        detail: { tool: "add-slide", phase, id, argsText: args },
      }),
    );
  });
}

function slidePreviewOptions(deckId: string, slideCount: number) {
  return {
    tools: ["add-slide"],
    enabled: true,
    scope: `${deckId}:${slideCount}`,
    matches: (partial: PartialJson) =>
      isJsonStringComplete(partial, ["deckId"])
        ? readJsonPath(partial.value, ["deckId"]) === deckId
        : undefined,
    select: (partial: PartialJson) => {
      const content = readJsonPath(partial.value, ["content"]);
      return typeof content === "string" && content ? content : null;
    },
  };
}

function useSlidePreview(deckId: string, slideCount: number) {
  return useStreamingToolInput(slidePreviewOptions(deckId, slideCount));
}

function done(id: string, isError = false) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(TOOL_DONE_EVENT, {
        detail: { tool: "add-slide", eventId: id, isError },
      }),
    );
  });
}

describe("useStreamingToolInput", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    let nextId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextId;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });

  afterEach(() => {
    for (const root of roots.splice(0)) act(() => root.unmount());
    frames.clear();
    vi.unstubAllGlobals();
  });

  it("previews the streaming argument once per frame", () => {
    const { result } = renderHook(() => useSlidePreview("deck-a", 1));
    input("call-1", '{"deckId":"deck-a","content":"<h1>Hi', "start");
    input("call-1", '{"deckId":"deck-a","content":"<h1>Hi there');
    expect(frames.size).toBe(1);
    flushFrames();
    expect(result.current).toMatchObject({
      callId: "call-1",
      status: "streaming",
      value: "<h1>Hi there",
    });
  });

  it("waits for the deciding argument, then ignores another deck's call", () => {
    const { result } = renderHook(() => useSlidePreview("deck-a", 1));
    input("call-1", '{"deckId":"deck-');
    flushFrames();
    expect(result.current).toBeNull();
    input("call-1", '{"deckId":"deck-b","content":"<h1>Other');
    flushFrames();
    expect(result.current).toBeNull();
    input("call-1", '{"deckId":"deck-b","content":"<h1>Other deck');
    expect(frames.size).toBe(0);
  });

  it("drops the preview on a scope change and ignores the old call", () => {
    const { result, rerender } = renderHook(
      ({ count }) => useSlidePreview("deck-a", count),
      { initialProps: { count: 1 } },
    );
    input("call-1", '{"deckId":"deck-a","content":"Old"}');
    flushFrames();
    expect(result.current?.value).toBe("Old");

    rerender({ count: 2 });
    expect(result.current).toBeNull();
    input("call-1", '{"deckId":"deck-a","content":"Old, late"}');
    expect(frames.size).toBe(0);

    input("call-2", '{"deckId":"deck-a","content":"New"}');
    flushFrames();
    expect(result.current?.value).toBe("New");
  });

  it("builds the arguments from delta text when the sender sends no running total", () => {
    const { result } = renderHook(() => useSlidePreview("deck-a", 1));
    act(() => {
      for (const text of [
        '{"deckId":"deck-a",',
        '"content":"<h1>Hi',
        "</h1>",
      ]) {
        window.dispatchEvent(
          new CustomEvent(TOOL_INPUT_EVENT, {
            detail: { tool: "add-slide", phase: "delta", text },
          }),
        );
      }
    });
    flushFrames();
    expect(result.current?.value).toBe("<h1>Hi</h1>");
  });

  it("matches a finished tool by its call id, not the run frame's event id", () => {
    const { result } = renderHook(() =>
      useStreamingToolInputs(slidePreviewOptions("deck-a", 1)),
    );
    input("call-a", '{"deckId":"deck-a","content":"One"}');
    input("call-b", '{"deckId":"deck-a","content":"Two"}');
    flushFrames();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(TOOL_DONE_EVENT, {
          detail: {
            tool: "add-slide",
            toolCallId: "call-b",
            eventId: "frame-9",
          },
        }),
      );
    });
    flushFrames();
    expect(result.current?.map((call) => [call.callId, call.status])).toEqual([
      ["call-a", "streaming"],
      ["call-b", "done"],
    ]);
  });

  it("finishes a call whose input streamed under a different id", () => {
    const { result } = renderHook(() =>
      useStreamingToolInputs(slidePreviewOptions("deck-a", 1)),
    );
    input("synthetic-1", '{"deckId":"deck-a","content":"One"}');
    input("other-deck", '{"deckId":"deck-b","content":"Two"}');
    flushFrames();

    // A call id that streamed into this hook only finishes its own call.
    done("other-deck");
    flushFrames();
    expect(result.current?.map((call) => call.status)).toEqual(["streaming"]);

    // The tool ran under an id its input never carried.
    done("call-from-tool-start");
    flushFrames();
    expect(result.current?.map((call) => call.status)).toEqual(["done"]);
  });

  it("keeps only the newest finished calls", () => {
    const { result } = renderHook(() =>
      useStreamingToolInputs(slidePreviewOptions("deck-a", 1)),
    );
    for (let index = 0; index < 12; index++) {
      input(`call-${index}`, `{"deckId":"deck-a","content":"${index}"}`);
      done(`call-${index}`);
    }
    input("call-live", '{"deckId":"deck-a","content":"live"}');
    flushFrames();
    expect(result.current?.map((call) => call.value)).toEqual([
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "live",
    ]);
  });

  it("reports a failed call as failed, not done", () => {
    const { result } = renderHook(() => useSlidePreview("deck-a", 1));
    input("call-1", '{"deckId":"deck-a","content":"<h1>Hi"}');
    done("call-1", true);
    flushFrames();
    expect(result.current?.status).toBe("failed");
  });

  it("previews every call one response writes, each finishing on its own", () => {
    const { result } = renderHook(() =>
      useStreamingToolInputs(slidePreviewOptions("deck-a", 1)),
    );
    input("call-1", '{"deckId":"deck-a","content":"One"}');
    input("call-2", '{"deckId":"deck-a","content":"Tw');
    flushFrames();
    expect(result.current?.map((call) => call.value)).toEqual(["One", "Tw"]);

    done("call-1");
    input("call-2", '{"deckId":"deck-a","content":"Two"}');
    flushFrames();
    expect(
      result.current?.map((call) => [call.callId, call.status, call.value]),
    ).toEqual([
      ["call-1", "done", "One"],
      ["call-2", "streaming", "Two"],
    ]);
  });
});
