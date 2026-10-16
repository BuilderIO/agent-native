// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  session: {
    session: { email: "a@example.com", userId: "user-a", orgId: "org-1" } as {
      email: string;
      userId: string;
      orgId?: string;
    } | null,
    status: "authenticated" as "authenticated" | "loading",
  },
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useSession: () => mocks.session,
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
  useActionMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/toolkit/app/extensions", () => ({
  EmbeddedExtension: () => null,
  ExtensionSlot: () => null,
}));

vi.mock("@/lib/cost-tracker", () => ({ addBytesProcessed: vi.fn() }));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setActivatorNodeRef: () => {},
    setNodeRef: () => {},
  }),
}));

// Radix menus and tooltips need pointer events and portals; render the menu
// items inline so the card's own Refresh item can be pressed.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    DropdownMenu: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuLabel: Passthrough,
    DropdownMenuRadioGroup: Passthrough,
    DropdownMenuRadioItem: Passthrough,
    DropdownMenuSeparator: () => null,
    DropdownMenuSub: Passthrough,
    DropdownMenuSubContent: Passthrough,
    DropdownMenuSubTrigger: Passthrough,
    DropdownMenuTrigger: Passthrough,
    DropdownMenuItem: ({
      children,
      onSelect,
      disabled,
    }: {
      children?: React.ReactNode;
      onSelect?: (event: Event) => void;
      disabled?: boolean;
    }) => (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={() => onSelect?.(new Event("select"))}
      >
        {children}
      </button>
    ),
  };
});

vi.mock("@/components/ui/tooltip", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Tooltip: Passthrough,
    TooltipTrigger: Passthrough,
    TooltipContent: () => null,
  };
});

import { SqlChartCard } from "./SqlChartCard";
import type { SqlPanel } from "./types";

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  disconnected = false;
  constructor(
    private callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  emit(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  static live() {
    return FakeIntersectionObserver.instances.filter(
      (instance) => !instance.disconnected,
    );
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const panel: SqlPanel = {
  id: "signups",
  title: "Signups",
  sql: "SELECT 'unused' AS value",
  source: "bigquery",
  chartType: "metric",
  width: 1,
};

describe("SqlChartCard visibility", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const callsFor = (sql: string) =>
    mocks.callAction.mock.calls.filter(([, args]) => args.query === sql);

  const render = (
    props: Partial<Parameters<typeof SqlChartCard>[0]> & { sql: string },
  ) => {
    const { sql, ...rest } = props;
    return act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SqlChartCard
            panel={panel}
            resolvedSql={sql}
            onRemove={() => {}}
            dashboardId="dashboard-1"
            {...rest}
          />
        </QueryClientProvider>,
      );
    });
  };

  const observer = () => {
    const [live] = FakeIntersectionObserver.live();
    if (!live) throw new Error("no live IntersectionObserver");
    return live;
  };
  const setVisible = (isIntersecting: boolean) =>
    act(async () => observer().emit(isIntersecting));
  const text = () => container.textContent ?? "";
  const pausedLabel = () =>
    container.querySelector("[data-dashboard-report-paused]");
  const updating = () =>
    container.querySelector("[data-dashboard-report-updating]");
  const skeleton = () =>
    container.querySelector('[data-dashboard-report-loading="true"]');
  const fiveMinutesLater = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
  };

  const answers = () =>
    mocks.callAction.mockImplementation((_name, args) =>
      Promise.resolve({
        rows: [{ value: `rows for ${args.query}` }],
        schema: [],
      }),
    );

  const loadVisible = async (sql: string) => {
    await render({ sql });
    await setVisible(true);
    await vi.waitFor(() => expect(text()).toContain(`rows for ${sql}`));
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    FakeIntersectionObserver.instances = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.callAction.mockReset();
    mocks.session.session = {
      email: "a@example.com",
      userId: "user-a",
      orgId: "org-1",
    };
    mocks.session.status = "authenticated";
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("observes with the existing margin and queries only once the card is near the viewport", async () => {
    answers();
    await render({ sql: "A" });

    expect(observer().options).toMatchObject({
      rootMargin: "64px 0px",
      threshold: 0.01,
    });
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(skeleton()).not.toBeNull();

    await setVisible(true);
    await vi.waitFor(() => expect(text()).toContain("rows for A"));
    expect(callsFor("A")).toHaveLength(1);
  });

  it("keeps observing after the first intersection", async () => {
    answers();
    await loadVisible("A");
    expect(observer().disconnected).toBe(false);
  });

  it("queries immediately when eager, as report capture does", async () => {
    answers();
    await render({ sql: "A", eagerLoad: true });
    await vi.waitFor(() => expect(text()).toContain("rows for A"));
    expect(callsFor("A")).toHaveLength(1);
  });

  it("makes no extra call when the card scrolls away and back after five minutes", async () => {
    answers();
    await loadVisible("A");
    mocks.callAction.mockClear();

    await setVisible(false);
    fiveMinutesLater();
    await setVisible(true);
    await setVisible(false);
    await setVisible(true);

    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(text()).toContain("rows for A");
    expect(pausedLabel()).toBeNull();
  });

  it("neither duplicates nor cancels an in-flight query when the card scrolls away and back", async () => {
    const pending = deferred<{ rows: unknown[]; schema: [] }>();
    let signal: AbortSignal | undefined;
    mocks.callAction.mockImplementation((_name, _args, options) => {
      signal = options.signal;
      return pending.promise;
    });
    await render({ sql: "A" });
    await setVisible(true);
    await vi.waitFor(() => expect(mocks.callAction).toHaveBeenCalledTimes(1));

    await setVisible(false);
    await setVisible(true);
    await setVisible(false);
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);

    await act(async () =>
      pending.resolve({ rows: [{ value: "rows for A" }], schema: [] }),
    );
    await vi.waitFor(() => expect(text()).toContain("rows for A"));
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed query just because the card scrolls back into view", async () => {
    mocks.callAction.mockRejectedValue(new Error("scan failed"));
    await render({ sql: "A" });
    await setVisible(true);
    await vi.waitFor(() => expect(text()).toContain("scan failed"));
    mocks.callAction.mockClear();

    await setVisible(false);
    await setVisible(true);
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("holds an offscreen card's rows as previous filters until it is visible, then queries once", async () => {
    answers();
    await loadVisible("A");
    await setVisible(false);
    mocks.callAction.mockClear();

    await render({ sql: "B" });
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(text()).toContain("rows for A");
    expect(pausedLabel()?.textContent).toBe("sqlDashboard.previousFilters");
    expect(updating()).toBeNull();
    expect(skeleton()).toBeNull();

    await render({ sql: "B" });
    expect(mocks.callAction).not.toHaveBeenCalled();

    await setVisible(true);
    await vi.waitFor(() => expect(text()).toContain("rows for B"));
    expect(callsFor("B")).toHaveLength(1);
    expect(pausedLabel()).toBeNull();

    await setVisible(false);
    await setVisible(true);
    expect(callsFor("B")).toHaveLength(1);
  });

  it("queries a new filter promptly when the card is on screen", async () => {
    answers();
    await loadVisible("A");

    await render({ sql: "B" });
    await vi.waitFor(() => expect(text()).toContain("rows for B"));
    expect(callsFor("B")).toHaveLength(1);
    expect(pausedLabel()).toBeNull();
  });

  it("does not rescan a completed filter it returns to while offscreen after five minutes", async () => {
    answers();
    await loadVisible("A");
    await setVisible(false);
    await render({ sql: "B" });
    mocks.callAction.mockClear();

    fiveMinutesLater();
    await render({ sql: "A" });

    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(text()).toContain("rows for A");
  });

  it.each([false, true])(
    "waits for visibility after incomplete A → B → A (cancel first: %s)",
    async (cancelFirst) => {
      let signal: AbortSignal | undefined;
      mocks.callAction.mockImplementation((_name, _args, options) => {
        signal = options.signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal?.reason), {
            once: true,
          });
        });
      });
      await render({ sql: "A" });
      await setVisible(true);
      await vi.waitFor(() => expect(callsFor("A")).toHaveLength(1));
      await setVisible(false);
      expect(signal?.aborted).toBe(false);

      if (cancelFirst) {
        await act(async () => {
          await queryClient.cancelQueries({ queryKey: ["sql-chart"] });
        });
      }
      await render({ sql: "B" });
      expect(signal?.aborted).toBe(true);
      answers();
      await render({ sql: "A" });
      expect(callsFor("A")).toHaveLength(1);
      expect(callsFor("B")).toHaveLength(0);

      await setVisible(true);
      await vi.waitFor(() => expect(text()).toContain("rows for A"));
      expect(callsFor("A")).toHaveLength(2);
    },
  );

  it.each([
    { email: "b@example.com", userId: "user-b", orgId: "org-1" },
    { email: "a@example.com", userId: "user-a", orgId: "org-2" },
  ])(
    "waits for visibility after switching to %j with the same SQL",
    async (session) => {
      answers();
      await loadVisible("A");
      await setVisible(false);
      mocks.callAction.mockClear();

      mocks.session.session = session;
      await render({ sql: "A" });
      expect(mocks.callAction).not.toHaveBeenCalled();
      expect(text()).not.toContain("rows for A");

      await setVisible(true);
      await vi.waitFor(() => expect(text()).toContain("rows for A"));
      expect(callsFor("A")).toHaveLength(1);
    },
  );

  it.each(["eager", "section", "extension"] as const)(
    "waits for a new observer before loading after leaving %s mode",
    async (mode) => {
      answers();
      await render({
        sql: "A",
        eagerLoad: mode === "eager",
        panel: { ...panel, chartType: mode === "eager" ? "metric" : mode },
      });
      if (mode === "eager") {
        await vi.waitFor(() => expect(text()).toContain("rows for A"));
      }
      mocks.callAction.mockClear();

      await render({ sql: "B" });
      expect(mocks.callAction).not.toHaveBeenCalled();
      await setVisible(false);
      expect(mocks.callAction).not.toHaveBeenCalled();

      await setVisible(true);
      await vi.waitFor(() => expect(text()).toContain("rows for B"));
      expect(callsFor("B")).toHaveLength(1);
    },
  );

  it("does not reuse an observation from before an eager-mode round trip", async () => {
    answers();
    await loadVisible("A");
    const previousObserver = observer();
    await render({ sql: "A", eagerLoad: true });
    expect(previousObserver.disconnected).toBe(true);
    mocks.callAction.mockClear();

    await render({ sql: "B" });
    await act(async () => previousObserver.emit(true));
    expect(mocks.callAction).not.toHaveBeenCalled();

    await setVisible(true);
    await vi.waitFor(() => expect(text()).toContain("rows for B"));
    expect(callsFor("B")).toHaveLength(1);
  });

  it.each(["section", "extension"] as const)(
    "does not inherit permission for the same SQL from %s mode",
    async (chartType) => {
      answers();
      await render({ sql: "A", panel: { ...panel, chartType } });
      expect(mocks.callAction).not.toHaveBeenCalled();

      await render({ sql: "A" });
      expect(mocks.callAction).not.toHaveBeenCalled();
      await setVisible(false);
      expect(mocks.callAction).not.toHaveBeenCalled();

      await setVisible(true);
      await vi.waitFor(() => expect(text()).toContain("rows for A"));
      expect(callsFor("A")).toHaveLength(1);
    },
  );

  it("lets an eager query finish after returning to normal mode offscreen", async () => {
    const pending = deferred<{ rows: unknown[]; schema: [] }>();
    let signal: AbortSignal | undefined;
    mocks.callAction.mockImplementation((_name, _args, options) => {
      signal = options.signal;
      return pending.promise;
    });
    await render({ sql: "A", eagerLoad: true });
    await vi.waitFor(() => expect(callsFor("A")).toHaveLength(1));

    await render({ sql: "A" });
    await setVisible(false);
    expect(signal?.aborted).toBe(false);
    await act(async () =>
      pending.resolve({ rows: [{ value: "rows for A" }], schema: [] }),
    );
    await vi.waitFor(() => expect(text()).toContain("rows for A"));
    await setVisible(true);
    expect(callsFor("A")).toHaveLength(1);
  });

  it("does not let another panel or dashboard inherit the card's permission", async () => {
    answers();
    await loadVisible("A");
    await setVisible(false);
    mocks.callAction.mockClear();

    await render({ sql: "A", panel: { ...panel, id: "other" } });
    await render({ sql: "A", dashboardId: "dashboard-2" });
    expect(mocks.callAction).not.toHaveBeenCalled();
    expect(skeleton()).not.toBeNull();
  });

  it("forces one refresh from the menu even when the card is offscreen, then queries normally", async () => {
    answers();
    await loadVisible("A");
    await setVisible(false);
    mocks.callAction.mockClear();

    const refresh = Array.from(
      container.querySelectorAll<HTMLElement>("[role='menuitem']"),
    ).find((item) => item.textContent?.includes("sqlDashboard.refresh"));
    expect(refresh).toBeDefined();
    await act(async () => refresh?.click());
    await vi.waitFor(() => expect(callsFor("A")).toHaveLength(1));
    expect(callsFor("A")[0]?.[1]).toEqual({
      query: "A",
      source: "bigquery",
      forceRefresh: true,
    });

    await render({ sql: "B" });
    expect(callsFor("B")).toHaveLength(0);
    await setVisible(true);
    await vi.waitFor(() => expect(callsFor("B")).toHaveLength(1));
    expect(callsFor("B")[0]?.[1]).toEqual({ query: "B", source: "bigquery" });
    expect(callsFor("A")).toHaveLength(1);
  });

  it("starts no query while the session is not authenticated", async () => {
    mocks.session.status = "loading";
    answers();
    await render({ sql: "A" });
    await setVisible(true);
    expect(mocks.callAction).not.toHaveBeenCalled();
  });

  it("never shows another account's rows when the session changes while the card is offscreen", async () => {
    answers();
    await loadVisible("A");
    await setVisible(false);
    mocks.callAction.mockClear();

    mocks.session.session = {
      email: "b@example.com",
      userId: "user-b",
      orgId: "org-1",
    };
    await render({ sql: "B" });
    expect(text()).not.toContain("rows for A");
    expect(pausedLabel()).toBeNull();
    expect(mocks.callAction).not.toHaveBeenCalled();
  });
});
