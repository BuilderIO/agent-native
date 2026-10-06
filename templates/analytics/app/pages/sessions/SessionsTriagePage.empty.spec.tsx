// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  labEnabled: false,
  labLoading: false,
  labError: false,
  labRefetch: vi.fn(),
  configured: true,
  total: 0,
  pending: false,
  placeholder: false,
  coverage: undefined as string | null | undefined,
  speedCoverage: undefined as string | null | undefined,
  recordings: [] as Record<string, unknown>[],
  rowFriction: {} as Record<string, unknown>,
  rowFrictionError: null as Error | null,
  rowFrictionRefetch: vi.fn(),
  speed: {} as Record<string, unknown>,
  speedError: null as Error | null,
  speedRefetch: vi.fn(),
  error: null as Error | null,
  refetch: vi.fn(),
  useActionQuery: vi.fn((name: string) =>
    name === "list-session-friction"
      ? {
          data: mocks.rowFrictionError
            ? undefined
            : { friction: mocks.rowFriction },
          error: mocks.rowFrictionError,
          isPending: false,
          isLoading: false,
          isFetching: false,
          refetch: mocks.rowFrictionRefetch,
        }
      : name === "list-session-performance"
        ? {
            data: mocks.speedError
              ? undefined
              : { performance: mocks.speed, coverageStartedAt: null },
            error: mocks.speedError,
            isPending: false,
            isLoading: false,
            isFetching: false,
            refetch: mocks.speedRefetch,
          }
        : {
            data: mocks.pending
              ? undefined
              : {
                  recordings: mocks.recordings,
                  total: mocks.total,
                  appCounts: [],
                  ...(mocks.coverage !== undefined
                    ? { frictionCoverageStartedAt: mocks.coverage }
                    : {}),
                  ...(mocks.speedCoverage !== undefined
                    ? { performanceCoverageStartedAt: mocks.speedCoverage }
                    : {}),
                },
            error: mocks.error,
            isPending: mocks.pending,
            isLoading: false,
            isFetching: false,
            isPlaceholderData: mocks.placeholder,
            refetch: mocks.refetch,
          },
  ),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: mocks.useActionQuery,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/core/client/labs", () => ({
  useLabState: () => ({
    enabled: mocks.labEnabled,
    isLoading: mocks.labLoading,
    isError: mocks.labError,
    refetch: mocks.labRefetch,
  }),
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

import {
  rangePredatesCoverage,
  SessionsTriagePage,
} from "./SessionsTriagePage";

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
    mocks.labEnabled = false;
    mocks.labLoading = false;
    mocks.labError = false;
    mocks.error = null;
    mocks.total = 0;
    mocks.pending = false;
    mocks.placeholder = false;
    mocks.coverage = undefined;
    mocks.speedCoverage = undefined;
    mocks.recordings = [];
    mocks.rowFriction = {};
    mocks.rowFrictionError = null;
    mocks.speed = {};
    mocks.speedError = null;
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

  it("ignores friction links and shows no friction controls with the Lab off", async () => {
    mocks.total = 3;
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={["/sessions?signal=dead_clicks&sort=friction"]}
        >
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    const calls = mocks.useActionQuery.mock.calls as unknown as Array<
      [string, Record<string, unknown>, Record<string, unknown>]
    >;
    const [, args, options] = calls.find(
      ([name]) => name === "list-session-recordings",
    )!;
    expect(args).toMatchObject({ sort: "newest" });
    expect(args.frictionSignals).toBeUndefined();
    expect(args.includeFriction).toBeUndefined();
    expect(options.placeholderData).toBeUndefined();
    expect(container.textContent).toContain("sessions.frictionFiltersNeedLab");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "sessions.friction",
      ),
    ).toBe(false);
  });

  it("queries friction filters, sorts, and row friction with the Lab on", async () => {
    mocks.labEnabled = true;
    mocks.total = 3;
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={["/sessions?signal=dead_clicks&sort=friction"]}
        >
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(mocks.useActionQuery).toHaveBeenCalledWith(
      "list-session-recordings",
      expect.objectContaining({
        frictionSignals: ["dead_clicks"],
        includeFriction: true,
        sort: "friction",
      }),
      expect.anything(),
    );
    expect(container.textContent).not.toContain(
      "sessions.frictionFiltersNeedLab",
    );
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "sessions.frictionFiltersActive",
      ),
    ).toBe(true);
  });

  const recording = (id: string, friction?: unknown) => ({
    id,
    sessionId: `session-${id}`,
    userId: `${id}@example.com`,
    startedAt: "2026-09-29T10:00:00.000Z",
    durationMs: 60_000,
    eventCount: 4,
    pageCount: 1,
    errorCount: 0,
    networkErrorCount: 0,
    rageClickCount: 0,
    ...(friction ? { friction } : {}),
  });
  const deadClicks = (count: number) => ({
    score: count,
    replay: null,
    events: null,
    topSignals: [{ signal: "dead_clicks", count }],
    troubles: [],
    errorIssues: [],
  });

  it("lists sessions without friction and loads row friction beside them", async () => {
    mocks.labEnabled = true;
    mocks.total = 2;
    mocks.recordings = [recording("r1"), recording("r2")];
    mocks.rowFriction = { r1: { ...deadClicks(3), replay: {} } };
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    const [, listArgs, listOptions] = listCalls()[0];
    expect(listArgs.includeFriction).toBeUndefined();
    expect(listOptions.placeholderData).toBeUndefined();
    expect(mocks.useActionQuery).toHaveBeenCalledWith(
      "list-session-friction",
      { recordingIds: ["r1", "r2"] },
      expect.objectContaining({ enabled: true }),
    );
    expect(container.textContent).toContain("sessions.frictionSignalCount");
  });

  it("keeps the list and offers a retry when row friction fails to load", async () => {
    mocks.labEnabled = true;
    mocks.total = 1;
    mocks.recordings = [recording("r1")];
    mocks.rowFrictionError = new Error("friction read failed");
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("r1@example.com");
    expect(container.textContent).toContain("sessions.frictionUnavailable");
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "sidebar.retry")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.rowFrictionRefetch).toHaveBeenCalledOnce();
  });

  it("takes row friction from the list itself under a friction sort", async () => {
    mocks.labEnabled = true;
    mocks.total = 1;
    mocks.recordings = [recording("r1", { ...deadClicks(2), replay: {} })];
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?sort=dead_clicks"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(listCalls()[0][1]).toMatchObject({
      includeFriction: true,
      sort: "dead_clicks",
    });
    expect(mocks.useActionQuery).toHaveBeenCalledWith(
      "list-session-friction",
      expect.anything(),
      expect.objectContaining({ enabled: false }),
    );
    expect(container.textContent).toContain("sessions.frictionSignalCount");
  });

  function listCalls() {
    return (
      mocks.useActionQuery.mock.calls as unknown as Array<
        [string, Record<string, unknown>, Record<string, unknown>]
      >
    ).filter(
      ([name, args]) =>
        name === "list-session-recordings" && args.limit === 100,
    );
  }

  it("says a Lab state that failed to load is why a link's filters are off", async () => {
    mocks.labError = true;
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={["/sessions?signal=dead_clicks&event=clip_viewed"]}
        >
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("sessions.labStateUnavailable");
    expect(container.textContent).not.toContain(
      "sessions.frictionFiltersNeedLab",
    );
    expect(container.textContent).not.toContain("sessions.eventFiltersNeedLab");
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "sidebar.retry")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.labRefetch).toHaveBeenCalledOnce();
  });

  it("stops holding a friction link when the Lab state hangs", async () => {
    vi.useFakeTimers();
    mocks.labLoading = true;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?sort=friction"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });
    let calls = listCalls();
    expect(calls[calls.length - 1][2].enabled).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    calls = listCalls();
    expect(calls[calls.length - 1][2].enabled).toBe(true);
    expect(container.textContent).toContain("sessions.labStateUnavailable");

    // A retry waits again rather than listing unfiltered sessions at once.
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "sidebar.retry")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.labRefetch).toHaveBeenCalledOnce();
    calls = listCalls();
    expect(calls[calls.length - 1][2].enabled).toBe(false);
    expect(container.textContent).not.toContain("sessions.labStateUnavailable");

    // And stops holding again if the retry hangs too.
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    calls = listCalls();
    expect(calls[calls.length - 1][2].enabled).toBe(true);
    expect(container.textContent).toContain("sessions.labStateUnavailable");
  });

  it("says when friction coverage began in an empty friction match", async () => {
    mocks.labEnabled = true;
    mocks.coverage = null;
    const view = () => (
      <MemoryRouter initialEntries={["/sessions?signal=dead_clicks"]}>
        <SessionsTriagePage />
      </MemoryRouter>
    );
    await act(async () => {
      root.render(view());
    });
    expect(container.textContent).toContain("sessions.noSessions");
    expect(container.textContent).toContain(
      "sessions.frictionCoverageIncomplete",
    );

    mocks.coverage = "2026-09-20T00:00:00.000Z";
    await act(async () => {
      root.render(view());
    });
    expect(container.textContent).toContain("sessions.frictionCoverageSince");
    expect(container.textContent).not.toContain(
      "sessions.frictionCoverageIncomplete",
    );
  });

  it("dims rows kept from the previous filters until the new ones load", async () => {
    mocks.labEnabled = true;
    mocks.placeholder = true;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?signal=dead_clicks"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy?.className).toContain("opacity-60");
    expect(busy?.textContent).toContain("sessions.noSessions");
  });

  it("flags a range that starts before friction coverage", () => {
    const coverage = "2026-09-20T00:00:00.000Z";
    expect(rangePredatesCoverage(undefined, coverage)).toBe(true);
    expect(rangePredatesCoverage("2026-09-01T00:00:00.000Z", coverage)).toBe(
      true,
    );
    expect(rangePredatesCoverage("2026-09-21T00:00:00.000Z", coverage)).toBe(
      false,
    );
    expect(rangePredatesCoverage("2026-09-21T00:00:00.000Z", null)).toBe(true);
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

  it("keeps a shared slow filter out of the query while the Lab is off", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/sessions?slow=vitals"]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });

    for (const [, args] of mocks.useActionQuery.mock.calls as unknown as [
      string,
      Record<string, unknown>,
    ][]) {
      expect(args).not.toHaveProperty("slow", expect.anything());
      expect(args).not.toHaveProperty("includePerformance", expect.anything());
    }
    expect(container.textContent).toContain("sessions.speedFilterNeedsLab");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "sessions.speed",
      ),
    ).toBe(false);
  });

  type QueryCall = [string, Record<string, unknown>, { enabled?: boolean }];
  const queryCalls = () =>
    mocks.useActionQuery.mock.calls as unknown as QueryCall[];
  const speedCalls = () =>
    queryCalls().filter(([name]) => name === "list-session-performance");
  async function renderSessions(path = "/sessions") {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <SessionsTriagePage />
        </MemoryRouter>,
      );
    });
  }

  it("lists sessions without waiting for a Lab state that is loading or hung", async () => {
    mocks.labLoading = true;
    mocks.total = 1;
    mocks.recordings = [recording("r1")];
    await renderSessions();

    expect(listCalls().length).toBeGreaterThan(0);
    for (const [, , options] of listCalls()) {
      expect(options.enabled).toBe(true);
    }
    for (const [, , options] of speedCalls()) {
      expect(options.enabled).toBe(false);
    }
    expect(container.querySelector('a[href="/sessions/r1"]')).not.toBeNull();
  });

  it("lists sessions when the Lab state fails to load", async () => {
    mocks.labError = true;
    mocks.total = 1;
    mocks.recordings = [recording("r1")];
    await renderSessions();

    for (const [, , options] of listCalls()) {
      expect(options.enabled).toBe(true);
    }
    for (const [, , options] of speedCalls()) {
      expect(options.enabled).toBe(false);
    }
    expect(container.querySelector('a[href="/sessions/r1"]')).not.toBeNull();
  });

  it("says a failed Lab state hid Lab features on a plain link", async () => {
    mocks.labError = true;
    await renderSessions();

    expect(container.textContent).toContain("sessions.labFeaturesUnavailable");
    expect(container.textContent).not.toContain("sessions.labStateUnavailable");
    expect(retryButtons()).toHaveLength(1);
    await click(retryButtons()[0]);
    expect(mocks.labRefetch).toHaveBeenCalledOnce();
  });

  it("holds a shared slow link until the Lab state loads", async () => {
    mocks.labLoading = true;
    await renderSessions("/sessions?slow=vitals");

    expect(listCalls().length).toBeGreaterThan(0);
    for (const [, , options] of listCalls()) {
      expect(options.enabled).toBe(false);
    }
  });

  it("loads speed hints beside the list once the Lab is on, without refetching the list", async () => {
    mocks.labLoading = true;
    mocks.total = 1;
    mocks.recordings = [recording("r1")];
    await renderSessions();
    mocks.labLoading = false;
    mocks.labEnabled = true;
    await renderSessions();

    // One query key for the list across both states: it is fetched once.
    expect(
      new Set(listCalls().map(([, args]) => JSON.stringify(args))).size,
    ).toBe(1);
    const speed = speedCalls();
    expect(speed[speed.length - 1]).toEqual([
      "list-session-performance",
      { recordingIds: ["r1"] },
      expect.objectContaining({ enabled: true }),
    ]);
  });

  it("marks incomplete speed data and values that hit the ceiling", async () => {
    mocks.labEnabled = true;
    mocks.total = 1;
    mocks.recordings = [recording("r1")];
    mocks.speed = {
      r1: {
        ttfbMs: null,
        lcpMs: 64_000,
        inpMs: null,
        cls: null,
        slowRequests: null,
        maxRequestMs: null,
        atLeast: ["lcpMs"],
        incomplete: true,
      },
    };
    await renderSessions();

    expect(container.textContent).toContain("LCP sessions.perfAtLeast");
    expect(container.textContent).toContain("sessions.speedIncomplete");
    expect(container.textContent).not.toContain("sessions.slowRequestCount");
  });

  it("says a session's speed was never measured rather than showing it as fast", async () => {
    mocks.labEnabled = true;
    mocks.total = 2;
    mocks.recordings = [recording("r-unmeasured"), recording("r-fast")];
    mocks.speed = {
      "r-unmeasured": null,
      "r-fast": {
        ttfbMs: 120,
        lcpMs: 900,
        inpMs: 40,
        cls: 0,
        slowRequests: 0,
        maxRequestMs: 300,
        atLeast: [],
        incomplete: false,
      },
    };
    await renderSessions();

    expect(
      container.textContent?.split("sessions.speedNotMeasured"),
    ).toHaveLength(2);
  });

  it("says when speed coverage began beside a slow match", async () => {
    mocks.labEnabled = true;
    mocks.speedCoverage = null;
    await renderSessions("/sessions?slow=any");
    expect(container.textContent).toContain("sessions.noSessions");
    expect(container.textContent).toContain("sessions.speedCoverageStarting");

    mocks.speedCoverage = "2026-09-20T00:00:00.000Z";
    await renderSessions("/sessions?slow=any");
    expect(container.textContent).toContain("sessions.speedCoverageSince");

    // Matches from a range that starts before coverage say so above the list.
    mocks.total = 1;
    mocks.recordings = [recording("r1")];
    await renderSessions("/sessions?slow=any&range=all");
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "sessions.speedCoverageSince",
    );
  });

  function retryButtons() {
    return Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "sidebar.retry",
    );
  }

  function click(button: HTMLButtonElement | undefined) {
    return act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("says speed hints could not load and retries them", async () => {
    mocks.labEnabled = true;
    mocks.total = 1;
    mocks.recordings = [recording("r1")];
    mocks.speedError = new Error("Internal Server Error");
    await renderSessions();

    expect(container.textContent).toContain("sessions.speedUnavailable");
    await click(retryButtons()[0]);
    expect(mocks.speedRefetch).toHaveBeenCalledOnce();
  });

  it("reports row friction and speed hints failing apart, each with its own retry", async () => {
    mocks.labEnabled = true;
    mocks.total = 1;
    mocks.recordings = [recording("r1")];
    mocks.rowFrictionError = new Error("friction read failed");
    mocks.speedError = new Error("speed read failed");
    await renderSessions();

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("r1@example.com");
    expect(container.textContent).toContain("sessions.frictionUnavailable");
    expect(container.textContent).toContain("sessions.speedUnavailable");
    const [frictionRetry, speedRetry] = retryButtons();
    await click(frictionRetry);
    expect(mocks.rowFrictionRefetch).toHaveBeenCalledOnce();
    expect(mocks.speedRefetch).not.toHaveBeenCalled();
    await click(speedRetry);
    expect(mocks.speedRefetch).toHaveBeenCalledOnce();
  });

  it.each([
    "/sessions?signal=dead_clicks&event=clip_viewed",
    "/sessions?slow=vitals&event=clip_viewed",
    "/sessions?signal=dead_clicks&slow=vitals&sort=friction",
  ])(
    "says a Lab state that failed to load is why a link's filters are off: %s",
    async (path) => {
      mocks.labError = true;
      await renderSessions(path);

      expect(
        container.textContent?.split("sessions.labStateUnavailable"),
      ).toHaveLength(2);
      expect(container.textContent).not.toContain(
        "sessions.frictionFiltersNeedLab",
      );
      expect(container.textContent).not.toContain(
        "sessions.speedFilterNeedsLab",
      );
      expect(container.textContent).not.toContain(
        "sessions.eventFiltersNeedLab",
      );
      expect(retryButtons()).toHaveLength(1);
      await click(retryButtons()[0]);
      expect(mocks.labRefetch).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "/sessions?sort=friction",
    "/sessions?slow=vitals",
    "/sessions?signal=dead_clicks&slow=requests",
  ])(
    "stops holding a Lab-filter link when the Lab state hangs: %s",
    async (path) => {
      vi.useFakeTimers();
      mocks.labLoading = true;
      await renderSessions(path);
      expect(listCalls()[listCalls().length - 1][2].enabled).toBe(false);

      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });

      const calls = listCalls();
      expect(calls[calls.length - 1][2].enabled).toBe(true);
      expect(container.textContent).toContain("sessions.labStateUnavailable");
    },
  );

  it("names both a friction and a slow filter the Lab would apply once it reads off", async () => {
    await renderSessions("/sessions?signal=dead_clicks&slow=vitals");

    expect(container.textContent).toContain("sessions.frictionFiltersNeedLab");
    expect(container.textContent).toContain("sessions.speedFilterNeedsLab");
    expect(container.textContent).not.toContain("sessions.labStateUnavailable");
    for (const [, args] of listCalls()) {
      expect(args.frictionSignals).toBeUndefined();
      expect(args.slow).toBeUndefined();
    }
  });

  it("sends friction and slow filters together with the Lab on", async () => {
    mocks.labEnabled = true;
    await renderSessions("/sessions?signal=dead_clicks&slow=requests");

    expect(listCalls()[listCalls().length - 1][1]).toMatchObject({
      frictionSignals: ["dead_clicks"],
      includeFriction: true,
      slow: "requests",
    });
  });
});
