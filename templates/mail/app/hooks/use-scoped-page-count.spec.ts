// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useScopedPageCount } from "./use-scoped-page-count";

describe("useScopedPageCount", () => {
  it("asks for no inherited pages on the first render of a new filter", () => {
    const seen: number[] = [];
    const { result, rerender } = renderHook(
      ({ scope, initial }) => {
        const pages = useScopedPageCount(scope, initial);
        seen.push(pages[0]);
        return pages;
      },
      { initialProps: { scope: "r=unread:is_checked", initial: 0 } },
    );
    act(() => result.current[1]());
    act(() => result.current[1]());
    expect(result.current[0]).toBe(2);

    seen.length = 0;
    rerender({ scope: "r=starred:is_checked", initial: 0 });
    expect(seen).toEqual([0]);

    act(() => result.current[1]());
    expect(result.current[0]).toBe(1);
  });

  it("starts a scope at its own depth and counts on from there", () => {
    const { result, rerender } = renderHook(
      ({ scope, initial }) => useScopedPageCount(scope, initial),
      { initialProps: { scope: "newest", initial: 0 } },
    );
    rerender({ scope: "priority", initial: 3 });
    expect(result.current[0]).toBe(3);
    act(() => result.current[1]());
    expect(result.current[0]).toBe(4);
  });
});
