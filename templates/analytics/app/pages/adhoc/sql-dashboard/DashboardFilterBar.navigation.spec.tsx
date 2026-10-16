// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useBlocker,
  useLocation,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { i18nCatalog } from "@/i18n";
import { useSqlQuery } from "@/lib/sql-query";

import { DashboardFilterBar } from "./DashboardFilterBar";
import type { DashboardFilter } from "./types";

const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useSession: () => ({
    session: {
      email: "filter@example.test",
      userId: "filter-user",
      orgId: "filter-org",
    },
    status: "authenticated",
  }),
}));

const filters: DashboardFilter[] = [
  {
    id: "app",
    label: "App",
    type: "multi-select",
    options: [
      { value: "chat", label: "Chat" },
      { value: "slides", label: "Slides" },
      { value: "design", label: "Design" },
    ],
    presets: [{ label: "Launch apps", values: ["slides", "design"] }],
  },
  { id: "staff", label: "Staff", type: "toggle" },
  {
    id: "edu",
    label: ".edu",
    type: "select",
    default: "all",
    options: [
      { value: "all", label: "Everyone" },
      { value: "only", label: "Only .edu" },
    ],
  },
  {
    id: "timeRange",
    label: "Time range",
    type: "select",
    default: "30d",
    options: [{ value: "30d", label: "Last 30 days" }],
  },
];

let root: Root;
let container: HTMLDivElement;
let router: ReturnType<typeof createMemoryRouter>;
let loads: {
  pathname: string;
  search: string;
  resolve: (data?: Response) => void;
  reject: (error: Error) => void;
}[];
let committedQueries: string[];
let blockNavigations = false;
let queryClient: QueryClient;
let filterBarMounts: number;
let submission: { resolve: () => void; signal: AbortSignal };

function TrackedFilterBar() {
  useEffect(() => {
    filterBarMounts++;
  }, []);
  return (
    <DashboardFilterBar
      filters={filters}
      views={[
        {
          id: "launch",
          filters: { f_app: "slides,design" },
          isDefault: true,
        },
        { id: "staff", filters: { f_app: "chat", f_staff: "true" } },
      ]}
    />
  );
}

function QueryProbe() {
  const { search } = useLocation();
  useBlocker(() => blockNavigations);
  useSqlQuery(["filter-feedback", search], search || "unfiltered", "demo");
  useEffect(() => {
    committedQueries.push(search);
  }, [search]);
  return null;
}

async function render(
  initialEntry = "/dashboards/test?tab=activity",
  initialEntries = [initialEntry],
  keepBarMountedOnError = false,
  { basename = "/", synchronous = false } = {},
) {
  loads = [];
  committedQueries = [];
  const route = {
    path: "/dashboards/:id",
    action: ({ request }: { request: Request }) =>
      new Promise<void>((resolve) => {
        submission = { resolve, signal: request.signal };
      }),
    loader: synchronous
      ? undefined
      : ({ request }: { request: Request }) =>
          new Promise<void | Response>((resolve, reject) => {
            loads.push({
              pathname: new URL(request.url).pathname,
              search: new URL(request.url).search,
              resolve,
              reject,
            });
          }),
    element: <QueryProbe />,
    errorElement: <p role="alert">Navigation failed</p>,
  };
  router = createMemoryRouter(
    keepBarMountedOnError
      ? [
          {
            element: (
              <>
                <TrackedFilterBar />
                <Outlet />
              </>
            ),
            children: [route],
          },
        ]
      : [
          {
            ...route,
            element: (
              <>
                <TrackedFilterBar />
                <QueryProbe />
              </>
            ),
          },
        ],
    { initialEntries, basename },
  );
  await act(async () => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    );
    if (!synchronous) loads[0].resolve();
  });
}

function appTrigger() {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="dialog"]',
  )!;
}

function button(text: string, scope: ParentNode = document.body) {
  const match = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) => el.textContent?.trim() === text,
  );
  if (!match) throw new Error(`Missing button: ${text}`);
  return match;
}

function option(text: string) {
  const label = [...document.querySelectorAll("label")].find(
    (el) => el.textContent === text,
  )!;
  return document.getElementById(label.htmlFor) as HTMLButtonElement;
}

function select(index: number, text: string) {
  act(() =>
    container
      .querySelectorAll('[role="combobox"]')
      [index].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
  );
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((el) => el.textContent === text);
  if (!item) throw new Error(`Missing option: ${text}`);
  act(() => item.click());
}

async function settle() {
  await act(async () => {
    loads[loads.length - 1].resolve();
  });
}

async function holdResponseBody(index: number) {
  let close!: () => void;
  let bodyRead!: () => void;
  const readingBody = new Promise<void>((resolve) => {
    bodyRead = resolve;
  });
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":1}'));
      close = () => controller.close();
    },
  });
  const response = new Response(body, {
    headers: { "Content-Type": "application/json" },
  });
  const readJson = response.json.bind(response);
  response.json = () => {
    bodyRead();
    return readJson();
  };
  await act(async () => {
    loads[index].resolve(response);
    await readingBody;
  });
  return close;
}

describe("dashboard filter feedback during navigation", () => {
  beforeEach(() => {
    blockNavigations = false;
    filterBarMounts = 0;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.callAction.mockReset();
    mocks.callAction.mockResolvedValue({ rows: [{ value: 1 }], schema: [] });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => {
      loads?.forEach((load) => load.resolve());
    });
    act(() => root.unmount());
    router?.dispose();
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("preserves a mounted basename on a synchronous filter edit", async () => {
    await render(
      "/analytics/dashboards/test?id=selected&tab=activity#details",
      undefined,
      false,
      { basename: "/analytics", synchronous: true },
    );
    act(() => button("Off").click());
    expect(router.state.navigation.state).toBe("idle");
    expect(router.state.location.pathname).toBe("/analytics/dashboards/test");
    expect(router.state.location.search).toBe(
      "?id=selected&tab=activity&f_staff=true",
    );
    expect(router.state.location.hash).toBe("#details");
    expect(router.state.errors).toBeNull();
    expect(button("On")).toBeDefined();
    expect(filterBarMounts).toBe(1);
    await act(async () => {});
    expect(committedQueries).toEqual([
      "?id=selected&tab=activity",
      "?id=selected&tab=activity&f_staff=true",
    ]);
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual(
      committedQueries,
    );
  });

  it("displays the selection before the loader finishes without starting panel queries", async () => {
    await render();
    act(() => appTrigger().click());
    act(() => button("Launch apps").click());
    expect(loads).toHaveLength(2);
    expect(router.state.navigation.state).toBe("loading");
    expect(appTrigger().textContent).toBe("Launch apps");
    expect(router.state.location.search).toBe("?tab=activity");
    expect(committedQueries).toEqual(["?tab=activity"]);
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await settle();
    expect(router.state.location.search).toBe(
      "?tab=activity&f_app=slides%2Cdesign",
    );
    expect(appTrigger().textContent).toBe("Launch apps");
    expect(committedQueries).toEqual([
      "?tab=activity",
      "?tab=activity&f_app=slides%2Cdesign",
    ]);
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual([
      "?tab=activity",
      "?tab=activity&f_app=slides%2Cdesign",
    ]);
  });

  it("composes rapid edits to the same and different filters, then lets the last navigation win", async () => {
    await render();
    act(() => appTrigger().click());
    act(() => option("Chat").click());
    act(() => option("Slides").click());
    expect(appTrigger().textContent).toBe("Chat, Slides");
    act(() => option("Chat").click());
    act(() => button("Off").click());
    expect(appTrigger().textContent).toBe("Slides");
    expect(button("On")).toBeDefined();
    expect(loads[loads.length - 1].search).toBe(
      "?tab=activity&f_app=slides&f_staff=true",
    );
    await settle();
    expect(router.state.location.search).toBe(
      "?tab=activity&f_app=slides&f_staff=true",
    );
    await act(async () => {
      loads.slice(1, -1).forEach((load) => load.resolve());
    });
    expect(appTrigger().textContent).toBe("Slides");
    expect(committedQueries).toHaveLength(2);
  });

  it("shows a single select urgently and composes it with the pending app preset", async () => {
    await render();
    act(() => appTrigger().click());
    act(() => button("Launch apps").click());
    select(0, "Only .edu");
    expect(container.querySelector('[role="combobox"]')?.textContent).toBe(
      "Only .edu",
    );
    expect(loads[loads.length - 1].search).toBe(
      "?tab=activity&f_app=slides%2Cdesign&f_edu=only",
    );
    await settle();
    expect(router.state.location.search).toBe(loads[loads.length - 1].search);
  });

  it("composes custom start/end dates before navigation settles and clears both on a preset", async () => {
    await render(
      "/dashboards/test?tab=activity&f_timeRange=custom&f_timeRangeStart=2026-10-01&f_timeRangeEnd=2026-10-15",
    );
    act(() => button("Oct 1, 2026").click());
    const start = document.querySelector<HTMLButtonElement>(
      'button[data-day="10/2/2026"]',
    );
    if (!start) throw new Error("Missing October 2 calendar day");
    act(() => start.click());
    act(() => button("Oct 15, 2026").click());
    const end = document.querySelector<HTMLButtonElement>(
      'button[data-day="10/16/2026"]',
    );
    if (!end) throw new Error("Missing October 16 calendar day");
    act(() => end.click());
    expect(button("Oct 2, 2026")).toBeDefined();
    expect(button("Oct 16, 2026")).toBeDefined();
    expect(
      new URLSearchParams(loads[loads.length - 1].search).get(
        "f_timeRangeStart",
      ),
    ).toBe("2026-10-02");
    expect(
      new URLSearchParams(loads[loads.length - 1].search).get("f_timeRangeEnd"),
    ).toBe("2026-10-16");
    select(1, "Last 30 days");
    expect(loads[loads.length - 1].search).toBe(
      "?tab=activity&f_timeRange=30d",
    );
    await settle();
    expect(router.state.location.search).toBe("?tab=activity&f_timeRange=30d");
    expect(
      container.querySelector('[role="group"][aria-label="Custom range"]'),
    ).toBeNull();
  });

  it("resets the pending draft to the saved view and keeps unrelated params", async () => {
    await render();
    act(() => appTrigger().click());
    act(() => option("Chat").click());
    act(() => button("Reset filters").click());
    expect(appTrigger().textContent).toBe("Launch apps");
    expect(loads[loads.length - 1].search).toBe(
      "?tab=activity&f_app=slides%2Cdesign&view=launch",
    );
    await settle();
    expect(router.state.location.search).toBe(loads[loads.length - 1].search);
  });

  it("reconciles an external URL superseding a pending selection and follows Back/Forward", async () => {
    await render();
    act(() => appTrigger().click());
    act(() => button("Launch apps").click());
    let navigation: Promise<void>;
    act(() => {
      navigation = router.navigate("/dashboards/test?tab=other&f_app=chat");
    });
    await act(async () => {
      loads[loads.length - 1].resolve();
      await navigation;
    });
    expect(appTrigger().textContent).toBe("Chat");
    await act(async () => {
      loads[1].resolve();
    });
    expect(appTrigger().textContent).toBe("Chat");
    act(() => {
      void router.navigate(-1);
    });
    await settle();
    expect(appTrigger().textContent).toBe("All");
    act(() => {
      void router.navigate(1);
    });
    await settle();
    expect(appTrigger().textContent).toBe("Chat");
  });

  it("recovers a dashboard route after its error boundary unmounts the filter bar", async () => {
    await render();
    act(() => appTrigger().click());
    act(() => button("Launch apps").click());
    await act(async () => {
      loads[loads.length - 1].reject(new Error("controlled loader failure"));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Navigation failed",
    );
    expect(appTrigger()).toBeNull();
    act(() => {
      void router.navigate("/dashboards/other?f_app=chat");
    });
    await settle();
    expect(appTrigger().textContent).toBe("Chat");
    expect(router.state.location.pathname).toBe("/dashboards/other");
    expect(filterBarMounts).toBe(2);
  });

  it("keeps the same filter bar mounted at the committed failed URL and recovers through its next edit", async () => {
    await render(undefined, undefined, true);
    const mountedTrigger = appTrigger();
    expect(filterBarMounts).toBe(1);
    act(() => mountedTrigger.click());
    act(() => button("Launch apps").click());
    await act(async () => {
      loads[1].reject(new Error("controlled filter loader failure"));
    });
    expect(router.state.navigation.state).toBe("idle");
    expect(router.state.location.search).toBe(
      "?tab=activity&f_app=slides%2Cdesign",
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Navigation failed",
    );
    expect(appTrigger()).toBe(mountedTrigger);
    expect(filterBarMounts).toBe(1);
    expect(appTrigger().textContent).toBe("Launch apps");
    expect(committedQueries).toEqual(["?tab=activity"]);
    expect(mocks.callAction).toHaveBeenCalledTimes(1);

    act(() => button("Off").click());
    expect(loads[2].search).toBe(
      "?tab=activity&f_app=slides%2Cdesign&f_staff=true",
    );
    expect(button("On")).toBeDefined();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await settle();
    expect(router.state.errors).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(router.state.location.search).toBe(loads[2].search);
    expect(appTrigger()).toBe(mountedTrigger);
    expect(filterBarMounts).toBe(1);
    expect(appTrigger().textContent).toBe("Launch apps");
    expect(button("On")).toBeDefined();
    expect(committedQueries).toEqual([
      "?tab=activity",
      "?tab=activity&f_app=slides%2Cdesign&f_staff=true",
    ]);
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual(
      committedQueries,
    );
  });

  it("reconciles a child loader failure in the same mounted bar without reusing a superseded draft", async () => {
    await render(undefined, undefined, true);
    const mountedTrigger = appTrigger();
    expect(filterBarMounts).toBe(1);
    act(() => mountedTrigger.click());
    act(() => option("Chat").click());
    const closeBody = await holdResponseBody(1);
    try {
      let navigation!: Promise<void>;
      act(() => {
        navigation = router.navigate(
          "/dashboards/test?tab=failed&f_app=slides#failed",
        );
      });
      await act(async () => {
        loads[2].reject(new Error("controlled external loader failure"));
        await navigation;
      });
      expect(router.state.navigation.state).toBe("idle");
      expect(router.state.location.search).toBe("?tab=failed&f_app=slides");
      expect(router.state.location.hash).toBe("#failed");
      expect(router.state.errors).not.toBeNull();
      expect(appTrigger()).toBe(mountedTrigger);
      expect(filterBarMounts).toBe(1);
      expect(appTrigger().textContent).toBe("Slides");
      expect(committedQueries).toEqual(["?tab=activity"]);
      expect(mocks.callAction).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => closeBody());
    }
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Navigation failed",
    );
    expect(appTrigger()).toBe(mountedTrigger);
    expect(filterBarMounts).toBe(1);
    expect(appTrigger().textContent).toBe("Slides");
    act(() => button("Off").click());
    expect(loads[3].search).toBe("?tab=failed&f_app=slides&f_staff=true");
    expect(router.state.navigation.state).toBe("loading");
    expect(appTrigger().textContent).toBe("Slides");
    expect(button("On")).toBeDefined();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await settle();
    expect(router.state.errors).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(router.state.location.search).toBe(loads[3].search);
    expect(router.state.location.hash).toBe("#failed");
    expect(appTrigger()).toBe(mountedTrigger);
    expect(filterBarMounts).toBe(1);
    expect(appTrigger().textContent).toBe("Slides");
    expect(button("On")).toBeDefined();
    expect(committedQueries).toEqual([
      "?tab=activity",
      "?tab=failed&f_app=slides&f_staff=true",
    ]);
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual(
      committedQueries,
    );
  });

  it("rolls back a blocked navigation and composes the next edit from the actual URL", async () => {
    await render();
    blockNavigations = true;
    act(() => appTrigger().click());
    await act(async () => button("Launch apps").click());
    expect(router.state.location.search).toBe("?tab=activity");
    expect(appTrigger().textContent).toBe("All");
    blockNavigations = false;
    act(() => appTrigger().click());
    act(() => option("Chat").click());
    await settle();
    expect(router.state.location.search).toBe("?tab=activity&f_app=chat");
    expect(appTrigger().textContent).toBe("Chat");
  });

  it("lets Back interrupt a pending preset without an older draft clobbering history", async () => {
    await render(undefined, [
      "/dashboards/test?f_app=slides",
      "/dashboards/test?f_app=chat",
    ]);
    act(() => appTrigger().click());
    act(() => button("Launch apps").click());
    act(() => {
      void router.navigate(-1);
    });
    await settle();
    expect(appTrigger().textContent).toBe("Slides");
    await act(async () => {
      loads[1].resolve();
    });
    expect(router.state.location.search).toBe("?f_app=slides");
    expect(appTrigger().textContent).toBe("Slides");
  });

  it("preserves the query-selected dashboard identity, hash and unrelated params across rapid edits", async () => {
    await render("/dashboards/test?id=selected&tab=activity#details");
    act(() => appTrigger().click());
    act(() => {
      option("Chat").click();
      button("Off").click();
    });
    expect(loads[loads.length - 1].search).toBe(
      "?id=selected&tab=activity&f_app=chat&f_staff=true",
    );
    await settle();
    expect(router.state.location.search).toBe(loads[loads.length - 1].search);
    expect(router.state.location.hash).toBe("#details");
  });

  it("uses an external commit while a superseded response body remains pending, including for the next edit", async () => {
    await render();
    act(() => appTrigger().click());
    act(() => option("Chat").click());
    const closeBody = await holdResponseBody(1);
    try {
      let navigation!: Promise<void>;
      act(() => {
        navigation = router.navigate(
          "/dashboards/test?tab=other&f_app=slides#new",
        );
      });
      await act(async () => {
        loads[loads.length - 1].resolve();
        await navigation;
      });
      expect(router.state.navigation.state).toBe("idle");
      expect(router.state.location.search).toBe("?tab=other&f_app=slides");
      expect(appTrigger().textContent).toBe("Slides");
      const queryCount = mocks.callAction.mock.calls.length;
      act(() => button("Off").click());
      expect(loads[loads.length - 1].search).toBe(
        "?tab=other&f_app=slides&f_staff=true",
      );
      expect(mocks.callAction).toHaveBeenCalledTimes(queryCount);
      await settle();
      expect(router.state.location.search).toBe(
        "?tab=other&f_app=slides&f_staff=true",
      );
      expect(router.state.location.hash).toBe("#new");
    } finally {
      await act(async () => {
        closeBody();
      });
    }
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual(
      committedQueries,
    );
    expect(committedQueries[committedQueries.length - 1]).toBe(
      "?tab=other&f_app=slides&f_staff=true",
    );
    expect(committedQueries).not.toContain("?tab=activity&f_app=chat");
  });

  it("keeps the newer allowed draft when a superseded pending response body finishes first", async () => {
    await render();
    act(() => appTrigger().click());
    act(() => option("Chat").click());
    const closeBody = await holdResponseBody(1);
    try {
      act(() => option("Slides").click());
      expect(appTrigger().textContent).toBe("Chat, Slides");
      await act(async () => closeBody());
      expect(router.state.navigation.state).toBe("loading");
      expect(appTrigger().textContent).toBe("Chat, Slides");
      expect(mocks.callAction).toHaveBeenCalledTimes(1);
      act(() => button("Off").click());
      expect(loads[loads.length - 1].search).toBe(
        "?tab=activity&f_app=chat%2Cslides&f_staff=true",
      );
      await settle();
      expect(appTrigger().textContent).toBe("Chat, Slides");
      expect(mocks.callAction).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => {
        loads.forEach((load) => load.resolve());
      });
    }
  });

  it.each([
    "/dashboards/other?id=selected&tab=other&f_app=slides#external",
    "/dashboards/test?id=other&tab=other&f_app=slides#external",
  ])(
    "reconciles an external dashboard identity change to %s before composing the next edit",
    async (target) => {
      await render("/dashboards/test?id=selected&tab=activity");
      act(() => appTrigger().click());
      act(() => option("Chat").click());
      const closeBody = await holdResponseBody(1);
      try {
        let navigation!: Promise<void>;
        act(() => {
          navigation = router.navigate(target);
        });
        await act(async () => {
          loads[loads.length - 1].resolve();
          await navigation;
        });
        expect(appTrigger().textContent).toBe("Slides");
        act(() => button("Off").click());
        const expected = new URL(target, "https://example.test");
        expect(loads[loads.length - 1].search).toBe(
          `${expected.search}&f_staff=true`,
        );
        await settle();
        expect(router.state.location.pathname).toBe(expected.pathname);
        expect(router.state.location.hash).toBe("#external");
      } finally {
        await act(async () => closeBody());
      }
    },
  );

  it("preserves a mounted basename while composing a pending same-dashboard view and hash", async () => {
    await render(
      "/analytics/dashboards/test?id=selected&tab=activity#old",
      undefined,
      false,
      { basename: "/analytics" },
    );
    act(() => {
      void router.navigate(
        "/dashboards/test?id=selected&tab=other&view=staff&keep=one&keep=two&f_app=slides#target",
      );
    });
    expect(router.state.navigation.location?.pathname).toBe(
      "/analytics/dashboards/test",
    );
    const externalKey = router.state.navigation.location?.key;
    act(() => button("Off").click());
    const expected =
      "?id=selected&tab=other&view=staff&keep=one&keep=two&f_app=slides&f_staff=true";
    expect(router.state.location.pathname).toBe("/analytics/dashboards/test");
    expect(router.state.errors).toBeNull();
    expect(router.state.navigation.location?.pathname).toBe(
      "/analytics/dashboards/test",
    );
    expect(router.state.navigation.location?.search).toBe(expected);
    expect(router.state.navigation.location?.hash).toBe("#target");
    expect(router.state.navigation.location?.key).not.toBe(externalKey);
    expect(loads[2].pathname).toBe("/analytics/dashboards/test");
    expect(loads[2].search).toBe(expected);
    expect(appTrigger().textContent).toBe("Slides");
    expect(button("On")).toBeDefined();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    select(0, "Only .edu");
    expect(loads[3].search).toBe(`${expected}&f_edu=only`);
    await act(async () => loads[1].resolve());
    expect(router.state.navigation.state).toBe("loading");
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await settle();
    await act(async () => loads[2].resolve());
    expect(router.state.location.pathname).toBe("/analytics/dashboards/test");
    expect(router.state.location.search).toBe(`${expected}&f_edu=only`);
    expect(router.state.location.hash).toBe("#target");
    expect(router.state.errors).toBeNull();
    expect(filterBarMounts).toBe(1);
    expect(committedQueries).toEqual([
      "?id=selected&tab=activity",
      `${expected}&f_edu=only`,
    ]);
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual(
      committedQueries,
    );
  });

  it("merges edits into a pending external tab/view/search/hash target and keeps the newer draft", async () => {
    await render("/dashboards/test?id=selected&tab=activity#old");
    act(() => appTrigger().click());
    act(() => option("Chat").click());
    act(() => {
      void router.navigate(
        "/dashboards/test?id=selected&tab=other&view=staff&keep=one&keep=two&f_app=slides#target",
      );
    });
    const externalKey = router.state.navigation.location?.key;
    act(() => button("Off").click());
    const expected =
      "?id=selected&tab=other&view=staff&keep=one&keep=two&f_app=slides&f_staff=true";
    expect(loads[3].pathname).toBe("/dashboards/test");
    expect(loads[3].search).toBe(expected);
    expect(router.state.navigation.location?.hash).toBe("#target");
    expect(router.state.navigation.location?.key).not.toBe(externalKey);
    expect(appTrigger().textContent).toBe("Slides");
    expect(button("On")).toBeDefined();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      loads[2].resolve();
      loads[1].resolve();
    });
    expect(appTrigger().textContent).toBe("Slides");
    select(0, "Only .edu");
    expect(loads[4].search).toBe(`${expected}&f_edu=only`);
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await settle();
    await act(async () => loads[3].resolve());
    expect(router.state.location.pathname).toBe("/dashboards/test");
    expect(router.state.location.search).toBe(`${expected}&f_edu=only`);
    expect(router.state.location.hash).toBe("#target");
    expect(committedQueries).toEqual([
      "?id=selected&tab=activity",
      `${expected}&f_edu=only`,
    ]);
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual(
      committedQueries,
    );
  });

  it("resets against the pending external saved view without losing its tab or hash", async () => {
    await render();
    act(() => {
      void router.navigate(
        "/dashboards/test?tab=other&view=staff&f_app=slides&keep=yes#target",
      );
    });
    act(() => button("Reset filters").click());
    expect(loads[2].search).toBe(
      "?tab=other&view=staff&keep=yes&f_app=chat&f_staff=true",
    );
    expect(appTrigger().textContent).toBe("Chat");
    expect(button("On")).toBeDefined();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await settle();
    expect(router.state.location.hash).toBe("#target");
    expect(committedQueries).toEqual(["?tab=activity", loads[2].search]);
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual(
      committedQueries,
    );
  });

  it.each(
    [
      "/dashboards/other?id=selected&tab=other&view=foreign&f_app=slides#target",
      "/dashboards/test?id=other&tab=other&view=foreign&f_app=slides#target",
    ].flatMap((target) =>
      ["Off", "Reset filters", "Launch apps"].map((control) => ({
        target,
        control,
      })),
    ),
  )(
    "preserves pending external dashboard $target instead of transferring an old $control interaction",
    async ({ target, control }) => {
      await render("/dashboards/test?id=selected&tab=activity");
      act(() => appTrigger().click());
      act(() => option("Chat").click());
      let navigation!: Promise<void>;
      act(() => {
        navigation = router.navigate(target);
      });
      const pending = router.state.navigation.location;
      act(() => button(control).click());
      expect(router.state.navigation.location).toBe(pending);
      expect(loads).toHaveLength(3);
      expect(appTrigger().textContent).toBe("All");
      expect(button("Off")).toBeDefined();
      expect(mocks.callAction).toHaveBeenCalledTimes(1);
      await act(async () => {
        loads[2].resolve();
        await navigation;
        loads[1].resolve();
      });
      const expected = new URL(target, "https://example.test");
      expect(router.state.location.pathname).toBe(expected.pathname);
      expect(router.state.location.search).toBe(expected.search);
      expect(router.state.location.hash).toBe("#target");
      expect(appTrigger().textContent).toBe("Slides");
      act(() => button("Off").click());
      expect(loads[3].pathname).toBe(expected.pathname);
      expect(loads[3].search).toBe(`${expected.search}&f_staff=true`);
      expect(mocks.callAction).toHaveBeenCalledTimes(2);
      await settle();
      expect(router.state.location.pathname).toBe(expected.pathname);
      expect(router.state.location.search).toBe(
        `${expected.search}&f_staff=true`,
      );
      expect(router.state.location.hash).toBe("#target");
      expect(committedQueries).toEqual([
        "?id=selected&tab=activity",
        expected.search,
        `${expected.search}&f_staff=true`,
      ]);
      expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual(
        committedQueries,
      );
    },
  );

  it("preserves an external submission and its revalidation before accepting the next filter edit", async () => {
    await render();
    let navigation!: Promise<void>;
    act(() => {
      navigation = router.navigate(
        "/dashboards/test?tab=saved&f_app=slides#write",
        { formMethod: "POST", formData: new FormData() },
      );
    });
    expect(router.state.navigation.state).toBe("submitting");
    const pending = router.state.navigation.location;
    act(() => button("Off").click());
    expect(router.state.navigation.location).toBe(pending);
    expect(router.state.navigation.state).toBe("submitting");
    expect(submission.signal.aborted).toBe(false);
    expect(loads).toHaveLength(1);
    expect(button("Off")).toBeDefined();
    await act(async () => submission.resolve());
    expect(router.state.navigation.state).toBe("loading");
    expect(loads).toHaveLength(2);
    act(() => button("Reset filters").click());
    expect(router.state.navigation.location).toBe(pending);
    expect(submission.signal.aborted).toBe(false);
    expect(loads).toHaveLength(2);
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      loads[1].resolve();
      await navigation;
    });
    expect(router.state.location.search).toBe("?tab=saved&f_app=slides");
    expect(router.state.location.hash).toBe("#write");
    act(() => button("Off").click());
    expect(loads[2].search).toBe("?tab=saved&f_app=slides&f_staff=true");
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    await settle();
    expect(router.state.location.hash).toBe("#write");
    expect(committedQueries).toEqual([
      "?tab=activity",
      "?tab=saved&f_app=slides",
      "?tab=saved&f_app=slides&f_staff=true",
    ]);
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual(
      committedQueries,
    );
  });

  it("does not carry a blocked follow-up edit while the earlier allowed navigation stays pending", async () => {
    await render();
    act(() => appTrigger().click());
    act(() => option("Chat").click());
    blockNavigations = true;
    await act(async () => option("Slides").click());
    const blocker = [...router.state.blockers.values()].find(
      (entry) => entry.state === "blocked",
    )!;
    expect(loads).toHaveLength(2);
    expect(router.state.navigation.location?.search).toBe(
      "?tab=activity&f_app=chat",
    );
    expect(appTrigger().textContent).toBe("Chat");
    act(() => blocker.reset!());
    blockNavigations = false;
    act(() => button("Off").click());
    expect(loads[loads.length - 1].search).toBe(
      "?tab=activity&f_app=chat&f_staff=true",
    );
    expect(appTrigger().textContent).toBe("Chat");
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await settle();
    expect(router.state.location.search).toBe(
      "?tab=activity&f_app=chat&f_staff=true",
    );
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    await act(async () => loads[1].resolve());
    expect(appTrigger().textContent).toBe("Chat");
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
  });
});
