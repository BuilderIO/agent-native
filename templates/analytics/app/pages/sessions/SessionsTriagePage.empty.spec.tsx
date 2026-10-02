// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  total: 0,
  pending: false,
  error: null as Error | null,
  refetch: vi.fn(),
  useActionQuery: vi.fn(() => ({
    data: mocks.pending
      ? undefined
      : { recordings: [], total: mocks.total, appCounts: [] },
    error: mocks.error,
    isPending: mocks.pending,
    isLoading: false,
    isFetching: false,
    refetch: mocks.refetch,
  })),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: mocks.useActionQuery,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/labs", () => ({
  useLabState: () => ({ enabled: false, isLoading: false }),
}));
vi.mock("@agent-native/toolkit/app/blocks", () => ({
  CodeSurface: () => <div data-testid="installation-snippet" />,
}));
vi.mock("@agent-native/toolkit/app/settings", () => ({
  BuilderConnectPopover: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useBuilderConnectFlow: () => ({
    configured: false,
    connecting: false,
    hasFetchedStatus: true,
  }),
  useBuilderStatus: () => ({
    status: { configured: false },
    loading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-replay-storage-status", () => ({
  useReplayStorageStatus: () => ({
    data: { configured: mocks.configured },
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { SessionsTriagePage } from "./SessionsTriagePage";

function clearAllButton(container: HTMLElement) {
  return Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "sessions.clearFilters",
  );
}

describe("Sessions empty states", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.error = null;
    mocks.total = 0;
    mocks.pending = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows a filtered-empty state for configured storage without setup guidance", async () => {
    mocks.configured = true;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?q=no-matching-session"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("sessions.noSessions");
    expect(container.textContent).not.toContain("sessions.storageSetupTitle");
    expect(container.textContent).not.toContain("sessions.installSnippetTitle");
    expect(
      container.querySelector('[data-testid="installation-snippet"]'),
    ).toBeNull();
  });

  it("keeps storage connection, installation, and docs paths for a new install", async () => {
    mocks.configured = false;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("sessions.storageSetupTitle");
    expect(container.textContent).toContain("sessions.connectBuilder");
    expect(container.textContent).toContain("sessions.configureS3");
    expect(container.textContent).toContain("sessions.installSnippetTitle");
    expect(
      container.querySelector('[data-testid="installation-snippet"]'),
    ).not.toBeNull();
    expect(container.querySelector('a[href*="session-replay"]')).not.toBeNull();
  });

  it("shows a list error and retries without replacing it with setup guidance", async () => {
    mocks.configured = false;
    mocks.error = new Error("Session list unavailable");
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "sessions.loadFailed",
    );
    expect(container.textContent).not.toContain("sessions.storageSetupTitle");
    expect(container.textContent).not.toContain("sessions.installSnippetTitle");
    await act(async () => {
      container
        .querySelector('button[aria-label="sessions.refresh"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("keeps the loading skeleton while a hidden-tab retry is paused", async () => {
    mocks.configured = true;
    mocks.pending = true;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?q=waiting"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(
      container.querySelectorAll(".skeleton-shimmer").length,
    ).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("sessions.noSessions");
    expect(container.textContent).not.toContain("sessions.storageSetupTitle");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(mocks.useActionQuery).toHaveBeenCalledWith(
      "list-session-recordings",
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
  });

  it("moves an out-of-range saved page to the last available page", async () => {
    mocks.total = 285;
    function LocationProbe() {
      const location = useLocation();
      return <span data-testid="location">{location.search}</span>;
    }

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?page=999"]}>
          <SessionsTriagePage />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("?page=3");
    expect(mocks.useActionQuery).toHaveBeenCalledWith(
      "list-session-recordings",
      expect.objectContaining({ offset: 200, limit: 100 }),
      expect.anything(),
    );
  });

  it("hides Clear all when the URL has only a sort and page", async () => {
    mocks.total = 285;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?sort=longest&page=2"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(clearAllButton(container)).toBeUndefined();
  });

  it("clears every filter but keeps the sort", async () => {
    mocks.total = 285;
    function LocationProbe() {
      const location = useLocation();
      return <span data-testid="location">{location.search}</span>;
    }

    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            "/sessions?minDurationMs=60000&hasErrors=true&q=checkout&hideEmpty=false&event=clip_viewed&noEvent=clip_trimmed&sort=longest&page=2",
          ]}
        >
          <SessionsTriagePage />
          <LocationProbe />
        </MemoryRouter>,
      );
    });
    expect(clearAllButton(container)).toBeDefined();

    await act(async () => {
      clearAllButton(container)?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("?sort=longest");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="sessions.searchPlaceholder"]',
      )?.value,
    ).toBe("");
    expect(clearAllButton(container)).toBeUndefined();
  });

  it("drops a search still waiting to commit when Clear all is clicked", async () => {
    vi.useFakeTimers();
    mocks.total = 285;
    function LocationProbe() {
      const location = useLocation();
      return <span data-testid="location">{location.search}</span>;
    }

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?hasErrors=true"]}>
          <SessionsTriagePage />
          <LocationProbe />
        </MemoryRouter>,
      );
    });
    const search = container.querySelector<HTMLInputElement>(
      'input[aria-label="sessions.searchPlaceholder"]',
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, "checkout");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      clearAllButton(container)?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });

    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("");
    expect(search?.value).toBe("");
  });

  it("normalizes an unsafe page before querying any large offset", async () => {
    function LocationProbe() {
      const location = useLocation();
      return <span data-testid="location">{location.search}</span>;
    }

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?page=9007199254740993"]}>
          <SessionsTriagePage />
          <LocationProbe />
        </MemoryRouter>,
      );
    });

    expect(
      container.querySelector('[data-testid="location"]')?.textContent,
    ).toBe("");
    expect(mocks.useActionQuery).toHaveBeenCalledWith(
      "list-session-recordings",
      expect.objectContaining({ offset: 0, limit: 100 }),
      expect.anything(),
    );
  });
});
