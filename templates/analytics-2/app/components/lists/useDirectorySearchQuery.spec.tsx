// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDirectorySearchQuery } from "./useDirectorySearchQuery";

describe("directory search request timing", () => {
  let root: Root;
  let container: HTMLDivElement;
  let value: string;
  let renders: number;
  function Probe({ orgId, query }: { orgId: string; query: string }) {
    value = useDirectorySearchQuery(orgId, query);
    renders++;
    return null;
  }
  const render = (query: string, orgId = "one") =>
    act(() => root.render(<Probe orgId={orgId} query={query} />));
  const advance = (time: number) => act(() => vi.advanceTimersByTime(time));
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    root = createRoot(container);
    renders = 0;
    render("");
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("debounces a query for 200ms", () => {
    render("name");
    advance(199);
    expect(value).toBe("");
    advance(1);
    expect(value).toBe("name");
  });
  it("requests the latest query by 600ms during continuous input", () => {
    render("a");
    for (const query of ["ab", "abc", "abcd", "abcde", "abcdef"]) {
      advance(100);
      render(query);
    }
    expect(value).toBe("");
    advance(100);
    expect(value).toBe("abcdef");
  });
  it("starts a fresh max-wait window after a request", () => {
    render("a");
    advance(200);
    expect(value).toBe("a");
    render("ab");
    for (const query of ["abc", "abcd", "abcde", "abcdef", "abcdefg"]) {
      advance(100);
      render(query);
    }
    expect(value).toBe("a");
    advance(100);
    expect(value).toBe("abcdefg");
  });
  it("hides the previous org query immediately and resets its timing window", () => {
    render("one name");
    advance(200);
    expect(value).toBe("one name");
    render("later");
    advance(150);
    render("two name", "two");
    expect(value).toBe("");
    advance(199);
    expect(value).toBe("");
    advance(1);
    expect(value).toBe("two name");
  });
  it("cancels a burst that returns to the already requested query", () => {
    render("a");
    advance(150);
    render("");
    advance(150);
    render("b");
    advance(199);
    expect(value).toBe("");
    advance(1);
    expect(value).toBe("b");
  });
  it("cancels its outstanding request on unmount", () => {
    render("a");
    act(() => root.unmount());
    const before = renders;
    expect(vi.getTimerCount()).toBe(0);
    advance(1000);
    expect(renders).toBe(before);
    root = createRoot(container);
  });
});
