// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  org: "org-a" as string | null,
  failNext: true,
  empty: false,
  scopes: [] as unknown[],
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    _name: string,
    input: { afterId?: string },
    options: { queryKeyScope: unknown[] },
  ) => {
    mocks.scopes.push(options.queryKeyScope);
    const [, rerender] = useState(0);
    const error = input.afterId !== undefined && mocks.failNext;
    return {
      data: error
        ? undefined
        : mocks.empty
          ? { apps: [], nextCursor: null }
          : input.afterId === undefined
            ? {
                apps: Array.from({ length: 50 }, (_, i) => ({
                  id: `${mocks.org}-${i}`,
                  title: `${mocks.org} App ${i}`,
                })),
                nextCursor: { id: "last", updatedAt: "2026-01-01" },
              }
            : {
                apps: [
                  { id: `${mocks.org}-0`, title: "duplicate" },
                  { id: "shared", title: "Shared app" },
                ],
                nextCursor: null,
              },
      isPending: false,
      isFetching: false,
      isError: error,
      refetch: async () => {
        mocks.failNext = false;
        rerender((n) => n + 1);
      },
    };
  },
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () =>
    mocks.org === null
      ? undefined
      : {
          shell: {
            workspace: { id: mocks.org },
            user: { email: "member@example.test" },
          },
        },
}));
let intersection: IntersectionObserverCallback;
class Observer {
  constructor(callback: IntersectionObserverCallback) {
    intersection = callback;
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  mocks.org = "org-a";
  mocks.failNext = true;
  mocks.empty = false;
  mocks.scopes = [];
});

it("places the empty Library message with its icon inside the content area", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.empty = true;
  const { LibraryPage } = await import("./LibraryPage");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <LibraryPage />
      </MemoryRouter>,
    ),
  );
  try {
    const empty = host.querySelector('[data-slot="empty"]');
    expect(empty?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(empty?.querySelector("h2")?.textContent).toBe(
      "analytics.catalog.libraryEmptyTitle",
    );
    expect(empty?.textContent).toContain(
      "analytics.catalog.libraryEmptyDescription",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

it("report 1794899298.142179 appends a shared app after retry and resets slices across workspace and logout", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", Observer);
  const { LibraryPage } = await import("./LibraryPage");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    root.render(
      <MemoryRouter>
        <LibraryPage />
      </MemoryRouter>,
    );
  await act(async () => render());
  expect(host.textContent).toContain("org-a App 49");
  await act(async () =>
    intersection(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    ),
  );
  expect(host.textContent).toContain("org-a App 0");
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[role="alert"] button')?.click(),
  );
  expect(host.querySelector('a[href="/app/shared/latest"]')?.textContent).toBe(
    "Shared app",
  );
  expect(host.textContent).toContain("org-a App 0");
  expect(host.textContent).not.toContain("duplicate");
  mocks.org = "org-b";
  await act(async () => render());
  expect(host.textContent).toContain("org-b App 0");
  expect(host.textContent).not.toContain("Shared app");
  mocks.org = null;
  await act(async () => render());
  expect(host.textContent).not.toContain("org-b App 0");
  mocks.org = "org-a";
  await act(async () => render());
  expect(host.textContent).toContain("org-a App 0");
  expect(host.textContent).not.toContain("Shared app");
  expect(mocks.scopes).toContainEqual(["member@example.test", "org-a"]);
  expect(mocks.scopes).toContainEqual(["member@example.test", "org-b"]);
  await act(async () => root.unmount());
});
