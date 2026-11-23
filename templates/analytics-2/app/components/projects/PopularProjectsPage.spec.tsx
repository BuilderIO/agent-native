// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatDate: (value: Date) => value.toISOString() }),
}));
const queryState = vi.hoisted(() => ({
  isError: false,
  isFetching: false,
  refetch: vi.fn(async () => undefined),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (_name: string, args: { offset: number }) => ({
    data: queryState.isError
      ? undefined
      : args.offset === 0
        ? {
            projects: [
              {
                id: "first",
                title: "First",
                viewCount: 10,
                ownerName: "Owner",
                creatorName: "Creator",
                createdAt: "2026-01-01T00:00:00Z",
                lastEditedAt: "2026-01-01T00:00:00Z",
                namesUnavailable: false,
              },
            ],
            hasMore: true,
          }
        : {
            projects: [
              {
                id: "second",
                title: "Second",
                viewCount: 4,
                ownerName: "Owner",
                creatorName: "Creator",
                createdAt: "2026-01-01T00:00:00Z",
                lastEditedAt: "2026-01-01T00:00:00Z",
                namesUnavailable: false,
              },
            ],
            hasMore: false,
          },
    isError: queryState.isError,
    isFetching: queryState.isFetching,
    refetch: queryState.refetch,
  }),
}));
import { PopularProjectsPage } from "./PopularProjectsPage";

it("report 1794900494.750729 browses subsequent ranked app pages", async () => {
  queryState.isError = false;
  queryState.isFetching = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <PopularProjectsPage />
        </MemoryRouter>,
      ),
    );
    expect(host.querySelector('a[href="/app/first/latest"]')?.textContent).toBe(
      "First",
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "analytics.home.popularNext")
        ?.click(),
    );
    expect(
      host.querySelector('a[href="/app/second/latest"]')?.textContent,
    ).toBe("Second");
    expect(host.querySelector('a[href="/app/first/latest"]')).toBeNull();
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find(
          (button) => button.textContent === "analytics.home.popularPrevious",
        )
        ?.click(),
    );
    expect(host.querySelector('a[href="/app/first/latest"]')?.textContent).toBe(
      "First",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

it("offers retry when loading popular projects fails", async () => {
  queryState.isError = true;
  queryState.isFetching = false;
  queryState.refetch.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <MemoryRouter>
          <PopularProjectsPage />
        </MemoryRouter>,
      ),
    );
    expect(host.textContent).toContain(
      "There was an error loading popular projects",
    );
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Try again",
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
    });
    expect(queryState.refetch).toHaveBeenCalledOnce();
  } finally {
    queryState.isError = false;
    await act(async () => root.unmount());
  }
});
