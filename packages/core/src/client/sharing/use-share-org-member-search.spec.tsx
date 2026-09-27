// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useShareOrgMemberSearch,
  type ShareOrgMemberSearchResult,
} from "./share-controller-helpers.js";

describe("useShareOrgMemberSearch", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ShareOrgMemberSearchResult | null = null;

  function Probe({ query }: { query: string }) {
    latest = useShareOrgMemberSearch(query, true, { debounceMs: 200 });
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const search = new URL(url, "http://localhost").searchParams.get(
          "search",
        );
        return new Response(
          JSON.stringify({
            members: [{ email: `${search ?? "all"}@example.test` }],
            hasMore: false,
            nextOffset: null,
          }),
        );
      }),
    );
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    latest = null;
  });

  it("drops the previous query's results as soon as the query changes", async () => {
    await act(async () => root.render(<Probe query="ann" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(latest?.members.map((member) => member.email)).toEqual([
      "ann@example.test",
    ]);

    await act(async () => root.render(<Probe query="bob" />));
    // Still inside the debounce window: nothing from "ann" may be offered.
    expect(latest?.members).toEqual([]);
    expect(latest?.isLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(latest?.members.map((member) => member.email)).toEqual([
      "bob@example.test",
    ]);
    expect(latest?.isLoading).toBe(false);
  });
});
