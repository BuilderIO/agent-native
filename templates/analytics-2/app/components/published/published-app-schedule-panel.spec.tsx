// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

import { scheduleWeekday } from "../../../e2e/phase1/flows-11-15";
import { PublishedAppSchedulePanel } from "./PublishedAppSchedulePanel";

const actions = vi.hoisted(() => ({
  query: vi.fn(),
  call: vi.fn(),
  refetch: vi.fn(),
  writeState: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: actions.query,
  callAction: actions.call,
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  writeClientAppState: actions.writeState,
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  actions.query.mockReset();
  actions.call.mockReset();
  actions.refetch.mockReset();
  actions.writeState.mockReset();
  actions.writeState.mockResolvedValue(undefined);
  actions.refetch.mockResolvedValue({});
  actions.call.mockResolvedValue({ effect: "created" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(name: string) {
  const match = [...document.querySelectorAll("button")].find(
    (element) =>
      (element.getAttribute("aria-label") ?? element.textContent?.trim()) ===
      name,
  );
  if (!match) throw new Error(`Missing button ${name}`);
  return match;
}

function control<E extends HTMLElement>(selector: string, name: string): E {
  const match = [...document.querySelectorAll<E>(selector)].find(
    (element) => element.getAttribute("aria-label") === name,
  );
  if (!match) throw new Error(`Missing control ${name}`);
  return match;
}

function option(name: string) {
  const match = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find(
    (element) =>
      (element.getAttribute("aria-label") ?? element.textContent?.trim()) ===
      name,
  );
  if (!match) throw new Error(`Missing option ${name}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function select(name: string, label: string) {
  const trigger = control("button", name);
  await act(async () =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  const item = option(label);
  await act(async () => {
    item.dispatchEvent(
      new PointerEvent("pointerdown", { button: 0, bubbles: true }),
    );
    item.click();
  });
}

async function fill(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setValue?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function page(data: unknown) {
  return { data, isPending: false, isError: false, refetch: actions.refetch };
}

async function mount(rail: HTMLElement | null = null) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        <MemoryRouter>
          <PublishedAppSchedulePanel
            projectId="project-1"
            releaseId="release-1"
            rail={rail}
          />
        </MemoryRouter>
      </AgentNativeI18nProvider>,
    ),
  );
  return async () => {
    await act(async () => root.unmount());
    container.remove();
  };
}

it("opens the schedule manager and saves a weekday notification with its controlled-clock defaults", async () => {
  vi.setSystemTime(new Date("2026-11-18T07:59:00Z"));
  const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
    function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), timeZone: "Europe/Amsterdam" };
    },
  );
  actions.query.mockImplementation((name) => {
    if (name === "list-published-app-schedules") {
      return page({
        schedules: [],
        nextCursor: null,
        canManage: true,
        notificationsAvailable: true,
      });
    }
    if (name === "list-published-app-schedule-recipients") {
      return page({
        members: [
          {
            memberId: "member-colleague",
            name: "Colleague",
            email: "colleague@example.invalid",
          },
        ],
        nextCursor: null,
      });
    }
    return page({ runs: [], nextCursor: null });
  });
  const unmount = await mount();
  try {
    const trigger = button("Scheduled runs & notifications");
    await click(trigger);
    expect(
      [...document.querySelectorAll('[role="tab"]')].map(
        (tab) => tab.textContent,
      ),
    ).toEqual(["Notifications", "Run log"]);
    expect(document.body.textContent).toContain(
      "Set up a schedule to automatically run your app and send notifications.",
    );
    expect(document.body.textContent).toContain(
      "This App doesn't have any schedules configured.",
    );
    expect(document.body.textContent).toContain("No schedules");
    expect(button("All schedules").getAttribute("aria-pressed")).toBe("true");
    expect(button("Your notifications").getAttribute("aria-pressed")).toBe(
      "false",
    );
    await click(button("+ Add schedule"));
    expect(document.body.textContent).toContain("New scheduled run");
    expect(control("button", "Frequency").textContent?.trim()).toBe("Weekly");
    const weekday = scheduleWeekday({
      getByRole: (role: string, options: { name: string }) =>
        [...document.querySelectorAll(`[role="${role}"]`)].filter(
          (element) => element.getAttribute("aria-label") === options.name,
        ),
      getByText: (value: string) =>
        [...document.querySelectorAll("span, option")].filter(
          (element) => element.textContent === value,
        ),
    } as unknown as Parameters<typeof scheduleWeekday>[0]);
    expect(weekday).toEqual([control("button", "Day of the week")]);
    expect(control("button", "Day of the week").textContent?.trim()).toBe(
      "Monday",
    );
    expect(control<HTMLInputElement>("input", "hours (12hr clock)").value).toBe(
      "8",
    );
    expect(control<HTMLInputElement>("input", "minutes").value).toBe("59");
    expect(control("button", "Time zone").title).toBe("Europe/Amsterdam");

    await select("Frequency", "Hourly");
    expect(control<HTMLInputElement>("input", "Minute").value).toBe("59");
    await select("Frequency", "Daily");
    expect(control("button", "AM or PM").textContent?.trim()).toBe("AM");
    await select("Frequency", "Monthly");
    expect(control("button", "Day of the month").textContent?.trim()).toBe(
      "1st",
    );
    await select("Frequency", "Custom");
    const cron = control<HTMLInputElement>("input", "Cron expression");
    expect(cron.value).toBe("0 0 * * 1-5");
    expect(document.body.textContent).toContain(
      "At 12:00 AM, Monday through Friday (Europe/Amsterdam)",
    );
    await click(button("Advanced"));
    expect(
      control("button", "Update published results").getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    expect(
      control("button", "Use cached SQL results").getAttribute("aria-checked"),
    ).toBe("false");

    await fill(cron, "0 0 9 * * 1-5");
    await click(button("Save run"));
    expect(document.body.textContent).toContain(
      "Enter a valid five-field cron expression.",
    );
    expect(document.activeElement).toBe(cron);
    expect(actions.call).not.toHaveBeenCalled();

    await fill(cron, "0 9 * * 1-5");
    await click(control("button", "Time zone"));
    await fill(
      control<HTMLInputElement>("input", "Search time zones"),
      "Europe/Amsterdam",
    );
    await click(option("Europe/Amsterdam"));
    expect(document.body.textContent).toContain(
      "Next run: Nov 18, 2026, 9:00 AM (Europe/Amsterdam)",
    );
    expect(
      document.querySelector('[title="Nov 18, 2026, 8:00 AM UTC"]'),
    ).not.toBeNull();

    await click(button("Save & add notification"));
    expect(document.body.textContent).toContain("New notification");
    expect(actions.call).not.toHaveBeenCalled();
    await fill(control<HTMLInputElement>("input", "Recipient"), "Colleague");
    await click(option("Colleague"));
    expect(control("button", "Notify").textContent?.trim()).toBe(
      "On success or failure",
    );
    await click(button("Save notification"));
    expect(actions.call).toHaveBeenCalledExactlyOnceWith(
      "set-published-app-schedule",
      {
        projectId: "project-1",
        opId: expect.any(String),
        change: {
          kind: "create",
          scheduleId: expect.any(String),
          config: {
            cadence: { kind: "custom", cron: "0 9 * * 1-5" },
            timezone: "Europe/Amsterdam",
            target: "default",
            updatePublishedResults: true,
            useCachedSqlResults: false,
            recipients: [{ memberId: "member-colleague", on: "both" }],
          },
        },
      },
    );
  } finally {
    await unmount();
  }
});

it("docks the schedule manager on desktop and uses a sheet at 390 pixels", async () => {
  actions.query.mockImplementation((name) =>
    name === "list-published-app-schedules"
      ? page({
          schedules: [],
          nextCursor: null,
          canManage: true,
          notificationsAvailable: true,
        })
      : page({ runs: [], nextCursor: null }),
  );
  const rail = document.createElement("div");
  document.body.append(rail);
  const { happyDOM } = window as unknown as {
    happyDOM: { setViewport(viewport: { width: number }): void };
  };
  const originalWidth = window.innerWidth;
  try {
    happyDOM.setViewport({ width: 1280 });
    const unmountDesktop = await mount(rail);
    try {
      const control = button("Scheduled runs & notifications");
      await click(control);
      expect(rail.querySelector("aside")?.id).toBe(
        control.getAttribute("aria-controls"),
      );
      expect(control.getAttribute("aria-expanded")).toBe("true");
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      await unmountDesktop();
    }

    happyDOM.setViewport({ width: 390 });
    const unmountMobile = await mount(rail);
    try {
      await click(button("Scheduled runs & notifications"));
      expect(rail.querySelector("aside")).toBeNull();
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "No schedules",
      );
    } finally {
      await unmountMobile();
    }
  } finally {
    rail.remove();
    happyDOM.setViewport({ width: originalWidth });
  }
});

it("shows failed run and delivery outcomes against the pinned release", async () => {
  actions.query.mockImplementation((name) =>
    name === "list-published-app-schedules"
      ? page({
          schedules: [],
          nextCursor: null,
          canManage: true,
          notificationsAvailable: true,
        })
      : page({
          nextCursor: null,
          runs: [
            {
              tickId: "tick-1",
              scheduleId: "schedule-1",
              dueAt: "2026-11-18T08:00:00Z",
              releaseId: "release-1",
              status: "failed",
              cache: "preserved",
              diagnostic: { code: "fixture_schedule_fault" },
              deliveries: [
                { memberId: "member-colleague", outcome: "unverified" },
              ],
            },
          ],
        }),
  );
  const unmount = await mount();
  try {
    await click(button("Scheduled runs & notifications"));
    await act(async () =>
      button("Run log").dispatchEvent(
        new MouseEvent("mousedown", { button: 0, bubbles: true }),
      ),
    );
    expect(document.body.textContent).toContain(
      "Published results kept from the last successful run.",
    );
    expect(document.body.textContent).toContain("Delivery unverified");
    expect(document.body.textContent).toContain("fixture_schedule_fault");
    expect(
      document.querySelector('[href="/app/project-1/release-1"]')?.textContent,
    ).toBe("Version release-1");
    expect(actions.writeState).toHaveBeenLastCalledWith(
      expect.stringMatching(/^published-app-schedule:/),
      {
        projectId: "project-1",
        releaseId: "release-1",
        panel: "schedules",
        tab: "run-log",
      },
      { requestSource: expect.any(String) },
    );
  } finally {
    await unmount();
  }
});
