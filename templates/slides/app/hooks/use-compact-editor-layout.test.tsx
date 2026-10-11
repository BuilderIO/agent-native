// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  isCompactEditorLayout,
  useCompactEditorLayout,
} from "./use-compact-editor-layout";

function resizeTo(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.dispatchEvent(new Event("resize"));
}

describe("compact editor layout", () => {
  const originalWidth = window.innerWidth;

  afterEach(() => {
    cleanup();
    resizeTo(originalWidth);
  });

  it("is compact exactly where the slide rail collapses behind its toggle", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 767,
    });
    expect(isCompactEditorLayout()).toBe(true);

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 768,
    });
    expect(isCompactEditorLayout()).toBe(false);
  });

  it("follows the window as it is resized across the breakpoint", () => {
    resizeTo(1040);
    const { result } = renderHook(() => useCompactEditorLayout());
    expect(result.current).toBe(false);

    act(() => resizeTo(360));
    expect(result.current).toBe(true);

    act(() => resizeTo(1040));
    expect(result.current).toBe(false);
  });
});
