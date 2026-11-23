// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import type { SearchFilterOptions, SearchQuery, SearchResult } from "./types";
import { WorkspaceSearch } from "./WorkspaceSearch";

vi.mock("@agent-native/core/client/i18n", () => ({
  useOptionalLocale: () => undefined,
  useT: () => (key: string) =>
    key === "analytics.shell.searchFilters.resetAll"
      ? "Reset all"
      : key === "analytics.shell.search.myThreads"
        ? "My Threads"
        : key === "analytics.shell.searchUntitledThread"
          ? "Untitled thread"
          : key,
}));

it("resets all active filters in one search while keeping the query", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSearch = vi.fn(
    async (query: SearchQuery): Promise<SearchResult[]> => [
      {
        id:
          query.creatorIds.length || query.categoryIds.length
            ? "filtered"
            : "all",
        title:
          query.creatorIds.length || query.categoryIds.length
            ? "Filtered result"
            : "Unfiltered result",
        href: "/project/result",
        updatedAt: "2026-11-08T10:00:00.000Z",
        kind: "project",
      },
    ],
  );
  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === label,
    );
    expect(button, `Missing ${label}`).toBeDefined();
    await act(async () => button?.click());
  };
  try {
    await act(async () =>
      root.render(
        <WorkspaceSearch
          open
          onClose={() => {}}
          onNavigate={() => {}}
          onSearch={onSearch}
          filterOptions={{
            creators: [{ id: "alice", label: "Alice" }],
            categories: [{ id: "finance", label: "Finance" }],
          }}
        />,
      ),
    );
    expect(host.textContent).not.toContain("Reset all");
    const input = host.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("Missing search input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "revenue");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(250);
    });
    await click("Include archived");
    expect(host.textContent).not.toContain("Reset all");
    await click("Search by");
    await click("Description");
    await click("Creator");
    await click("Alice");
    await click("Category");
    await click("Finance");
    expect(host.textContent).toContain("Filtered result");
    const count = onSearch.mock.calls.length;
    await click("Reset all");
    expect(onSearch).toHaveBeenCalledTimes(count + 1);
    expect(onSearch.mock.lastCall?.[0]).toMatchObject({
      text: "revenue",
      fields: ["title", "description", "cellContents"],
      creatorIds: [],
      categoryIds: [],
      statusIds: [],
      includeArchived: false,
      customRange: null,
    });
    expect(host.textContent).toContain("Unfiltered result");
    expect(host.textContent).not.toContain("Reset all");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("keeps selected filter names while the workspace catalog is unavailable", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSearch = vi.fn(async () => []);
  const render = (filterOptions: SearchFilterOptions) =>
    act(async () =>
      root.render(
        <WorkspaceSearch
          open
          onClose={() => {}}
          onNavigate={() => {}}
          onSearch={onSearch}
          filterOptions={filterOptions}
        />,
      ),
    );
  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === label,
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());
  };
  const statusId = "00000000-0000-4000-8000-000000000007";
  const categoryId = "00000000-0000-4000-8000-000000000008";
  try {
    await render({
      categories: [{ id: categoryId, label: "Finance" }],
      statuses: [{ id: statusId, label: "Endorsed" }],
    });
    await click("Status");
    await click("Endorsed");
    await click("Category");
    await click("Finance");
    await render({});
    expect(host.textContent).toContain("Statuses: Endorsed");
    expect(host.textContent).toContain("Categories: Finance");
    expect(host.textContent).not.toContain(statusId);
    expect(host.textContent).not.toContain(categoryId);
    expect(onSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categoryIds: [categoryId],
        statusIds: [statusId],
      }),
      expect.any(Function),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("shows only the no-results message when a search returns no matches", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <WorkspaceSearch
          open
          onClose={() => {}}
          onNavigate={() => {}}
          onSearch={async () => []}
          filterOptions={{}}
        />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("Missing search input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "no match");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(250);
    });
    expect(host.textContent).toContain("No results found");
    expect(host.textContent).not.toContain(
      "Try a different phrase or loosen the filters.",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it("labels an untitled thread without renaming an explicitly titled thread", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <WorkspaceSearch
          open
          onClose={() => {}}
          onNavigate={() => {}}
          onSearch={async () => [
            {
              kind: "thread",
              id: "empty",
              title: "",
              href: "/thread/empty",
              updatedAt: "2026-11-08T10:00:00.000Z",
            },
            {
              kind: "thread",
              id: "named",
              title: "New thread",
              href: "/thread/named",
              updatedAt: "2026-11-08T10:00:00.000Z",
            },
          ]}
          filterOptions={{}}
        />,
      ),
    );
    const input = host.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("Missing search input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "thread");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      vi.advanceTimersByTime(250);
    });
    expect(host.textContent).toContain("My Threads");
    const rows = [...host.querySelectorAll('[role="menuitem"]')].map(
      (row) => row.textContent,
    );
    expect(rows.some((row) => row?.includes("Untitled thread"))).toBe(true);
    expect(rows.some((row) => row?.includes("New thread"))).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
