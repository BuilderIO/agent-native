// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchResult } from "./types";
import { WorkspaceSearch } from "./WorkspaceSearch";

const project = (id: string, title: string): SearchResult => ({
  id,
  title,
  href: `/project/${id}`,
  updatedAt: "2026-11-08T10:00:00.000Z",
  kind: "project",
});

const DEBOUNCE = 250;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// team-QA row 154: a transient search failure blanked the whole list for a
// second while "Something went wrong" showed, then the retry put it back.
describe("workspace search keeps results across a failed refresh", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    root = null as unknown as typeof root;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  async function render(onSearch: () => Promise<SearchResult[]>) {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <WorkspaceSearch
          filterOptions={{}}
          onClose={() => undefined}
          onNavigate={() => undefined}
          onSearch={onSearch}
          open
        />,
      );
      await wait(0);
    });
  }

  async function type(text: string) {
    const input = document.querySelector<HTMLInputElement>("input");
    await act(async () => {
      if (!input) return;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(DEBOUNCE + 30);
    });
  }

  it("keeps the last results when a refresh rejects", async () => {
    let calls = 0;
    const onSearch = vi.fn<() => Promise<SearchResult[]>>(async () => {
      calls += 1;
      if (calls <= 2) return [project("p1", "Revenue overview")];
      if (calls === 3) return new Promise(() => undefined);
      throw new Error("synthetic transient failure");
    });

    await render(onSearch);
    await type("revenue");
    expect(document.body.textContent).toContain("Revenue overview");

    // Return to the last successful query while another search is pending.
    await type("other");
    await type("revenue");

    // The list a reader was using is still there, and the failure is an
    // inline notice instead of the full-surface error state.
    expect(document.body.textContent).toContain("Revenue overview");
    expect(document.body.textContent).toContain("Could not refresh results.");
    expect(document.body.textContent).not.toContain("Something went wrong");
  });

  it("shows title matches while the cell-content scan is still pending", async () => {
    const onSearch = vi.fn(
      (
        _query: unknown,
        onPartial?: (results: SearchResult[]) => void,
      ): Promise<SearchResult[]> => {
        onPartial?.([project("p1", "Revenue overview")]);
        return new Promise(() => undefined);
      },
    );

    await act(async () => {
      root = createRoot(host);
      root.render(
        <WorkspaceSearch
          filterOptions={{}}
          onClose={() => undefined}
          onNavigate={() => undefined}
          onSearch={onSearch}
          onCreateThread={async () => undefined}
          queryText="revenue"
          onQueryTextChange={() => undefined}
          open
        />,
      );
      await wait(0);
    });
    await act(async () => {
      await wait(DEBOUNCE + 30);
    });

    expect(document.body.textContent).toContain("Revenue overview");
  });

  it("still shows the error state when the first search fails", async () => {
    const onSearch = vi
      .fn<() => Promise<SearchResult[]>>()
      .mockRejectedValue(new Error("synthetic first failure"));

    await render(onSearch);
    await type("revenue");

    expect(document.body.textContent).toContain("Something went wrong");
    expect(document.body.textContent).toContain(
      "Please contact support@builder.io if this persists",
    );
    expect(document.body.textContent).not.toContain("synthetic first failure");
    expect(document.body.textContent).not.toContain("Your query is kept.");
    expect(document.querySelector(".ws-search-retry")).toBeNull();
  });
});
