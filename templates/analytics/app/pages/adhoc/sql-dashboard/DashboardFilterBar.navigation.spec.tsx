// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  startTransition,
  StrictMode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";
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
import { useFilterSearchParams } from "./use-filter-search-params";

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
let barFilters: DashboardFilter[];
let saveView: ReturnType<typeof vi.fn<() => void>> | undefined;
let savePreset: ReturnType<typeof vi.fn<() => void>> | undefined;
let loadedOwner: string | undefined;
let queuedUpdate: ReturnType<typeof useFilterSearchParams>[1] | undefined;
let queuedAdmission: (() => boolean) | undefined;

function QueuedFilterProbe() {
  const [, update, , canUpdate] = useFilterSearchParams(loadedOwner);
  queuedUpdate ??= update;
  queuedAdmission ??= canUpdate;
  return null;
}

function TrackedFilterBar() {
  useEffect(() => {
    filterBarMounts++;
  }, []);
  return (
    <>
      <DashboardFilterBar
        filters={barFilters}
        loadedDashboardId={loadedOwner}
        onSaveView={saveView}
        onSavePreset={savePreset}
        views={[
          {
            id: "launch",
            filters: { f_app: "slides,design" },
            isDefault: true,
          },
          { id: "staff", filters: { f_app: "chat", f_staff: "true" } },
        ]}
      />
      {loadedOwner && <QueuedFilterProbe />}
    </>
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
    barFilters = filters;
    saveView = undefined;
    savePreset = undefined;
    loadedOwner = undefined;
    queuedUpdate = undefined;
    queuedAdmission = undefined;
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

  function viewNameInput() {
    return document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  }

  function enterViewDraft() {
    act(() => button("Save view").click());
    const input = viewNameInput();
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, " Launch review ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      option("Set as default for this dashboard").click();
    });
    expect(input.value).toBe(" Launch review ");
    expect(
      option("Set as default for this dashboard").getAttribute("aria-checked"),
    ).toBe("true");
    return input;
  }

  it("keeps event admission unavailable before commit and restores it after StrictMode effect replay", async () => {
    loads = [];
    const admissions: boolean[] = [];
    let committed: ReturnType<typeof useFilterSearchParams> | undefined;
    let setups = 0;
    let cleanups = 0;
    function Probe() {
      const result = useFilterSearchParams("test");
      admissions.push(result[3]());
      useLayoutEffect(() => {
        committed = result;
        setups++;
        return () => {
          cleanups++;
        };
      }, []);
      return null;
    }
    router = createMemoryRouter(
      [{ path: "/dashboards/:id", element: <Probe /> }],
      {
        initialEntries: ["/dashboards/test?f_app=chat#target"],
      },
    );
    await act(async () =>
      root.render(
        <StrictMode>
          <RouterProvider router={router} />
        </StrictMode>,
      ),
    );
    expect(admissions).toEqual([false, false]);
    expect(setups).toBe(2);
    expect(cleanups).toBe(1);
    expect(committed![3]()).toBe(true);
    await act(async () =>
      committed![1]((prev) => {
        const next = new URLSearchParams(prev);
        next.set("f_app", "slides");
        return next;
      }),
    );
    expect(router.state.location.search).toBe("?f_app=slides");
    expect(router.state.location.hash).toBe("#target");
    expect(committed![3]()).toBe(true);
  });

  it("rejects speculative owner approval without a key through suspended and abandoned renders", async () => {
    loads = [];
    let committed: ReturnType<typeof useFilterSearchParams> | undefined;
    let setOwner: (owner: string) => void = () => {
      throw new Error("Probe has not rendered");
    };
    let suspendedOwner: string | null = "b";
    const attempts: string[] = [];
    const never = new Promise<never>(() => {});
    function Probe({ owner }: { owner: string }) {
      const result = useFilterSearchParams(owner);
      attempts.push(owner);
      useLayoutEffect(() => {
        committed = result;
      });
      if (owner === suspendedOwner) throw never;
      return <output>{owner}</output>;
    }
    function Owner() {
      const [owner, update] = useState("a");
      setOwner = update;
      return (
        <Suspense fallback={<p>fallback</p>}>
          <Probe owner={owner} />
        </Suspense>
      );
    }
    router = createMemoryRouter(
      [{ path: "/dashboards/:id", element: <Owner /> }],
      {
        initialEntries: ["/dashboards/b?f_current=b#target"],
      },
    );
    await act(async () => root.render(<RouterProvider router={router} />));
    const old = committed!;
    expect(old[3]()).toBe(false);
    await act(async () => startTransition(() => setOwner("b")));
    expect(attempts).toContain("b");
    expect(container.textContent).toBe("a");
    expect(committed).toBe(old);
    expect(old[3]()).toBe(false);
    const update = vi.fn((prev: URLSearchParams) => {
      const next = new URLSearchParams(prev);
      next.set("f_old", "retained");
      return next;
    });
    await act(async () => old[1](update));
    expect(update).not.toHaveBeenCalled();
    expect(router.state.location.search).toBe("?f_current=b");
    expect(router.state.location.hash).toBe("#target");
    await act(async () => setOwner("a"));
    expect(old[3]()).toBe(false);
    suspendedOwner = null;
    await act(async () => setOwner("b"));
    expect(container.textContent).toBe("b");
    expect(committed![3]).toBe(old[3]);
    expect(old[3]()).toBe(true);
  });

  it("blocks a previously queued callback after the router is idle with a different loaded owner", async () => {
    loadedOwner = "selected";
    await render("/dashboards/test?id=selected&f_app=chat", undefined, true);
    const originalUpdate = queuedUpdate!;
    const originalAdmission = queuedAdmission!;
    act(() => {
      void router.navigate("/dashboards/test?id=foreign&f_app=slides#target");
    });
    await settle();
    expect(router.state.navigation.state).toBe("idle");
    act(() =>
      originalUpdate((prev) => {
        const next = new URLSearchParams(prev);
        next.set("f_app", "old-config");
        return next;
      }),
    );
    expect(originalAdmission()).toBe(false);
    expect(router.state.location.search).toBe("?id=foreign&f_app=slides");
    expect(router.state.location.hash).toBe("#target");
    expect(loads).toHaveLength(2);
    expect(appTrigger().disabled).toBe(true);
    act(() => {
      void router.navigate("/dashboards/test?id=selected&f_app=chat");
    });
    await settle();
    expect(originalAdmission()).toBe(true);
    expect(appTrigger().disabled).toBe(false);
  });

  it.each(["foreign", "POST", "revoked owner"])(
    "retains a preset name when live admission rejects %s before controls disable",
    async (reason) => {
      savePreset = vi.fn<() => void>();
      loadedOwner = "selected";
      const original = "/dashboards/test?id=selected&f_app=chat,slides";
      await render(original, undefined, true, {
        synchronous: reason === "revoked owner",
      });
      act(() => appTrigger().click());
      act(() => button("Save as group…").click());
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Group name"]',
      )!;
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, " Review apps ");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const form = input.closest("form")!;
      act(() => {
        startTransition(() => {
          void router.navigate(
            reason === "POST"
              ? `${original}#write`
              : reason === "revoked owner"
                ? "/dashboards/test?id=foreign&f_app=chat,slides"
                : "/dashboards/other?id=foreign&f_app=chat,slides",
            reason === "POST"
              ? { formMethod: "POST", formData: new FormData() }
              : undefined,
          );
          expect(queuedAdmission!()).toBe(false);
          expect(appTrigger().disabled).toBe(false);
          expect(container.querySelector('[aria-busy="true"]')).toBeNull();
          expect(form.isConnected).toBe(true);
          if (reason === "revoked owner") {
            expect(router.state.navigation.state).toBe("idle");
          }
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
          expect(savePreset).not.toHaveBeenCalled();
        });
      });
      act(() => {
        void router.navigate(original);
      });
      if (reason !== "revoked owner") await settle();
      expect(queuedAdmission!()).toBe(true);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      act(() => appTrigger().click());
      act(() => button("Save as group…").click());
      expect(
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Group name"]',
        )!.value,
      ).toBe(" Review apps ");
      expect(savePreset).not.toHaveBeenCalled();
      act(() => button("Save").click());
      expect(savePreset).toHaveBeenCalledExactlyOnceWith("app", {
        label: "Review apps",
        values: ["chat", "slides"],
      });
      expect(
        document.querySelector('input[aria-label="Group name"]'),
      ).toBeNull();
      act(() => button("Save as group…").click());
      expect(
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Group name"]',
        )!.value,
      ).toBe("");
    },
  );

  it.each(["failure", "cancel", "POST"])(
    "preserves a nonempty preset name after temporary busy %s until manual reopen",
    async (outcome) => {
      savePreset = vi.fn<() => void>();
      await render("/dashboards/test?f_app=chat,slides", undefined, true);
      act(() => appTrigger().click());
      act(() => button("Save as group…").click());
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Group name"]',
      )!;
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "Review apps");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const form = input.closest("form")!;
      act(() => {
        void router.navigate(
          outcome === "POST"
            ? "/dashboards/test?f_app=chat,slides#write"
            : "/dashboards/other?f_app=chat,slides#foreign",
          outcome === "POST"
            ? { formMethod: "POST", formData: new FormData() }
            : undefined,
        );
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      act(() =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
      expect(savePreset).not.toHaveBeenCalled();
      if (outcome === "failure")
        await act(async () => loads[1].reject(new Error("controlled failure")));
      else if (outcome === "cancel") {
        act(() => {
          void router.navigate("/dashboards/test?f_app=chat,slides");
        });
        await settle();
      } else {
        await act(async () => submission.resolve());
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        await settle();
      }
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      act(() => appTrigger().click());
      act(() => button("Save as group…").click());
      expect(
        document.querySelector<HTMLInputElement>(
          'input[aria-label="Group name"]',
        )!.value,
      ).toBe("Review apps");
      expect(savePreset).not.toHaveBeenCalled();
    },
  );

  it.each(["failure", "cancel", "POST"])(
    "preserves the save-view draft after protected navigation %s until manual reopen and saves current filters once",
    async (outcome) => {
      saveView = vi.fn<() => void>();
      await render("/dashboards/test?id=selected&f_app=chat", undefined, true);
      const trigger = appTrigger();
      const input = enterViewDraft();
      const save = button("Save");
      act(() => {
        void router.navigate(
          outcome === "POST"
            ? "/dashboards/test?id=selected&f_app=slides#write"
            : "/dashboards/other?id=foreign&f_app=slides#target",
          outcome === "POST"
            ? { formMethod: "POST", formData: new FormData() }
            : undefined,
        );
      });
      const pending = router.state.navigation.location;
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(button("Save view").disabled).toBe(true);
      act(() => {
        save.click();
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
        button("Save view").click();
      });
      expect(saveView).not.toHaveBeenCalled();
      expect(router.state.navigation.location).toBe(pending);
      if (outcome === "POST") {
        await act(async () => submission.resolve());
        expect(submission.signal.aborted).toBe(false);
        expect(button("Save view").disabled).toBe(true);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        await settle();
      } else if (outcome === "failure") {
        await act(async () => loads[1].reject(new Error("controlled failure")));
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(
          "Navigation failed",
        );
      } else {
        act(() => {
          void router.navigate("/dashboards/test?id=selected&f_app=chat");
        });
        await settle();
      }
      expect(appTrigger()).toBe(trigger);
      expect(filterBarMounts).toBe(1);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      act(() => button("Save view").click());
      expect(viewNameInput().value).toBe(" Launch review ");
      expect(
        option("Set as default for this dashboard").getAttribute(
          "aria-checked",
        ),
      ).toBe("true");
      // The persistent layout still owns the original config after child failure.
      // Return there before saving rather than pair it with the failed target id.
      act(() => {
        void router.navigate("/dashboards/test?id=selected&f_app=slides", {
          formMethod: "POST",
          formData: new FormData(),
        });
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(async () => submission.resolve());
      await settle();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      act(() => button("Off").click());
      await settle();
      act(() => button("Save view").click());
      expect(viewNameInput().value).toBe(" Launch review ");
      expect(
        option("Set as default for this dashboard").getAttribute(
          "aria-checked",
        ),
      ).toBe("true");
      await act(async () => button("Save").click());
      expect(saveView).toHaveBeenCalledExactlyOnceWith(
        "Launch review",
        {
          f_app: "slides",
          f_staff: "true",
        },
        true,
      );
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      act(() => button("Save view").click());
      expect(viewNameInput().value).toBe("");
      expect(
        option("Set as default for this dashboard").getAttribute(
          "aria-checked",
        ),
      ).toBe("false");
      expect(button("Save").disabled).toBe(true);
    },
  );

  it.each(["Cancel", "Escape"])(
    "clears a save-view draft on explicit %s",
    async (dismissal) => {
      saveView = vi.fn<() => void>();
      await render("/dashboards/test?f_app=chat");
      const input = enterViewDraft();
      act(() => {
        if (dismissal === "Cancel") button("Cancel").click();
        else
          input.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      act(() => button("Save view").click());
      expect(viewNameInput().value).toBe("");
      expect(
        option("Set as default for this dashboard").getAttribute(
          "aria-checked",
        ),
      ).toBe("false");
      expect(button("Save").disabled).toBe(true);
      expect(saveView).not.toHaveBeenCalled();
    },
  );

  it("keeps save-view single-flight and retains the draft after a rejected save", async () => {
    let rejectSave!: (error: Error) => void;
    saveView = vi.fn<() => void>().mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    await render("/dashboards/test?f_app=chat");
    const input = enterViewDraft();
    act(() => button("Save").click());
    expect(button("Saving...").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    act(() => {
      button("Saving...").click();
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(saveView).toHaveBeenCalledTimes(1);
    await act(async () => rejectSave(new Error("Controlled save failure")));
    expect(viewNameInput().value).toBe(" Launch review ");
    expect(
      option("Set as default for this dashboard").getAttribute("aria-checked"),
    ).toBe("true");
    expect(button("Save").disabled).toBe(false);
    expect(saveView).toHaveBeenCalledTimes(1);
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
    ["input", "foreign"],
    ["toggle", "foreign"],
    ["input", "POST"],
    ["toggle", "POST"],
  ])(
    "recovers inline %s focus when %s begins, without restoring a disabled control",
    async (control, navigation) => {
      barFilters = [...filters, { id: "name", label: "Name", type: "text" }];
      await render("/dashboards/test?id=selected", undefined, true);
      const inline =
        control === "input"
          ? container.querySelector<HTMLInputElement>("input")!
          : button("Off");
      act(() => inline.focus());
      expect(document.activeElement).toBe(inline);
      act(() => {
        void router.navigate(
          navigation === "foreign"
            ? "/dashboards/other?id=foreign#target"
            : "/dashboards/test?id=selected#write",
          navigation === "POST"
            ? { formMethod: "POST", formData: new FormData() }
            : undefined,
        );
      });
      const pending = router.state.navigation.location;
      const busy = container.querySelector<HTMLElement>('[aria-busy="true"]')!;
      expect(inline.disabled).toBe(true);
      expect(document.activeElement).toBe(busy);
      expect(busy.title).toBe("Updating");
      const outside = document.createElement("input");
      container.appendChild(outside);
      act(() => outside.focus());
      if (navigation === "POST") {
        await act(async () => submission.resolve());
        expect(router.state.navigation.location).toBe(pending);
        expect(submission.signal.aborted).toBe(false);
        expect(inline.disabled).toBe(true);
        expect(document.activeElement).toBe(outside);
        await settle();
      } else {
        expect(pending?.pathname).toBe("/dashboards/other");
        expect(pending?.hash).toBe("#target");
        await act(async () => loads[1].reject(new Error("foreign failed")));
      }
      expect(inline.disabled).toBe(false);
      expect(document.activeElement).toBe(outside);
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
      act(() => {
        inline.focus();
        button("Off").click();
      });
      expect(button("On").disabled).toBe(false);
      expect(document.activeElement).toBe(inline);
      await settle();
      expect(router.state.location.search).toBe(
        navigation === "foreign"
          ? "?id=foreign&f_staff=true"
          : "?id=selected&f_staff=true",
      );
      expect(filterBarMounts).toBe(1);
    },
  );

  it.each(["input", "destination"])(
    "preserves outside %s focus when busy begins",
    async (kind) => {
      await render("/dashboards/test?id=selected");
      act(() => button("Off").focus());
      const outside = document.createElement(
        kind === "input" ? "input" : "button",
      );
      container.appendChild(outside);
      outside.addEventListener("click", () => {
        void router.navigate("/dashboards/other?id=foreign#target");
      });
      act(() => {
        outside.focus();
        outside.click();
      });
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(button("Off").disabled).toBe(true);
      expect(document.activeElement).toBe(outside);
      expect(router.state.navigation.location?.pathname).toBe(
        "/dashboards/other",
      );
    },
  );

  it.each(["input", "toggle"])(
    "keeps inline %s focus during ordinary same-dashboard GET updates",
    async (control) => {
      barFilters = [...filters, { id: "name", label: "Name", type: "text" }];
      await render("/dashboards/test?id=selected");
      const inline =
        control === "input"
          ? container.querySelector<HTMLInputElement>("input")!
          : button("Off");
      act(() => inline.focus());
      act(() => {
        void router.navigate("/dashboards/test?id=selected&tab=other#same");
      });
      expect(document.activeElement).toBe(inline);
      expect(inline.disabled).toBe(false);
      act(() => button("Off").click());
      expect(document.activeElement).toBe(inline);
      expect(router.state.navigation.location?.search).toBe(
        "?id=selected&tab=other&f_staff=true",
      );
      expect(router.state.navigation.location?.hash).toBe("#same");
      await settle();
      expect(document.activeElement).toBe(inline);
    },
  );

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

  it("keeps each user edit as a push when superseding an external pending replace, including Back and Forward", async () => {
    const original = "/dashboards/test?id=selected&tab=activity#original";
    await render(original, ["/dashboards/test?tab=before", original]);
    act(() => {
      void router.navigate(
        "/dashboards/test?id=selected&tab=other&view=staff&keep=one&keep=two&f_app=slides#target",
        { replace: true },
      );
    });
    expect(button("Off").disabled).toBe(false);
    expect(appTrigger().disabled).toBe(false);
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    act(() => button("Off").click());
    expect(button("On").disabled).toBe(false);
    const first =
      "?id=selected&tab=other&view=staff&keep=one&keep=two&f_app=slides&f_staff=true";
    expect(router.state.navigation.location?.search).toBe(first);
    await settle();
    expect(router.state.historyAction).toBe("PUSH");
    select(0, "Only .edu");
    const second = `${first}&f_edu=only`;
    await settle();
    expect(router.state.historyAction).toBe("PUSH");
    for (const [delta, search, hash] of [
      [-1, first, "#target"],
      [-1, "?id=selected&tab=activity", "#original"],
      [-1, "?tab=before", ""],
      [1, "?id=selected&tab=activity", "#original"],
      [1, first, "#target"],
      [1, second, "#target"],
    ] as const) {
      act(() => {
        void router.navigate(delta);
      });
      await settle();
      expect(router.state.location.pathname).toBe("/dashboards/test");
      expect(router.state.location.search).toBe(search);
      expect(router.state.location.hash).toBe(hash);
      expect(router.state.historyAction).toBe("POP");
    }
    await act(async () => loads[1].resolve());
    expect(router.state.location.search).toBe(second);
    expect(mocks.callAction.mock.calls.map(([, args]) => args.query)).toEqual([
      "?id=selected&tab=activity",
      first,
      second,
      "?tab=before",
    ]);
    expect(filterBarMounts).toBe(1);
  });

  it.each([
    "multi-select",
    "select",
    "date",
    "date-range",
    "custom range",
    "toggle-date",
    "save view",
  ])(
    "closes an open %s portal and disables every filter until a foreign navigation fails or is canceled",
    async (portal) => {
      saveView = vi.fn<() => void>();
      savePreset = vi.fn<() => void>();
      barFilters = [
        ...filters,
        { id: "day", label: "Day", type: "date", default: "2026-10-01" },
        { id: "period", label: "Period", type: "date-range" },
        {
          id: "since",
          label: "Since",
          type: "toggle-date",
          default: "2026-10-01",
        },
        { id: "name", label: "Name", type: "text" },
      ];
      await render(
        "/dashboards/test?id=selected&f_app=chat,slides&f_since=2026-10-01&f_timeRange=custom&f_timeRangeStart=2026-10-01&f_timeRangeEnd=2026-10-16",
        undefined,
        true,
      );
      if (portal === "multi-select") act(() => appTrigger().click());
      else if (portal === "select")
        act(() =>
          container
            .querySelector('[role="combobox"]')!
            .dispatchEvent(
              new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
            ),
        );
      else if (portal === "save view") act(() => button("Save view").click());
      else {
        const scope =
          portal === "date-range"
            ? container.querySelector('[role="group"][aria-label="Period"]')!
            : portal === "custom range"
              ? container.querySelector(
                  '[role="group"][aria-label="Custom range"]',
                )!
              : container;
        const dates = [
          ...scope.querySelectorAll<HTMLButtonElement>(
            'button[aria-haspopup="dialog"]',
          ),
        ];
        const trigger =
          portal === "date"
            ? dates.find((el) => el.textContent === "Oct 1, 2026")!
            : portal === "toggle-date"
              ? dates[dates.length - 1]
              : dates[0];
        act(() => trigger.click());
      }
      expect(
        document.querySelector('[role="dialog"], [role="listbox"]'),
      ).not.toBeNull();
      // Move keyboard focus into the portal, as a keyboard user would.
      const portalContent = document.querySelector<HTMLElement>(
        '[role="dialog"], [role="listbox"]',
      )!;
      act(() =>
        (
          portalContent.querySelector<HTMLElement>(
            'input, button, [role="option"]',
          ) ?? portalContent
        ).focus(),
      );
      act(() => {
        void router.navigate("/dashboards/other?id=foreign#target");
      });
      const pending = router.state.navigation.location;
      expect(
        document.querySelector('[role="dialog"], [role="listbox"]'),
      ).toBeNull();
      const busy = container.querySelector<HTMLElement>('[aria-busy="true"]')!;
      expect(busy).not.toBeNull();
      expect(busy.title).toBe("Updating");
      await vi.waitFor(() => expect(document.activeElement).toBe(busy));
      for (const control of container.querySelectorAll<
        HTMLButtonElement | HTMLInputElement
      >("button, input")) {
        expect(control.disabled, control.outerHTML).toBe(true);
        act(() => control.click());
      }
      expect(router.state.navigation.location).toBe(pending);
      expect(loads).toHaveLength(2);
      expect(saveView).not.toHaveBeenCalled();
      expect(savePreset).not.toHaveBeenCalled();
      expect(mocks.callAction).toHaveBeenCalledTimes(1);
      if (portal === "save view") {
        await act(async () => loads[1].reject(new Error("foreign failed")));
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(
          "Navigation failed",
        );
      } else {
        act(() => {
          void router.navigate(-1);
        });
        await settle();
      }
      expect(router.state.navigation.state).toBe("idle");
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
      expect(appTrigger().disabled).toBe(false);
      expect(
        document.querySelector('[role="dialog"], [role="listbox"]'),
      ).toBeNull();
      expect(container.querySelector<HTMLInputElement>("input")?.disabled).toBe(
        false,
      );
      expect(saveView).not.toHaveBeenCalled();
      expect(savePreset).not.toHaveBeenCalled();
      act(() => button("Off").click());
      expect(button("On").disabled).toBe(false);
      expect(
        new URLSearchParams(router.state.navigation.location?.search).get(
          "f_staff",
        ),
      ).toBe("true");
      await settle();
      expect(router.state.navigation.state).toBe("idle");
      expect(
        new URLSearchParams(router.state.location.search).get("f_staff"),
      ).toBe("true");
      expect(filterBarMounts).toBe(1);
    },
  );

  it.each(
    ["multi-select", "date"].flatMap((portal) =>
      ["foreign", "POST"].flatMap((method) =>
        ["before close", "after detach"].map((timing) => ({
          portal,
          method,
          timing,
        })),
      ),
    ),
  )(
    "preserves outside focus $timing of $portal during $method",
    async ({ portal, method, timing }) => {
      barFilters = [
        ...filters,
        { id: "day", label: "Day", type: "date", default: "2026-10-01" },
      ];
      await render("/dashboards/test?id=selected", undefined, true);
      const outside = document.createElement("input");
      container.append(outside);
      const trigger =
        portal === "multi-select" ? appTrigger() : button("Oct 1, 2026");
      act(() => trigger.click());
      const content = document.querySelector<HTMLElement>('[role="dialog"]')!;
      act(() =>
        (
          content.querySelector<HTMLElement>("input, button") ?? content
        ).focus(),
      );
      let closeEvent: Event | undefined;
      let detached = false;
      content.addEventListener(
        "focusScope.autoFocusOnUnmount",
        (event) => {
          closeEvent = event;
          detached = !content.isConnected;
          if (timing === "after detach") outside.focus();
        },
        { once: true },
      );
      act(() => {
        if (timing === "before close") outside.focus();
        void router.navigate(
          "/dashboards/other?id=foreign#target",
          method === "POST"
            ? { formMethod: "POST", formData: new FormData() }
            : undefined,
        );
      });
      const pending = router.state.navigation.location;
      await vi.waitFor(() => expect(closeEvent).toBeDefined());
      expect(detached).toBe(true);
      expect(closeEvent!.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(outside);
      expect(trigger.disabled).toBe(true);
      expect(router.state.navigation.location).toBe(pending);
      if (method === "POST") {
        expect(submission.signal.aborted).toBe(false);
        await act(async () => submission.resolve());
        expect(router.state.navigation.state).toBe("loading");
        expect(router.state.navigation.location).toBe(pending);
        expect(document.activeElement).toBe(outside);
      }
      await act(async () => loads[1].reject(new Error("foreign failed")));
      expect(document.activeElement).toBe(outside);
      expect(trigger.disabled).toBe(false);
      expect(filterBarMounts).toBe(1);
    },
  );

  it.each(
    ["multi-select", "date"].flatMap((portal) =>
      ["foreign", "POST"].map((method) => ({ portal, method })),
    ),
  )(
    "recovers genuinely lost $portal focus during $method",
    async ({ portal, method }) => {
      barFilters = [
        ...filters,
        { id: "day", label: "Day", type: "date", default: "2026-10-01" },
      ];
      await render("/dashboards/test?id=selected");
      act(() =>
        (portal === "multi-select"
          ? appTrigger()
          : button("Oct 1, 2026")
        ).click(),
      );
      const content = document.querySelector<HTMLElement>('[role="dialog"]')!;
      act(() =>
        (
          content.querySelector<HTMLElement>("input, button") ?? content
        ).focus(),
      );
      let closeEvent: Event | undefined;
      content.addEventListener(
        "focusScope.autoFocusOnUnmount",
        (event) => {
          (document.activeElement as HTMLElement).blur();
          expect(document.activeElement).toBe(document.body);
          closeEvent = event;
        },
        { once: true },
      );
      act(() => {
        void router.navigate(
          "/dashboards/other?id=foreign",
          method === "POST"
            ? { formMethod: "POST", formData: new FormData() }
            : undefined,
        );
      });
      await vi.waitFor(() => expect(closeEvent).toBeDefined());
      expect(closeEvent!.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(
        container.querySelector('[aria-busy="true"]'),
      );
      if (method === "POST") await act(async () => submission.resolve());
    },
  );

  it.each(["multi-select", "date"])(
    "keeps ordinary enabled %s Escape focus restoration",
    async (portal) => {
      barFilters = [
        ...filters,
        { id: "day", label: "Day", type: "date", default: "2026-10-01" },
      ];
      await render();
      const trigger =
        portal === "multi-select" ? appTrigger() : button("Oct 1, 2026");
      act(() => {
        trigger.focus();
        trigger.click();
      });
      const content = document.querySelector<HTMLElement>('[role="dialog"]')!;
      act(() =>
        (
          content.querySelector<HTMLElement>("input, button") ?? content
        ).focus(),
      );
      act(() =>
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(trigger.disabled).toBe(false);
      expect(router.state.navigation.state).toBe("idle");
      expect(loads).toHaveLength(1);
    },
  );

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
      const oldControl = button(control);
      let navigation!: Promise<void>;
      act(() => {
        navigation = router.navigate(target);
      });
      const pending = router.state.navigation.location;
      expect(
        container.querySelector('[aria-busy="true"]')?.getAttribute("title"),
      ).toBe("Updating");
      expect(appTrigger().disabled).toBe(true);
      expect(button("Off").disabled).toBe(true);
      expect(button("Reset filters").disabled).toBe(true);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      act(() => oldControl.click());
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
    act(() => appTrigger().click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    let navigation!: Promise<void>;
    act(() => {
      navigation = router.navigate(
        "/dashboards/test?tab=saved&f_app=slides#write",
        { formMethod: "POST", formData: new FormData() },
      );
    });
    expect(router.state.navigation.state).toBe("submitting");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const pending = router.state.navigation.location;
    expect(button("Off").disabled).toBe(true);
    expect(appTrigger().disabled).toBe(true);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    act(() => button("Off").click());
    expect(router.state.navigation.location).toBe(pending);
    expect(router.state.navigation.state).toBe("submitting");
    expect(submission.signal.aborted).toBe(false);
    expect(loads).toHaveLength(1);
    expect(button("Off")).toBeDefined();
    await act(async () => submission.resolve());
    expect(router.state.navigation.state).toBe("loading");
    expect(loads).toHaveLength(2);
    expect(button("Reset filters").disabled).toBe(true);
    act(() => appTrigger().click());
    act(() =>
      container
        .querySelector('[role="combobox"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
    );
    expect(
      document.querySelector('[role="dialog"], [role="listbox"]'),
    ).toBeNull();
    expect(
      container.querySelector('[role="combobox"]')?.hasAttribute("disabled"),
    ).toBe(true);
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
