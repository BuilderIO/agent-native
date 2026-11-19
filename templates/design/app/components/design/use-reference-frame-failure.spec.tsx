// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REFERENCE_FRAME_LOAD_TIMEOUT_MS,
  useReferenceFrameFailure,
} from "./use-reference-frame-failure";

type Props = Parameters<typeof useReferenceFrameFailure>[0];
const roots: ReturnType<typeof createRoot>[] = [];
function renderHook(initialProps: Props) {
  let props = initialProps;
  const result = {
    current: undefined as unknown as ReturnType<
      typeof useReferenceFrameFailure
    >,
  };
  function Probe() {
    result.current = useReferenceFrameFailure(props);
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const rerender = (next?: Partial<Props>) => {
    props = { ...props, ...next };
    act(() => root.render(createElement(Probe)));
  };
  rerender();
  return { result, rerender };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const url = "https://example.com/";
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("reference frame failure timer", () => {
  it("never fails a preview that loads before the timeout", () => {
    const { result, rerender } = renderHook({
      url,
      eligible: true,
      loaded: false,
    });
    advance(REFERENCE_FRAME_LOAD_TIMEOUT_MS - 1);
    rerender({ loaded: true });
    advance(REFERENCE_FRAME_LOAD_TIMEOUT_MS * 2);
    expect(result.current.failed).toBe(false);
  });

  it("clears the failure when a slow preview loads after the timeout", () => {
    const { result, rerender } = renderHook({
      url,
      eligible: true,
      loaded: false,
    });
    advance(REFERENCE_FRAME_LOAD_TIMEOUT_MS);
    expect(result.current.failed).toBe(true);
    rerender({ loaded: true });
    expect(result.current.failed).toBe(false);
  });

  it("restarts the timer for a new URL instead of carrying the old failure", () => {
    const { result, rerender } = renderHook({
      url,
      eligible: true,
      loaded: false,
    });
    advance(REFERENCE_FRAME_LOAD_TIMEOUT_MS);
    rerender({ url: "https://example.org/" });
    expect(result.current.failed).toBe(false);
    advance(REFERENCE_FRAME_LOAD_TIMEOUT_MS);
    expect(result.current.failed).toBe(true);
  });

  it("marks a frame error as failed and ignores ineligible previews", () => {
    const { result, rerender } = renderHook({
      url,
      eligible: true,
      loaded: false,
    });
    act(() => result.current.markFailed());
    expect(result.current.failed).toBe(true);
    rerender({ eligible: false });
    expect(result.current.failed).toBe(false);
  });
});
