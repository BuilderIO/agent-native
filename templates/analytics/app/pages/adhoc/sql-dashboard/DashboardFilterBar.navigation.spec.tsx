// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
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
  search: string;
  resolve: () => void;
  reject: (error: Error) => void;
}[];
let committedQueries: string[];
let blockNavigations = false;
let queryClient: QueryClient;

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
) {
  loads = [];
  committedQueries = [];
  router = createMemoryRouter(
    [
      {
        path: "/dashboards/:id",
        loader: ({ request }) =>
          new Promise<void>((resolve, reject) => {
            loads.push({
              search: new URL(request.url).search,
              resolve,
              reject,
            });
          }),
        element: (
          <>
            <DashboardFilterBar
              filters={filters}
              views={[
                {
                  id: "launch",
                  filters: { f_app: "slides,design" },
                  isDefault: true,
                },
              ]}
            />
            <QueryProbe />
          </>
        ),
        errorElement: <p role="alert">Navigation failed</p>,
      },
    ],
    { initialEntries },
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
    loads[0].resolve();
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

describe("dashboard filter feedback during navigation", () => {
  beforeEach(() => {
    blockNavigations = false;
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

  it("does not retain a failed navigation's selection on a recovered dashboard", async () => {
    await render();
    act(() => appTrigger().click());
    act(() => button("Launch apps").click());
    await act(async () => {
      loads[loads.length - 1].reject(new Error("controlled loader failure"));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Navigation failed",
    );
    act(() => {
      void router.navigate("/dashboards/other?f_app=chat");
    });
    await settle();
    expect(appTrigger().textContent).toBe("Chat");
    expect(router.state.location.pathname).toBe("/dashboards/other");
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
});
