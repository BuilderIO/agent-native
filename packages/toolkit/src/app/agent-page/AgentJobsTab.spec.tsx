// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({
  manageAutomation: {
    org: vi.fn(),
    user: vi.fn(),
  },
  useRunAutomationNow: vi.fn(),
  useAutomations: vi.fn(),
  useAutomationRuns: vi.fn(),
  useAutomationAccountSearch: vi.fn(),
  useAutomationEvents: vi.fn(),
  useManageAutomation: vi.fn(),
  useManageRecurringJob: vi.fn(),
  useRecurringJobs: vi.fn(),
  useScheduledTriggerState: vi.fn(),
}));

vi.mock("./use-jobs.js", () => ({
  useAutomations: jobMocks.useAutomations,
  useAutomationRuns: jobMocks.useAutomationRuns,
  useManageAutomation: jobMocks.useManageAutomation,
  useManageRecurringJob: jobMocks.useManageRecurringJob,
  useRecurringJobs: jobMocks.useRecurringJobs,
  useRunAutomationNow: jobMocks.useRunAutomationNow,
  useScheduledTriggerState: jobMocks.useScheduledTriggerState,
  useAutomationAccountSearch: jobMocks.useAutomationAccountSearch,
  useAutomationEvents: jobMocks.useAutomationEvents,
}));

vi.mock("../chat/index.js", () => ({
  AgentAskPopover: ({
    context,
    draftScope,
    label,
    title,
  }: {
    context: string;
    draftScope?: string;
    label?: string;
    title: string;
  }) => (
    <button
      type="button"
      data-creation-context={context}
      data-draft-scope={draftScope}
    >
      {label ?? title}
    </button>
  ),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org-a", orgName: "Acme" } }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({
    formatDate: (value: string) => value,
  }),
  useT:
    () =>
    (
      _key: string,
      options?: Record<string, string | number | undefined>,
    ): string => {
      let result = String(options?.defaultValue ?? _key);
      for (const [name, value] of Object.entries(options ?? {})) {
        result = result.replaceAll(`{{${name}}}`, String(value));
      }
      return result;
    },
}));

import {
  AgentJobsTab,
  organizationAutomationCreationContext,
} from "./AgentJobsTab.js";

function queryResult<T>(data: T) {
  return {
    data,
    error: null,
    isLoading: false,
  };
}

function mutationResult(mutate: ReturnType<typeof vi.fn> = vi.fn()) {
  return {
    error: null,
    isPending: false,
    mutate,
  };
}

describe("AgentJobsTab organization automations", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    jobMocks.useRecurringJobs.mockImplementation((scope: "user" | "org") =>
      queryResult(
        scope === "org"
          ? [
              {
                id: "legacy-scheduled",
                name: "weekly-report",
                path: "jobs/weekly-report.md",
                scope: "organization",
                schedule: "0 9 * * 1",
                scheduleDescription: "Every Monday",
                instructions: "Send the weekly report.",
                enabled: true,
                lastRun: null,
                lastStatus: null,
                lastError: null,
                nextRun: null,
                createdBy: "owner@example.com",
                mcpTools: [],
                canUpdate: true,
                capabilities: {
                  canEdit: true,
                  canOperate: true,
                  canDelete: true,
                  canManageSharing: true,
                },
              },
            ]
          : [],
      ),
    );
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") =>
      queryResult(
        scope === "org"
          ? [
              {
                id: "event-automation",
                resourceId: "event-automation",
                mcpTools: [],
                classification: "automation",
                name: "new-lead-alert",
                path: "jobs/new-lead-alert.md",
                scope: "organization",
                effectiveRole: "owner",
                sharing: {
                  source: "explicit",
                  visibility: "organization",
                  organizationId: "org-a",
                  grantCount: 0,
                },
                triggerType: "event",
                event: "lead.created",
                schedule: null,
                scheduleDescription: null,
                condition: null,
                body: "Alert the sales team.",
                enabled: true,
                lastRun: null,
                lastStatus: null,
                lastError: null,
                nextRun: null,
                createdBy: "owner@example.com",
                canUpdate: true,
                capabilities: {
                  canEdit: true,
                  canOperate: true,
                  canDelete: true,
                  canManageSharing: true,
                },
              },
            ]
          : [],
      ),
    );
    jobMocks.useAutomationRuns.mockReturnValue(queryResult([]));
    jobMocks.useManageRecurringJob.mockReturnValue(mutationResult());
    jobMocks.useRunAutomationNow.mockReturnValue(mutationResult());
    jobMocks.useAutomationAccountSearch.mockReturnValue({
      data: [],
      isFetching: false,
    });
    jobMocks.useAutomationEvents.mockReturnValue(queryResult([]));
    jobMocks.useManageAutomation.mockImplementation((scope: "user" | "org") =>
      mutationResult(jobMocks.manageAutomation[scope]),
    );
    jobMocks.useScheduledTriggerState.mockReturnValue({
      kind: "resolved",
      status: { available: true, driver: "netlify-scheduled-function" },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens the accessible automation named by a settings link", async () => {
    const original = jobMocks.useAutomations.getMockImplementation();
    if (!original) throw new Error("Missing automation query fixture");
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") => {
      const result = original(scope);
      return scope === "org"
        ? { ...result, data: [{ ...result.data[0], id: "row-id" }] }
        : result;
    });
    window.history.replaceState(
      null,
      "",
      "/workspace/settings/automations?filter=all&automationId=event-automation#details",
    );
    await act(async () => {
      root.render(<AgentJobsTab canManageOrg />);
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("new lead alert");
    expect(dialog?.textContent).toContain("Alert the sales team.");
    expect(jobMocks.useAutomationRuns).toHaveBeenCalledWith(
      { resourceId: "event-automation" },
      true,
    );
    const close = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent.includes("Close"),
    );
    expect(close).toBeDefined();
    await act(async () => close?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(window.location.pathname).toBe("/workspace/settings/automations");
    expect(window.location.search).toBe("?filter=all");
    expect(window.location.hash).toBe("#details");
  });

  it("tracks browser history changes between linked automations", async () => {
    const original = jobMocks.useAutomations.getMockImplementation();
    if (!original) throw new Error("Missing automation query fixture");
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") => {
      const result = original(scope);
      return scope === "org"
        ? {
            ...result,
            data: [
              ...result.data,
              {
                ...result.data[0],
                id: "second",
                resourceId: "second",
                name: "second-automation",
                body: "Second automation body.",
              },
            ],
          }
        : result;
    });
    await act(async () => root.render(<AgentJobsTab />));
    const navigate = async (id: string) => {
      await act(async () => {
        window.history.pushState(null, "", `?automationId=${id}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
    };
    await navigate("event-automation");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "new lead alert",
    );
    await navigate("second");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "second automation",
    );
    await navigate("private-or-deleted");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain(
      "agentChat.settingsShell.integrationDetail.notFoundTitle",
    );
    await navigate("event-automation");
    const close = [...document.querySelectorAll('[role="dialog"] button')].find(
      (button) => button.textContent.includes("Close"),
    ) as HTMLButtonElement | undefined;
    await act(async () => close?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await navigate("event-automation");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "new lead alert",
    );
  });

  it("opens a linked recurring automation by resource ID even when its list row is deduplicated", async () => {
    const original = jobMocks.useAutomations.getMockImplementation();
    if (!original) throw new Error("Missing automation query fixture");
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") => {
      const result = original(scope);
      return scope === "org"
        ? {
            ...result,
            data: [
              {
                ...result.data[0],
                id: "legacy-scheduled",
                resourceId: "legacy-scheduled",
                name: "weekly-report",
                classification: "recurring-job",
                triggerType: "schedule",
                body: "Send the weekly report.",
              },
            ],
          }
        : result;
    });
    window.history.replaceState(null, "", "?automationId=legacy-scheduled");
    await act(async () => root.render(<AgentJobsTab />));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Send the weekly report.",
    );
    expect(jobMocks.useAutomationRuns).toHaveBeenCalledWith(
      { resourceId: "legacy-scheduled" },
      true,
    );
  });

  it("opens and closes ordinary details without changing the URL", async () => {
    const original = jobMocks.useAutomations.getMockImplementation();
    if (!original) throw new Error("Missing automation query fixture");
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") => {
      const result = original(scope);
      return scope === "org"
        ? {
            ...result,
            data: [{ ...result.data[0], lastError: "Run failed" }],
          }
        : result;
    });
    window.history.replaceState(
      null,
      "",
      "/settings/automations?filter=all#jobs",
    );
    await act(async () => root.render(<AgentJobsTab />));
    const details = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "View details",
    );
    expect(details).toBeDefined();
    await act(async () => details?.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Alert the sales team.",
    );
    const close = [...document.querySelectorAll('[role="dialog"] button')].find(
      (button) => button.textContent.includes("Close"),
    ) as HTMLButtonElement | undefined;
    expect(close).toBeDefined();
    await act(async () => close?.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(window.location.search).toBe("?filter=all");
    expect(window.location.hash).toBe("#jobs");
  });

  it("waits for the access-scoped list before opening a linked automation", async () => {
    window.history.replaceState(
      null,
      "",
      "/settings/automations?automationId=event-automation",
    );
    const original = jobMocks.useAutomations.getMockImplementation();
    if (!original) throw new Error("Missing automation query fixture");
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") =>
      scope === "org"
        ? { ...queryResult(undefined), isLoading: true }
        : original(scope),
    );
    await act(async () => root.render(<AgentJobsTab />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).not.toContain(
      "agentChat.settingsShell.integrationDetail.notFoundTitle",
    );

    jobMocks.useAutomations.mockImplementation(original);
    await act(async () => root.render(<AgentJobsTab />));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "new lead alert",
    );
  });

  it("shows not found without opening a different record when access is missing", async () => {
    window.history.replaceState(
      null,
      "",
      "/settings/automations?automationId=private-or-deleted",
    );
    await act(async () => root.render(<AgentJobsTab />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain(
      "agentChat.settingsShell.integrationDetail.notFoundTitle",
    );
    expect(jobMocks.useAutomationRuns).not.toHaveBeenCalled();
  });

  it("reports list failures instead of treating them as a missing record", async () => {
    window.history.replaceState(
      null,
      "",
      "/settings/automations?automationId=private-or-deleted",
    );
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") =>
      scope === "org"
        ? { ...queryResult(undefined), error: new Error("offline") }
        : queryResult([]),
    );
    await act(async () => root.render(<AgentJobsTab />));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("Could not load all automations.");
    expect(container.textContent).not.toContain(
      "agentChat.settingsShell.integrationDetail.notFoundTitle",
    );
  });

  it("shows scheduled and event-triggered organization automations", () => {
    act(() => {
      root.render(<AgentJobsTab scope="org" canManageOrg />);
    });

    expect(jobMocks.useAutomations).toHaveBeenCalledWith("org");
    expect(container.textContent).toContain("weekly report");
    expect(container.textContent).toContain("new lead alert");
    expect(container.textContent).toContain("Runs when lead.created.");
    expect(container.textContent).toContain("Organization");
    expect(container.textContent).toContain(
      "Scheduled, event-triggered, and webhook-triggered automations shared with this organization.",
    );
    expect(container.textContent).not.toContain("personal today");
  });

  it.each(["user", "org"] as const)(
    "deduplicates recurring resources by id within the %s scope",
    (scope) => {
      const resourceScope = scope === "org" ? "organization" : "personal";
      const otherScope = scope === "org" ? "user" : "org";
      const existingJobs = jobMocks.useRecurringJobs.getMockImplementation();
      const existingAutomations =
        jobMocks.useAutomations.getMockImplementation();
      if (!existingJobs || !existingAutomations) {
        throw new Error("Job fixtures are not configured");
      }
      const job = existingJobs("org").data[0];
      const automation = existingAutomations("org").data[0];
      const manageRecurringJob = vi.fn();
      const runNow = vi.fn();
      jobMocks.useRunAutomationNow.mockReturnValue(mutationResult(runNow));
      jobMocks.useManageRecurringJob.mockReturnValue(
        mutationResult(manageRecurringJob),
      );
      jobMocks.useRecurringJobs.mockImplementation(
        (queryScope: "user" | "org") =>
          queryResult(
            queryScope === scope
              ? [
                  {
                    ...job,
                    id: "overlap",
                    name: "same-name",
                    scope: resourceScope,
                  },
                ]
              : [
                  {
                    ...job,
                    id: "other-scope",
                    name: "other-job",
                    scope: otherScope === "org" ? "organization" : "personal",
                  },
                ],
          ),
      );
      jobMocks.useAutomations.mockImplementation((queryScope: "user" | "org") =>
        queryResult(
          queryScope === scope
            ? [
                {
                  ...automation,
                  id: "overlap",
                  resourceId: "overlap",
                  name: "same-name",
                  scope: resourceScope,
                  classification: "recurring-job",
                  lastRun: "2026-01-01T12:00:00.000Z",
                  lastStatus: "error",
                  lastError: "Latest run failed",
                },
                {
                  ...automation,
                  id: "distinct",
                  resourceId: "distinct",
                  name: "same-name",
                  scope: resourceScope,
                },
                {
                  ...automation,
                  id: "legacy-only",
                  resourceId: "legacy-only",
                  name: "legacy-only",
                  scope: resourceScope,
                  classification: "recurring-job",
                  triggerType: "schedule",
                  schedule: "0 9 * * 1",
                  scheduleDescription: "Every Monday",
                  capabilities: {
                    ...automation.capabilities,
                    canOperate: false,
                  },
                },
                {
                  ...automation,
                  id: "other-scope",
                  resourceId: "other-scope",
                  name: "cross-scope",
                  scope: resourceScope,
                },
              ]
            : [],
        ),
      );

      act(() => root.render(<AgentJobsTab scope={scope} canManageOrg />));

      const sections = container.querySelectorAll("section");
      const section = sections[scope === "user" ? 0 : 1];
      const names = [...section.querySelectorAll("article h3")].map(
        (heading) => heading.textContent,
      );
      expect(names).toEqual([
        "same name",
        "same name",
        "legacy only",
        "cross scope",
      ]);
      expect(
        sections[otherScope === "user" ? 0 : 1].querySelectorAll("article"),
      ).toHaveLength(1);

      const rows = section.querySelectorAll("article");
      expect(rows[0].textContent).toContain("Latest run failed");
      expect(rows[0].textContent).toContain("2026-01-01T12:00:00.000Z");
      const recurringToggle =
        rows[0].querySelector<HTMLButtonElement>('[role="switch"]');
      expect(rows[2].querySelector('[role="switch"]')).toBeNull();
      if (!recurringToggle) throw new Error("Missing recurring toggle");
      act(() => recurringToggle.click());
      expect(manageRecurringJob).toHaveBeenCalledWith(
        {
          operation: "update",
          resourceId: "overlap",
          enabled: false,
        },
        undefined,
      );
      expect(manageRecurringJob).toHaveBeenCalledTimes(1);
      expect(jobMocks.manageAutomation[scope]).not.toHaveBeenCalled();
      const legacyMenu = rows[2].querySelector<HTMLButtonElement>(
        'button[aria-haspopup="menu"]',
      );
      if (!legacyMenu) throw new Error("Missing legacy menu");
      act(() => {
        legacyMenu.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
      });
      const legacyActions = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].map((item) => item.textContent.trim());
      expect(legacyActions).toEqual(["Details"]);
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });

      const menu = rows[1].querySelector<HTMLButtonElement>(
        'button[aria-haspopup="menu"]',
      );
      if (!menu) throw new Error("Missing automation menu");
      act(() => {
        menu.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
      });
      const runItem = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((item) => item.textContent.trim() === "Run now");
      if (!runItem) throw new Error("Missing run action");
      act(() => runItem.click());
      const runButton = [
        ...document.querySelectorAll<HTMLButtonElement>(
          '[role="dialog"] button',
        ),
      ].find((button) => button.textContent.trim() === "Run now");
      if (!runButton) throw new Error("Missing run confirmation");
      act(() => runButton.click());
      expect(runNow).toHaveBeenCalledWith(
        { resourceId: "distinct" },
        expect.any(Object),
      );
    },
  );

  it.each(["2026-01-03T12:00:00Z", null])(
    "keeps a framework pause when the automation snapshot has the same last run %s",
    (lastRun) => {
      const job =
        jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
      const automation =
        jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
      if (!job || !automation)
        throw new Error("Job fixtures are not configured");
      let jobResult = {
        ...queryResult([
          {
            ...job,
            enabled: false,
            lastRun,
            lastStatus: "paused",
            lastError: "Framework pause reason",
          },
        ]),
        dataUpdatedAt: 100,
      };
      let automationResult = {
        ...queryResult([
          {
            ...automation,
            id: job.id,
            resourceId: job.id,
            classification: "recurring-job",
            enabled: true,
            lastRun,
            lastStatus: "success",
            lastError: null,
          },
        ]),
        dataUpdatedAt: 200,
      };
      jobMocks.useRecurringJobs.mockImplementation((scope: "user" | "org") =>
        scope === "org" ? jobResult : queryResult([]),
      );
      jobMocks.useAutomations.mockImplementation((scope: "user" | "org") =>
        scope === "org" ? automationResult : queryResult([]),
      );
      const render = () =>
        act(() => root.render(<AgentJobsTab scope="org" canManageOrg />));
      render();
      expect(container.querySelector("article")?.textContent).toContain(
        "paused",
      );
      expect(container.querySelector("article")?.textContent).toContain(
        "Framework pause reason",
      );
      jobResult = {
        ...jobResult,
        dataUpdatedAt: 300,
        data: [
          {
            ...jobResult.data[0],
            enabled: true,
            lastStatus: "success",
            lastError: null,
          },
        ],
      };
      automationResult = {
        ...automationResult,
        data: [
          {
            ...automationResult.data[0],
            enabled: true,
            lastStatus: "success",
            lastError: null,
          },
        ],
      };
      render();
      expect(container.querySelector("article")?.textContent).not.toContain(
        "Framework pause reason",
      );
      expect(container.querySelector("article")?.textContent).toContain(
        "success",
      );
    },
  );

  it.each([
    { state: "loading", canOperate: true },
    { state: "failed", canOperate: true },
    { state: "loading", canOperate: false },
    { state: "failed", canOperate: false },
  ])(
    "gates Run now by operation permission while recurring jobs are $state (allowed: $canOperate)",
    ({ state, canOperate }) => {
      const automation =
        jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
      if (!automation) throw new Error("Automation fixture is not configured");
      const runNow = vi.fn();
      jobMocks.useRunAutomationNow.mockReturnValue(mutationResult(runNow));
      jobMocks.useRecurringJobs.mockImplementation((scope: "user" | "org") =>
        scope === "org"
          ? {
              data: undefined,
              isLoading: state === "loading",
              error: state === "failed" ? new Error("Unavailable") : null,
            }
          : queryResult([]),
      );
      jobMocks.useAutomations.mockImplementation((scope: "user" | "org") =>
        queryResult(
          scope === "org"
            ? [
                {
                  ...automation,
                  classification: "recurring-job",
                  triggerType: "schedule",
                  capabilities: { ...automation.capabilities, canOperate },
                },
              ]
            : [],
        ),
      );
      act(() => root.render(<AgentJobsTab scope="org" canManageOrg />));
      const row = container.querySelector("article");
      expect(row?.querySelector('[role="switch"]')).toBeNull();
      const menu = row?.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="menu"]',
      );
      if (!menu) throw new Error("Missing legacy menu");
      act(() => {
        menu.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
        );
      });
      const items = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ];
      expect(items.map((item) => item.textContent.trim())).toEqual(
        canOperate ? ["Details", "Run now"] : ["Details"],
      );
      if (canOperate) {
        const runItem = items.find(
          (item) => item.textContent.trim() === "Run now",
        );
        if (!runItem) throw new Error("Missing run action");
        act(() => runItem.click());
        const runButton = [
          ...document.querySelectorAll<HTMLButtonElement>(
            '[role="dialog"] button',
          ),
        ].find((button) => button.textContent.trim() === "Run now");
        if (!runButton) throw new Error("Missing run confirmation");
        act(() => runButton.click());
      }
      const expectedRun = [
        { resourceId: automation.resourceId },
        expect.any(Object),
      ];
      expect(runNow.mock.calls).toEqual(canOperate ? [expectedRun] : []);
    },
  );

  it("enables legacy controls once the app-scoped job is available", () => {
    const job =
      jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
    const automation =
      jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
    if (!job || !automation) throw new Error("Job fixtures are not configured");
    let jobs: (typeof job)[] = [];
    jobMocks.useRecurringJobs.mockImplementation((scope: "user" | "org") =>
      queryResult(scope === "org" ? jobs : []),
    );
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") =>
      queryResult(
        scope === "org"
          ? [
              {
                ...automation,
                id: job.id,
                resourceId: job.id,
                name: job.name,
                classification: "recurring-job",
              },
            ]
          : [],
      ),
    );
    act(() => root.render(<AgentJobsTab scope="org" canManageOrg />));
    expect(container.querySelector("article [role=switch]")).toBeNull();
    jobs = [job];
    act(() => root.render(<AgentJobsTab scope="org" canManageOrg />));
    expect(container.querySelector("article [role=switch]")).not.toBeNull();
  });

  it("uses the joined status as the two lists refresh independently", () => {
    const job =
      jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
    const automation =
      jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
    if (!job || !automation) throw new Error("Job fixtures are not configured");
    let jobResult = {
      ...queryResult([
        {
          ...job,
          lastRun: "2026-01-02T12:00:00Z",
          lastStatus: "error",
          lastError: "New job error",
        },
      ]),
      dataUpdatedAt: 200,
    };
    let automationResult = {
      ...queryResult([
        {
          ...automation,
          id: job.id,
          resourceId: job.id,
          classification: "recurring-job",
          lastRun: "2026-01-02T12:00:00Z",
          lastStatus: "error",
          lastError: "New job error",
        },
      ]),
      dataUpdatedAt: 100,
    };
    jobMocks.useRecurringJobs.mockImplementation((scope: "user" | "org") =>
      scope === "org" ? jobResult : queryResult([]),
    );
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") =>
      scope === "org" ? automationResult : queryResult([]),
    );
    const render = () =>
      act(() => root.render(<AgentJobsTab scope="org" canManageOrg />));
    render();
    expect(container.textContent).toContain("New job error");
    automationResult = {
      ...automationResult,
      dataUpdatedAt: 300,
      data: [
        {
          ...automationResult.data[0],
          lastRun: "2026-01-03T12:00:00Z",
          lastStatus: "error",
          lastError: "New history error",
        },
      ],
    };
    render();
    expect(container.textContent).toContain("New history error");
    jobResult = {
      ...jobResult,
      dataUpdatedAt: 400,
      data: [
        {
          ...jobResult.data[0],
          lastRun: "2026-01-03T12:00:00Z",
          lastStatus: "success",
          lastError: null,
        },
      ],
    };
    render();
    expect(container.textContent).toContain("New history error");
    expect(container.querySelector("article")?.textContent).toContain("error");
  });

  it("does not reveal a stale automation while deleting a recurring job and restores it on failure", async () => {
    const actual =
      await vi.importActual<typeof import("./use-jobs.js")>("./use-jobs.js");
    const job =
      jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
    const automation =
      jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
    if (!job || !automation) throw new Error("Job fixtures are not configured");
    jobMocks.useRecurringJobs.mockImplementation(actual.useRecurringJobs);
    jobMocks.useAutomations.mockImplementation(actual.useAutomations);
    jobMocks.useManageRecurringJob.mockImplementation(
      actual.useManageRecurringJob,
    );
    jobMocks.useManageAutomation.mockImplementation(actual.useManageAutomation);

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    client.setQueryData(
      ["action", "list-recurring-jobs", { scope: "personal" }],
      [],
    );
    client.setQueryData(
      ["action", "list-automations", { scope: "personal" }],
      [],
    );
    client.setQueryData(
      ["action", "list-recurring-jobs", { scope: "organization" }],
      [job],
    );
    client.setQueryData(
      ["action", "list-automations", { scope: "organization" }],
      [
        {
          ...automation,
          id: job.id,
          resourceId: job.id,
          name: job.name,
          classification: "recurring-job",
        },
      ],
    );
    const pendingWrites: Array<(error: Error) => void> = [];
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (String(input).includes("manage-recurring-job")) {
            pendingWrites.push(reject);
          }
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentJobsTab scope="org" canManageOrg />
        </QueryClientProvider>,
      ),
    );
    expect(container.querySelectorAll("article")).toHaveLength(1);
    const trigger = container.querySelector<HTMLButtonElement>(
      'article button[aria-haspopup="menu"]',
    );
    if (!trigger) throw new Error("Missing menu trigger");
    act(() => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const deleteItem = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent.trim() === "Delete");
    if (!deleteItem) throw new Error("Missing delete action");
    act(() => deleteItem.click());
    const deleteButton = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent.trim() === "Delete");
    if (!deleteButton) throw new Error("Missing delete confirmation");
    await act(async () => deleteButton.click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ operation: "delete", resourceId: job.id }),
      }),
    );
    expect(container.querySelectorAll("article")).toHaveLength(0);
    const failWrite = pendingWrites.at(0);
    if (!failWrite) throw new Error("Delete request did not start");
    await act(async () => failWrite(new Error("Network failure")));
    await vi.waitFor(() =>
      expect(container.querySelectorAll("article")).toHaveLength(1),
    );
    expect(container.textContent).toContain("weekly report");
    act(() => {
      client.setQueryData<Array<typeof automation>>(
        ["action", "list-automations", { scope: "organization" }],
        (current) => [
          ...(current ?? []),
          {
            ...automation,
            id: "new-automation",
            resourceId: "new-automation",
            name: "new-automation",
          },
        ],
      );
    });
    await vi.waitFor(() =>
      expect(container.textContent).toContain("new automation"),
    );

    const cancel = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((button) => button.textContent.trim() === "Cancel");
    if (!cancel) throw new Error("Missing cancel button");
    act(() => cancel.click());
    const recurringToggle = container.querySelector<HTMLButtonElement>(
      'article [role="switch"]',
    );
    if (!recurringToggle) throw new Error("Missing recurring toggle");
    await act(async () => recurringToggle.click());
    await vi.waitFor(() => expect(pendingWrites).toHaveLength(2));
    act(() => {
      client.setQueryData<Array<typeof automation>>(
        ["action", "list-automations", { scope: "organization" }],
        (current) =>
          current?.map((entry) =>
            entry.id === job.id
              ? {
                  ...entry,
                  lastRun: "2026-01-03T12:00:00Z",
                  lastStatus: "error",
                  lastError: "Concurrent run failure",
                }
              : entry,
          ),
      );
    });
    const failUpdate = pendingWrites.at(1);
    if (!failUpdate) throw new Error("Update request did not start");
    await act(async () => failUpdate(new Error("Network failure")));
    await vi.waitFor(() =>
      expect(container.textContent).toContain("Concurrent run failure"),
    );
    expect(container.textContent).toContain("new automation");
    expect(recurringToggle.getAttribute("aria-checked")).toBe("true");
    client.clear();
  });

  it("uses the joined automation status when an older job response arrives later", () => {
    const job =
      jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
    const automation =
      jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
    if (!job || !automation) throw new Error("Job fixtures are not configured");
    jobMocks.useRecurringJobs.mockImplementation((scope: "user" | "org") => ({
      ...queryResult(
        scope === "org"
          ? [{ ...job, lastRun: "2026-01-03T12:00:00Z", lastStatus: "running" }]
          : [],
      ),
      dataUpdatedAt: 300,
    }));
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") => ({
      ...queryResult(
        scope === "org"
          ? [
              {
                ...automation,
                id: job.id,
                resourceId: job.id,
                classification: "recurring-job",
                lastRun: "2026-01-03T12:00:00Z",
                lastStatus: "success",
              },
            ]
          : [],
      ),
      dataUpdatedAt: 200,
    }));
    act(() => root.render(<AgentJobsTab scope="org" canManageOrg />));
    expect(container.querySelector("article")?.textContent).toContain(
      "success",
    );
    expect(container.querySelector("article")?.textContent).not.toContain(
      "running",
    );
  });

  it.each([
    { operation: "update", source: "refresh" },
    { operation: "delete", source: "refresh" },
    { operation: "update", source: "concurrent update" },
    { operation: "delete", source: "concurrent update" },
  ] as const)(
    "preserves a same-value $source after a failed $operation",
    async ({ operation, source }) => {
      const actual =
        await vi.importActual<typeof import("./use-jobs.js")>("./use-jobs.js");
      const job =
        jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
      const automation =
        jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
      if (!job || !automation)
        throw new Error("Job fixtures are not configured");
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      const jobsKey = [
        "action",
        "list-recurring-jobs",
        { scope: "organization" },
      ] as const;
      const automationsKey = [
        "action",
        "list-automations",
        { scope: "organization" },
      ] as const;
      const matching = {
        ...automation,
        id: job.id,
        resourceId: job.id,
        classification: "recurring-job",
      };
      const otherJob = { ...job, id: "other", name: "other-job" };
      const otherAutomation = {
        ...matching,
        id: "other",
        resourceId: "other",
        name: "other-job",
      };
      client.setQueryData(jobsKey, [job, otherJob]);
      client.setQueryData(automationsKey, [matching, otherAutomation]);
      let rejectWrite: ((error: Error) => void) | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (input: RequestInfo | URL) =>
            new Promise<Response>((_resolve, reject) => {
              if (String(input).includes("manage-recurring-job"))
                rejectWrite = reject;
            }),
        ),
      );
      function MutationControl() {
        const jobs = actual.useRecurringJobs("org");
        const automations = actual.useAutomations("org");
        const mutation = actual.useManageRecurringJob("org");
        return (
          <>
            <output
              data-jobs={JSON.stringify(jobs.data)}
              data-automations={JSON.stringify(automations.data)}
            />
            <button
              data-status={mutation.status}
              onClick={() =>
                mutation.mutate(
                  operation === "delete"
                    ? { operation, resourceId: job.id }
                    : { operation, resourceId: job.id, enabled: false },
                )
              }
            >
              Change
            </button>
          </>
        );
      }
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <MutationControl />
          </QueryClientProvider>,
        ),
      );
      const button = container.querySelector("button");
      if (!button) throw new Error("Missing mutation control");
      await act(async () => {
        button.click();
        await vi.waitFor(() => expect(rejectWrite).toBeDefined());
      });
      const refreshedJobs =
        operation === "delete"
          ? [otherJob]
          : [{ ...job, enabled: false }, otherJob];
      const refreshedAutomations =
        operation === "delete"
          ? [otherAutomation]
          : [{ ...matching, enabled: false }, otherAutomation];
      if (source === "refresh") {
        await client.fetchQuery({
          queryKey: jobsKey,
          queryFn: async () => refreshedJobs,
          staleTime: 0,
        });
        await client.fetchQuery({
          queryKey: automationsKey,
          queryFn: async () => refreshedAutomations,
          staleTime: 0,
        });
      } else {
        client.setQueryData(jobsKey, refreshedJobs);
        client.setQueryData(automationsKey, refreshedAutomations);
      }
      const failWrite = rejectWrite;
      if (!failWrite) throw new Error("Mutation did not start");
      await act(async () => {
        failWrite(new Error("Network failure"));
        await vi.waitFor(() =>
          expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe(
            "error",
          ),
        );
      });
      expect(button.dataset.status).toBe("error");
      const output = container.querySelector("output");
      if (!output) throw new Error("Missing query output");
      expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual(refreshedJobs);
      expect(JSON.parse(output.dataset.automations ?? "null")).toEqual(
        refreshedAutomations,
      );
      expect(client.getQueryData(jobsKey)).toEqual(refreshedJobs);
      expect(client.getQueryData(automationsKey)).toEqual(refreshedAutomations);
      client.clear();
    },
  );

  it.each([false, true])(
    "rolls back only the failed resource when another row changes (concurrent mutation: %s)",
    async (concurrent) => {
      const actual =
        await vi.importActual<typeof import("./use-jobs.js")>("./use-jobs.js");
      const job =
        jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
      const automation =
        jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
      if (!job || !automation)
        throw new Error("Job fixtures are not configured");
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const jobsKey = [
        "action",
        "list-recurring-jobs",
        { scope: "organization" },
      ] as const;
      const automationsKey = [
        "action",
        "list-automations",
        { scope: "organization" },
      ] as const;
      const otherJob = { ...job, id: "other", name: "other-job" };
      const matching = { ...automation, id: job.id, resourceId: job.id };
      const otherAutomation = {
        ...matching,
        id: "other",
        resourceId: "other",
        name: "other-job",
      };
      client.setQueryData(jobsKey, [job, otherJob]);
      client.setQueryData(automationsKey, [matching, otherAutomation]);
      const writes: Array<(error: Error) => void> = [];
      const reads = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          if (
            init?.method !== "POST" ||
            !String(input).includes("manage-recurring-job")
          ) {
            reads();
            return Promise.reject(new Error("Read unavailable"));
          }
          return new Promise<Response>((_resolve, reject) =>
            writes.push(reject),
          );
        }),
      );
      function Controls() {
        const jobs = actual.useRecurringJobs("org");
        const automations = actual.useAutomations("org");
        const first = actual.useManageRecurringJob("org");
        const second = actual.useManageRecurringJob("org");
        return (
          <>
            <output
              data-jobs={JSON.stringify(jobs.data)}
              data-automations={JSON.stringify(automations.data)}
              data-read-error={Boolean(jobs.error || automations.error)}
            />
            <button
              onClick={() =>
                first.mutate({
                  operation: "update",
                  resourceId: job.id,
                  enabled: false,
                })
              }
            >
              First
            </button>
            <button
              onClick={() =>
                second.mutate({
                  operation: "update",
                  resourceId: "other",
                  enabled: false,
                })
              }
            >
              Second
            </button>
          </>
        );
      }
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Controls />
          </QueryClientProvider>,
        ),
      );
      const buttons = container.querySelectorAll("button");
      await act(async () => {
        buttons[0].click();
        await vi.waitFor(() => expect(writes).toHaveLength(1));
        if (concurrent) {
          buttons[1].click();
        } else {
          client.setQueryData<Array<typeof job>>(jobsKey, (items) =>
            items?.map((item) =>
              item.id === "other"
                ? { ...item, name: "changed-elsewhere" }
                : item,
            ),
          );
          client.setQueryData<Array<typeof matching>>(automationsKey, (items) =>
            items?.map((item) =>
              item.id === "other"
                ? { ...item, name: "changed-elsewhere" }
                : item,
            ),
          );
        }
        await vi.waitFor(() => expect(writes).toHaveLength(concurrent ? 2 : 1));
      });
      const failFirst = writes.at(0);
      if (!failFirst) throw new Error("First write did not start");
      await act(async () => {
        failFirst(new Error("Write failed"));
        await vi.waitFor(() =>
          expect(client.getMutationCache().getAll().at(0)?.state.status).toBe(
            "error",
          ),
        );
      });
      const output = container.querySelector("output");
      if (!output) throw new Error("Missing query output");
      await act(async () => {
        await vi.waitFor(() =>
          expect(
            Boolean(
              client.getQueryState(jobsKey)?.error ||
              client.getQueryState(automationsKey)?.error,
            ),
          ).toBe(true),
        );
      });
      await vi.waitFor(() => expect(output.dataset.readError).toBe("true"));
      expect(reads).toHaveBeenCalled();
      expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([
        job,
        concurrent
          ? { ...otherJob, enabled: false }
          : { ...otherJob, name: "changed-elsewhere" },
      ]);
      expect(JSON.parse(output.dataset.automations ?? "null")).toEqual([
        matching,
        concurrent
          ? { ...otherAutomation, enabled: false }
          : { ...otherAutomation, name: "changed-elsewhere" },
      ]);
      if (concurrent) {
        await act(async () => {
          await Promise.all([
            client.cancelQueries({ queryKey: jobsKey }),
            client.cancelQueries({ queryKey: automationsKey }),
          ]);
          await client.fetchQuery({
            queryKey: jobsKey,
            queryFn: async () => [job, otherJob],
            staleTime: 0,
          });
          await client.fetchQuery({
            queryKey: automationsKey,
            queryFn: async () => [matching, otherAutomation],
            staleTime: 0,
          });
        });
      }
      expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([
        job,
        concurrent
          ? { ...otherJob, enabled: false }
          : { ...otherJob, name: "changed-elsewhere" },
      ]);
      expect(JSON.parse(output.dataset.automations ?? "null")).toEqual([
        matching,
        concurrent
          ? { ...otherAutomation, enabled: false }
          : { ...otherAutomation, name: "changed-elsewhere" },
      ]);
      if (concurrent) {
        const failSecond = writes.at(1);
        if (!failSecond) throw new Error("Second write did not start");
        await act(async () => {
          failSecond(new Error("Write failed"));
        });
      }
      await vi.waitFor(() =>
        expect(
          client
            .getMutationCache()
            .getAll()
            .at(concurrent ? 1 : 0)?.state.status,
        ).toBe("error"),
      );
      await vi.waitFor(() =>
        expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([
          job,
          concurrent ? otherJob : { ...otherJob, name: "changed-elsewhere" },
        ]),
      );
      expect(JSON.parse(output.dataset.automations ?? "null")).toEqual([
        matching,
        concurrent
          ? otherAutomation
          : { ...otherAutomation, name: "changed-elsewhere" },
      ]);
      client.clear();
    },
  );

  it("keeps a second same-job edit visible across the first failure and a refetch", async () => {
    const actual =
      await vi.importActual<typeof import("./use-jobs.js")>("./use-jobs.js");
    const job =
      jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
    if (!job) throw new Error("Job fixture is not configured");
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const key = [
      "action",
      "list-recurring-jobs",
      { scope: "organization" },
    ] as const;
    client.setQueryData(key, [job]);
    const writes: Array<(error: Error) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((_resolve, reject) => {
            if (String(input).includes("manage-recurring-job"))
              writes.push(reject);
          }),
      ),
    );
    function Controls() {
      const jobs = actual.useRecurringJobs("org");
      const first = actual.useManageRecurringJob("org");
      const second = actual.useManageRecurringJob("org");
      return (
        <>
          <output data-jobs={JSON.stringify(jobs.data)} />
          <button
            onClick={() =>
              first.mutate({
                operation: "update",
                resourceId: job.id,
                enabled: false,
              })
            }
          >
            First
          </button>
          <button
            onClick={() =>
              second.mutate({
                operation: "update",
                resourceId: job.id,
                enabled: false,
              })
            }
          >
            Second
          </button>
        </>
      );
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Controls />
        </QueryClientProvider>,
      ),
    );
    const buttons = container.querySelectorAll("button");
    await act(async () => {
      buttons[0].click();
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      buttons[1].click();
      await vi.waitFor(() => expect(writes).toHaveLength(2));
    });
    const failFirst = writes.at(0);
    const failSecond = writes.at(1);
    if (!failFirst || !failSecond) throw new Error("Writes did not start");
    await act(async () => {
      failFirst(new Error("Write failed"));
      await vi.waitFor(() =>
        expect(client.getMutationCache().getAll().at(0)?.state.status).toBe(
          "error",
        ),
      );
      await client.cancelQueries({ queryKey: key });
      await client.fetchQuery({
        queryKey: key,
        queryFn: async () => [job],
        staleTime: 0,
      });
    });
    const output = container.querySelector("output");
    if (!output) throw new Error("Missing query output");
    expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([
      { ...job, enabled: false },
    ]);
    await act(async () => {
      failSecond(new Error("Write failed"));
      await vi.waitFor(() =>
        expect(client.getMutationCache().getAll().at(1)?.state.status).toBe(
          "error",
        ),
      );
    });
    expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([job]);
    client.clear();
  });

  it.each([
    { operation: "update", read: "delayed" },
    { operation: "update", read: "failed" },
    { operation: "delete", read: "delayed" },
    { operation: "delete", read: "failed" },
  ] as const)(
    "retains a successful $operation while a $read refresh and another write are pending",
    async ({ operation, read }) => {
      const actual =
        await vi.importActual<typeof import("./use-jobs.js")>("./use-jobs.js");
      const job =
        jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
      const automation =
        jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
      if (!job || !automation)
        throw new Error("Job fixtures are not configured");
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      const jobsKey = [
        "action",
        "list-recurring-jobs",
        { scope: "organization" },
      ] as const;
      const automationsKey = [
        "action",
        "list-automations",
        { scope: "organization" },
      ] as const;
      const allAutomationsKey = ["action", "list-automations", {}] as const;
      const otherJob = { ...job, id: "other", name: "other-job" };
      const matching = {
        ...automation,
        id: job.id,
        resourceId: job.id,
        name: job.name,
      };
      const otherAutomation = {
        ...matching,
        id: "other",
        resourceId: "other",
        name: "other-job",
      };
      const personalAutomation = {
        ...matching,
        id: "personal",
        resourceId: "personal",
        scope: "personal",
      };
      client.setQueryData(jobsKey, [job, otherJob]);
      client.setQueryData(automationsKey, [matching, otherAutomation]);
      client.setQueryData(allAutomationsKey, [
        matching,
        otherAutomation,
        personalAutomation,
      ]);
      const writes: Array<{
        resolve: (response: Response) => void;
        reject: (error: Error) => void;
      }> = [];
      const pendingReads: Array<(error: Error) => void> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          if (
            init?.method === "POST" &&
            String(input).includes("manage-recurring-job")
          ) {
            return new Promise<Response>((resolve, reject) =>
              writes.push({ resolve, reject }),
            );
          }
          return new Promise<Response>((_resolve, reject) => {
            if (read === "failed") reject(new Error("Read unavailable"));
            else pendingReads.push(reject);
          });
        }),
      );
      function Controls() {
        const jobs = actual.useRecurringJobs("org");
        const automations = actual.useAutomations("org");
        const allAutomations = actual.useAutomations();
        const first = actual.useManageRecurringJob("org");
        const second = actual.useManageRecurringJob("org");
        return (
          <>
            <output
              data-jobs={JSON.stringify(jobs.data)}
              data-automations={JSON.stringify(automations.data)}
              data-all={JSON.stringify(allAutomations.data)}
              data-read-error={Boolean(
                jobs.error || automations.error || allAutomations.error,
              )}
            />
            <button
              onClick={() =>
                first.mutate(
                  operation === "delete"
                    ? { operation, resourceId: job.id }
                    : { operation, resourceId: job.id, enabled: false },
                )
              }
            >
              First
            </button>
            <button
              onClick={() =>
                second.mutate({
                  operation: "update",
                  resourceId: "other",
                  enabled: false,
                })
              }
            >
              Second
            </button>
          </>
        );
      }
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Controls />
          </QueryClientProvider>,
        ),
      );
      const buttons = container.querySelectorAll("button");
      await act(async () => {
        buttons[0].click();
        await vi.waitFor(() => expect(writes).toHaveLength(1));
        buttons[1].click();
        await vi.waitFor(() => expect(writes).toHaveLength(2));
      });
      const first = writes.at(0);
      const second = writes.at(1);
      if (!first || !second) throw new Error("Writes did not start");
      await act(async () => {
        first.resolve(
          new Response(
            JSON.stringify(
              operation === "delete"
                ? { deleted: true, resourceId: job.id, name: job.name }
                : {
                    resourceId: job.id,
                    name: job.name,
                    enabled: false,
                    nextRun: null,
                  },
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
        await vi.waitFor(() =>
          expect(client.getMutationCache().getAll().at(0)?.state.status).toBe(
            "success",
          ),
        );
      });
      const output = container.querySelector("output");
      if (!output) throw new Error("Missing query output");
      const savedJob = { ...job, enabled: false, nextRun: null };
      const savedAutomation = { ...matching, enabled: false, nextRun: null };
      const expectedJobs =
        operation === "delete"
          ? [{ ...otherJob, enabled: false }]
          : [savedJob, { ...otherJob, enabled: false }];
      const expectedAutomations =
        operation === "delete"
          ? [{ ...otherAutomation, enabled: false }]
          : [savedAutomation, { ...otherAutomation, enabled: false }];
      expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual(expectedJobs);
      expect(JSON.parse(output.dataset.automations ?? "null")).toEqual(
        expectedAutomations,
      );
      expect(JSON.parse(output.dataset.all ?? "null")).toEqual([
        ...expectedAutomations,
        personalAutomation,
      ]);
      expect(client.getQueryData(jobsKey)).toEqual(
        operation === "delete" ? [otherJob] : [savedJob, otherJob],
      );
      expect(client.getQueryData(automationsKey)).toEqual(
        operation === "delete"
          ? [otherAutomation]
          : [savedAutomation, otherAutomation],
      );
      await act(async () => {
        await vi.waitFor(() =>
          expect(
            read === "failed"
              ? Boolean(
                  client.getQueryState(jobsKey)?.error ||
                  client.getQueryState(automationsKey)?.error,
                )
              : pendingReads.length > 0,
          ).toBe(true),
        );
      });
      await vi.waitFor(() =>
        expect(output.dataset.readError).toBe(
          read === "failed" ? "true" : "false",
        ),
      );
      expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual(expectedJobs);
      await act(async () => {
        second.reject(new Error("Second write failed"));
        await vi.waitFor(() =>
          expect(client.getMutationCache().getAll().at(1)?.state.status).toBe(
            "error",
          ),
        );
        await client.cancelQueries();
        pendingReads.forEach((reject) => reject(new Error("Test finished")));
      });
      client.clear();
    },
  );

  it("retains a later pending edit on the same job after the first succeeds", async () => {
    const actual =
      await vi.importActual<typeof import("./use-jobs.js")>("./use-jobs.js");
    const job =
      jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
    if (!job) throw new Error("Job fixture is not configured");
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const key = [
      "action",
      "list-recurring-jobs",
      { scope: "organization" },
    ] as const;
    client.setQueryData(key, [job]);
    const writes: Array<{
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
    }> = [];
    const reads: Array<(error: Error) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((resolve, reject) => {
            if (String(input).includes("manage-recurring-job"))
              writes.push({ resolve, reject });
            else reads.push(reject);
          }),
      ),
    );
    function Controls() {
      const jobs = actual.useRecurringJobs("org");
      const first = actual.useManageRecurringJob("org");
      const second = actual.useManageRecurringJob("org");
      return (
        <>
          <output data-jobs={JSON.stringify(jobs.data)} />
          <button
            onClick={() =>
              first.mutate({
                operation: "update",
                resourceId: job.id,
                enabled: false,
              })
            }
          >
            First
          </button>
          <button
            onClick={() =>
              second.mutate({
                operation: "update",
                resourceId: job.id,
                enabled: true,
              })
            }
          >
            Second
          </button>
        </>
      );
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Controls />
        </QueryClientProvider>,
      ),
    );
    const buttons = container.querySelectorAll("button");
    await act(async () => {
      buttons[0].click();
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      buttons[1].click();
      await vi.waitFor(() => expect(writes).toHaveLength(2));
    });
    const first = writes.at(0);
    const second = writes.at(1);
    if (!first || !second) throw new Error("Writes did not start");
    await act(async () => {
      first.resolve(
        new Response(
          JSON.stringify({
            resourceId: job.id,
            name: job.name,
            enabled: false,
            nextRun: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await vi.waitFor(() =>
        expect(client.getMutationCache().getAll().at(0)?.state.status).toBe(
          "success",
        ),
      );
    });
    const output = container.querySelector("output");
    if (!output) throw new Error("Missing query output");
    expect(client.getQueryData(key)).toEqual([job]);
    expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([job]);
    await act(async () => {
      second.reject(new Error("Second write failed"));
      await vi.waitFor(() =>
        expect(client.getMutationCache().getAll().at(1)?.state.status).toBe(
          "error",
        ),
      );
    });
    expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([job]);
    await act(async () => {
      await client.cancelQueries();
      await client.fetchQuery({
        queryKey: key,
        queryFn: async () => [{ ...job, enabled: false }],
        staleTime: 0,
      });
      reads.forEach((reject) => reject(new Error("Test finished")));
    });
    await vi.waitFor(() =>
      expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([
        { ...job, enabled: false },
      ]),
    );
    client.clear();
  });

  it("projects a successful schedule edit and framework resume from the action result", async () => {
    const actual =
      await vi.importActual<typeof import("./use-jobs.js")>("./use-jobs.js");
    const job =
      jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
    const automation =
      jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
    if (!job || !automation) throw new Error("Job fixtures are not configured");
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const jobsKey = [
      "action",
      "list-recurring-jobs",
      { scope: "organization" },
    ] as const;
    const automationsKey = [
      "action",
      "list-automations",
      { scope: "organization" },
    ] as const;
    const paused = {
      enabled: false,
      lastStatus: "paused",
      lastError: "Pause reason",
    };
    const matching = {
      ...automation,
      ...paused,
      id: job.id,
      resourceId: job.id,
    };
    client.setQueryData(jobsKey, [{ ...job, ...paused }]);
    client.setQueryData(automationsKey, [matching]);
    let resolveWrite: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveWrite = resolve;
          }),
      ),
    );
    function Controls() {
      const mutation = actual.useManageRecurringJob("org");
      return (
        <button
          onClick={() =>
            mutation.mutate({
              operation: "update",
              resourceId: job.id,
              enabled: true,
              schedule: " 0 8 * * * ",
              timezone: " UTC ",
            })
          }
        >
          Resume
        </button>
      );
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Controls />
        </QueryClientProvider>,
      ),
    );
    const button = container.querySelector("button");
    if (!button) throw new Error("Missing control");
    await act(async () => {
      button.click();
      await vi.waitFor(() => expect(resolveWrite).toBeDefined());
    });
    const finish = resolveWrite;
    if (!finish) throw new Error("Write did not start");
    await act(async () => {
      finish(
        new Response(
          JSON.stringify({
            resourceId: job.id,
            name: job.name,
            enabled: true,
            nextRun: "2026-01-04T08:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await vi.waitFor(() =>
        expect(client.getMutationCache().getAll().at(0)?.state.status).toBe(
          "success",
        ),
      );
    });
    const saved = {
      enabled: true,
      schedule: "0 8 * * *",
      timezone: "UTC",
      scheduleDescription: null,
      nextRun: "2026-01-04T08:00:00Z",
      lastStatus: null,
      lastError: null,
    };
    expect(client.getQueryData(jobsKey)).toEqual([{ ...job, ...saved }]);
    expect(client.getQueryData(automationsKey)).toEqual([
      { ...matching, ...saved },
    ]);
    client.clear();
  });

  it.each(["different fields", "same field"] as const)(
    "does not treat response order as write order for concurrent edits to %s",
    async (mode) => {
      const actual =
        await vi.importActual<typeof import("./use-jobs.js")>("./use-jobs.js");
      const job =
        jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
      const automation =
        jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
      if (!job || !automation)
        throw new Error("Job fixtures are not configured");
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      const jobsKey = [
        "action",
        "list-recurring-jobs",
        { scope: "organization" },
      ] as const;
      const automationsKey = [
        "action",
        "list-automations",
        { scope: "organization" },
      ] as const;
      const matching = {
        ...automation,
        id: job.id,
        resourceId: job.id,
        name: job.name,
      };
      client.setQueryData(jobsKey, [job]);
      client.setQueryData(automationsKey, [matching]);
      const writes: Array<(response: Response) => void> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          if (
            init?.method === "POST" &&
            String(input).includes("manage-recurring-job")
          ) {
            return new Promise<Response>((resolve) => writes.push(resolve));
          }
          return Promise.reject(new Error("Read unavailable"));
        }),
      );
      function Controls() {
        const jobs = actual.useRecurringJobs("org");
        const automations = actual.useAutomations("org");
        const first = actual.useManageRecurringJob("org");
        const second = actual.useManageRecurringJob("org");
        return (
          <>
            <output
              data-jobs={JSON.stringify(jobs.data)}
              data-automations={JSON.stringify(automations.data)}
              data-error={Boolean(jobs.error || automations.error)}
            />
            <button
              onClick={() =>
                first.mutate(
                  mode === "different fields"
                    ? {
                        operation: "update",
                        resourceId: job.id,
                        schedule: "0 8 * * *",
                      }
                    : {
                        operation: "update",
                        resourceId: job.id,
                        enabled: false,
                      },
                )
              }
            >
              First
            </button>
            <button
              onClick={() =>
                second.mutate({
                  operation: "update",
                  resourceId: job.id,
                  enabled: mode === "same field",
                })
              }
            >
              Second
            </button>
          </>
        );
      }
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <Controls />
          </QueryClientProvider>,
        ),
      );
      const buttons = container.querySelectorAll("button");
      await act(async () => {
        buttons[0].click();
        await vi.waitFor(() => expect(writes).toHaveLength(1));
        buttons[1].click();
        await vi.waitFor(() => expect(writes).toHaveLength(2));
      });
      const first = writes.at(0);
      const second = writes.at(1);
      if (!first || !second) throw new Error("Writes did not start");
      const response = (enabled: boolean, nextRun: string | null) =>
        new Response(
          JSON.stringify({
            resourceId: job.id,
            name: job.name,
            enabled,
            nextRun,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      await act(async () => {
        second(response(mode === "same field", "2026-02-02T09:00:00Z"));
        await vi.waitFor(() =>
          expect(client.getMutationCache().getAll().at(1)?.state.status).toBe(
            "success",
          ),
        );
        first(response(mode === "different fields", "2026-02-01T08:00:00Z"));
        await vi.waitFor(() =>
          expect(client.getMutationCache().getAll().at(0)?.state.status).toBe(
            "success",
          ),
        );
        await vi.waitFor(() =>
          expect(
            Boolean(
              client.getQueryState(jobsKey)?.error ||
              client.getQueryState(automationsKey)?.error,
            ),
          ).toBe(true),
        );
      });
      const output = container.querySelector("output");
      if (!output) throw new Error("Missing query output");
      const expected =
        mode === "different fields"
          ? {
              enabled: false,
              schedule: "0 8 * * *",
              scheduleDescription: null,
              nextRun: null,
            }
          : { enabled: true, nextRun: null };
      await vi.waitFor(() => expect(output.dataset.error).toBe("true"));
      expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([
        { ...job, ...expected },
      ]);
      expect(JSON.parse(output.dataset.automations ?? "null")).toEqual([
        { ...matching, ...expected },
      ]);
      await act(async () => {
        await client.cancelQueries();
        await client.fetchQuery({
          queryKey: jobsKey,
          queryFn: async () => [{ ...job, ...expected, enabled: false }],
          staleTime: 0,
        });
        await client.fetchQuery({
          queryKey: automationsKey,
          queryFn: async () => [{ ...matching, ...expected, enabled: false }],
          staleTime: 0,
        });
      });
      await vi.waitFor(() =>
        expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([
          { ...job, ...expected, enabled: false },
        ]),
      );
      await vi.waitFor(() =>
        expect(JSON.parse(output.dataset.automations ?? "null")).toEqual([
          { ...matching, ...expected, enabled: false },
        ]),
      );
      client.clear();
    },
  );

  it("does not overwrite a read of a concurrently committed edit with an older response", async () => {
    const actual =
      await vi.importActual<typeof import("./use-jobs.js")>("./use-jobs.js");
    const job =
      jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
    if (!job) throw new Error("Job fixture is not configured");
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const key = [
      "action",
      "list-recurring-jobs",
      { scope: "organization" },
    ] as const;
    client.setQueryData(key, [job]);
    const writes: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes("manage-recurring-job"))
          return new Promise<Response>((resolve) => {
            writes.push(resolve);
          });
        return Promise.reject(new Error("Read unavailable"));
      }),
    );
    function Controls() {
      const jobs = actual.useRecurringJobs("org");
      const mutation = actual.useManageRecurringJob("org");
      const concurrent = actual.useManageRecurringJob("org");
      return (
        <>
          <output data-jobs={JSON.stringify(jobs.data)} />
          <button
            onClick={() =>
              mutation.mutate({
                operation: "update",
                resourceId: job.id,
                schedule: "0 8 * * *",
              })
            }
          >
            Update
          </button>
          <button
            onClick={() =>
              concurrent.mutate({
                operation: "update",
                resourceId: job.id,
                schedule: "0 7 * * *",
              })
            }
          >
            Concurrent update
          </button>
        </>
      );
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Controls />
        </QueryClientProvider>,
      ),
    );
    const buttons = container.querySelectorAll("button");
    await act(async () => {
      buttons[0].click();
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      buttons[1].click();
      await vi.waitFor(() => expect(writes).toHaveLength(2));
      const later = writes.at(1);
      if (!later) throw new Error("Concurrent write did not start");
      later(
        new Response(
          JSON.stringify({
            resourceId: job.id,
            name: job.name,
            enabled: true,
            nextRun: "2026-02-01T07:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await vi.waitFor(() =>
        expect(client.getMutationCache().getAll().at(1)?.state.status).toBe(
          "success",
        ),
      );
      await client.cancelQueries({ queryKey: key });
      let firstRead = true;
      await client.fetchQuery({
        queryKey: key,
        queryFn: async () => {
          if (!firstRead) throw new Error("Read unavailable");
          firstRead = false;
          return [
            {
              ...job,
              schedule: "0 7 * * *",
              scheduleDescription: "Seven",
              nextRun: "2026-02-01T07:00:00Z",
            },
          ];
        },
        staleTime: 0,
      });
    });
    const finish = writes.at(0);
    if (!finish) throw new Error("Write did not start");
    await act(async () => {
      finish(
        new Response(
          JSON.stringify({
            resourceId: job.id,
            name: job.name,
            enabled: true,
            nextRun: "2026-02-01T08:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await vi.waitFor(() =>
        expect(client.getMutationCache().getAll().at(0)?.state.status).toBe(
          "success",
        ),
      );
    });
    const output = container.querySelector("output");
    if (!output) throw new Error("Missing query output");
    await vi.waitFor(() =>
      expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([
        {
          ...job,
          schedule: "0 7 * * *",
          scheduleDescription: "Seven",
          nextRun: null,
        },
      ]),
    );
    client.clear();
  });

  it("keeps a successful enable after an older list read and a failed refresh", async () => {
    const actual =
      await vi.importActual<typeof import("./use-jobs.js")>("./use-jobs.js");
    const job =
      jobMocks.useRecurringJobs.getMockImplementation()?.("org").data[0];
    const automation =
      jobMocks.useAutomations.getMockImplementation()?.("org").data[0];
    if (!job || !automation) throw new Error("Job fixtures are not configured");
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const jobsKey = [
      "action",
      "list-recurring-jobs",
      { scope: "organization" },
    ] as const;
    const automationsKey = [
      "action",
      "list-automations",
      { scope: "organization" },
    ] as const;
    const paused = {
      ...job,
      enabled: false,
      lastStatus: "paused",
      lastError: "Pause reason",
    };
    const matching = {
      ...automation,
      id: job.id,
      resourceId: job.id,
      name: job.name,
      enabled: false,
      lastStatus: "paused",
      lastError: "Pause reason",
    };
    const otherJob = { ...job, id: "other", name: "other-job" };
    const otherAutomation = {
      ...matching,
      id: "other",
      resourceId: "other",
      name: "other-job",
      enabled: true,
    };
    client.setQueryData(jobsKey, [paused, otherJob]);
    client.setQueryData(automationsKey, [matching, otherAutomation]);
    let finishWrite: ((response: Response) => void) | undefined;
    let finishRead: ((value: (typeof paused)[]) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (
          init?.method === "POST" &&
          String(input).includes("manage-recurring-job")
        ) {
          return new Promise<Response>((resolve) => {
            finishWrite = resolve;
          });
        }
        return Promise.reject(new Error("Refresh unavailable"));
      }),
    );
    function Controls() {
      const jobs = actual.useRecurringJobs("org");
      const automations = actual.useAutomations("org");
      const mutation = actual.useManageRecurringJob("org");
      return (
        <>
          <output
            data-jobs={JSON.stringify(jobs.data)}
            data-automations={JSON.stringify(automations.data)}
            data-error={Boolean(jobs.error || automations.error)}
          />
          <button
            onClick={() =>
              mutation.mutate({
                operation: "update",
                resourceId: job.id,
                enabled: true,
              })
            }
          >
            Enable
          </button>
        </>
      );
    }
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Controls />
        </QueryClientProvider>,
      ),
    );
    let initialRead: Promise<(typeof paused)[]> | undefined;
    let firstRead = true;
    await act(async () => {
      initialRead = client.fetchQuery({
        queryKey: jobsKey,
        staleTime: 0,
        queryFn: () => {
          if (!firstRead)
            return Promise.reject(new Error("Refresh unavailable"));
          firstRead = false;
          return new Promise<(typeof paused)[]>((resolve) => {
            finishRead = resolve;
          });
        },
      });
      await vi.waitFor(() => expect(finishRead).toBeDefined());
    });
    const button = container.querySelector("button");
    if (!button) throw new Error("Missing enable button");
    await act(async () => {
      button.click();
      await vi.waitFor(() => expect(finishWrite).toBeDefined());
    });
    const output = container.querySelector("output");
    if (!output || !finishRead || !initialRead || !finishWrite)
      throw new Error("Pending requests did not start");
    const resolveRead = finishRead;
    const resolveWrite = finishWrite;
    await vi.waitFor(() =>
      expect(JSON.parse(output.dataset.jobs ?? "null")[0].enabled).toBe(true),
    );
    const savedOther = { ...otherAutomation, name: "changed-elsewhere" };
    await act(async () => {
      client.setQueryData(automationsKey, [matching, savedOther]);
      resolveRead([paused, otherJob]);
      await initialRead;
    });
    expect(JSON.parse(output.dataset.jobs ?? "null")[0].enabled).toBe(true);
    await act(async () => {
      resolveWrite(
        new Response(
          JSON.stringify({
            resourceId: job.id,
            name: job.name,
            enabled: true,
            nextRun: "2026-01-04T08:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
      await vi.waitFor(() =>
        expect(client.getMutationCache().getAll().at(0)?.state.status).toBe(
          "success",
        ),
      );
      await vi.waitFor(() =>
        expect(
          Boolean(
            client.getQueryState(jobsKey)?.error ||
            client.getQueryState(automationsKey)?.error,
          ),
        ).toBe(true),
      );
    });
    await vi.waitFor(() => expect(output.dataset.error).toBe("true"));
    const savedJob = {
      ...paused,
      enabled: true,
      lastStatus: null,
      lastError: null,
      nextRun: "2026-01-04T08:00:00Z",
    };
    const savedAutomation = {
      ...matching,
      enabled: true,
      lastStatus: null,
      lastError: null,
      nextRun: "2026-01-04T08:00:00Z",
    };
    expect(JSON.parse(output.dataset.jobs ?? "null")).toEqual([
      savedJob,
      otherJob,
    ]);
    expect(JSON.parse(output.dataset.automations ?? "null")).toEqual([
      savedAutomation,
      savedOther,
    ]);
    expect(client.getQueryData(jobsKey)).toEqual([savedJob, otherJob]);
    expect(client.getQueryData(automationsKey)).toEqual([
      savedAutomation,
      savedOther,
    ]);
    client.clear();
  });

  it("opens the organization editor with its scope fixed", async () => {
    act(() => {
      root.render(<AgentJobsTab scope="org" canManageOrg />);
    });

    const organizationSection = container.querySelectorAll("section")[1];
    const createButton = [
      ...(organizationSection?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent.trim() === "New automation");
    if (!createButton) throw new Error("No organization create button");

    await act(async () => {
      createButton.click();
      await import("./AutomationEditorDialog.js");
    });

    expect(document.body.textContent).toContain(
      "This automation is fixed to the organization scope.",
    );
  });

  it("stays quiet about the scheduler when schedules actually fire", () => {
    act(() => {
      root.render(<AgentJobsTab scope="org" canManageOrg />);
    });

    expect(
      container.querySelector('[data-testid="scheduled-trigger-notice"]'),
    ).toBeNull();
  });

  it("warns that schedules never fire when the build disabled recurring jobs", () => {
    jobMocks.useScheduledTriggerState.mockReturnValue({
      kind: "resolved",
      status: { available: false, reason: "disabled-by-env" },
    });

    act(() => {
      root.render(<AgentJobsTab scope="org" canManageOrg />);
    });

    const notice = container.querySelector(
      '[data-testid="scheduled-trigger-notice"]',
    );
    expect(notice).not.toBeNull();
    expect(notice?.getAttribute("data-reason")).toBe("disabled-by-env");
    expect(notice?.textContent).toContain("Schedules won't run in this deploy");
    expect(notice?.textContent).toContain(
      "AGENT_NATIVE_DISABLE_RECURRING_JOBS",
    );
  });

  it("names the local opt-in flag instead of blaming the deploy on a dev machine", () => {
    jobMocks.useScheduledTriggerState.mockReturnValue({
      kind: "resolved",
      status: { available: false, reason: "local-development" },
    });

    act(() => {
      root.render(<AgentJobsTab scope="org" canManageOrg />);
    });

    const notice = container.querySelector(
      '[data-testid="scheduled-trigger-notice"]',
    );
    expect(notice?.textContent).toContain(
      "Schedules don't run in local development",
    );
    expect(notice?.textContent).toContain(
      "AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS",
    );
  });

  it("shows no warning while the scheduler status is still loading", () => {
    jobMocks.useScheduledTriggerState.mockReturnValue({ kind: "loading" });

    act(() => {
      root.render(<AgentJobsTab scope="org" canManageOrg />);
    });

    expect(
      container.querySelector('[data-testid="scheduled-trigger-notice"]'),
    ).toBeNull();
  });

  it("says the check failed rather than silently vouching for the deploy", () => {
    jobMocks.useScheduledTriggerState.mockReturnValue({
      kind: "unknown",
      error: new Error("403 Forbidden"),
    });

    act(() => {
      root.render(<AgentJobsTab scope="org" canManageOrg />);
    });

    const notice = container.querySelector(
      '[data-testid="scheduled-trigger-notice"]',
    );
    expect(notice?.getAttribute("data-reason")).toBe("check-failed");
    expect(notice?.textContent).toContain(
      "Couldn't check whether schedules run here",
    );
  });

  it("keeps editing controls but hides Run now when operation is unavailable", () => {
    const existing = jobMocks.useAutomations.getMockImplementation();
    if (!existing) throw new Error("Automation fixture is not configured");
    jobMocks.useAutomations.mockImplementation((scope: "user" | "org") => {
      const result = existing(scope);
      return {
        ...result,
        data: result.data.map((automation: { capabilities: object }) => ({
          ...automation,
          capabilities: { ...automation.capabilities, canOperate: false },
        })),
      };
    });

    act(() => {
      root.render(<AgentJobsTab scope="org" canManageOrg />);
    });
    const row = Array.from(container.querySelectorAll("article")).find(
      (article) => article.textContent?.includes("new lead alert"),
    );
    expect(row?.querySelector('[role="switch"]')).not.toBeNull();
    const trigger = row?.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="menu"]',
    );
    if (!trigger) throw new Error("Automation menu trigger not found");
    act(() => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const items = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).map((item) => item.textContent.trim());
    expect(items).toContain("Edit");
    expect(items).toContain("Delete");
    expect(items).not.toContain("Run now");
  });

  it("routes organization event updates through the organization mutation", () => {
    act(() => {
      root.render(<AgentJobsTab scope="org" canManageOrg />);
    });

    const eventRow = Array.from(container.querySelectorAll("article")).find(
      (row) => row.textContent?.includes("new lead alert"),
    );
    const toggle =
      eventRow?.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");

    act(() => {
      toggle?.click();
    });

    expect(jobMocks.manageAutomation.org).toHaveBeenCalledWith(
      {
        operation: "update",
        resourceId: "event-automation",
        enabled: false,
      },
      undefined,
    );
    expect(jobMocks.manageAutomation.user).not.toHaveBeenCalled();
  });

  describe("in Settings", () => {
    it("tells a member which organization automations they manage, and still lets them create one", () => {
      act(() => {
        root.render(
          <AgentJobsTab
            scope="org"
            variant="settings"
            canManageOrg={false}
            organizationId="org-a"
            organizationName="Builder.io"
          />,
        );
      });

      const headings = [...container.querySelectorAll("h2")].map(
        (heading) => heading.textContent,
      );
      expect(headings).toEqual(["Personal", "Builder.io"]);
      const organizationSection = container.querySelectorAll("section")[1];
      expect(organizationSection?.lastElementChild?.textContent).toBe(
        "You can manage automations you created.",
      );
      const organizationCreateButton = [
        ...(organizationSection?.querySelectorAll("button") ?? []),
      ].find((button) => button.textContent.trim() === "New automation");
      expect(organizationCreateButton).toBeDefined();
      expect(container.textContent).not.toContain(
        "Scheduled, event-triggered, and webhook-triggered automations shared with this organization.",
      );
      // The Settings header carries New automation, so the body doesn't.
      expect(
        container.querySelector(
          '[data-draft-scope="agent-jobs:compact-create"]',
        ),
      ).toBeNull();
    });

    it("gives a member no controls on someone else's automation", () => {
      jobMocks.useAutomations.mockImplementation((scope: "user" | "org") =>
        queryResult(
          scope === "org"
            ? [
                {
                  id: "someone-elses",
                  name: "owner-digest",
                  path: "jobs/owner-digest.md",
                  scope: "organization",
                  effectiveRole: "view",
                  sharing: {
                    source: "explicit",
                    visibility: "organization",
                    organizationId: "org-a",
                    grantCount: 0,
                  },
                  triggerType: "event",
                  event: "lead.created",
                  schedule: null,
                  scheduleDescription: null,
                  condition: null,
                  body: "Send the digest.",
                  enabled: true,
                  lastRun: null,
                  lastStatus: null,
                  lastError: null,
                  nextRun: null,
                  createdBy: "owner@example.com",
                  canUpdate: false,
                },
              ]
            : [],
        ),
      );
      jobMocks.useRecurringJobs.mockReturnValue(queryResult([]));

      act(() => {
        root.render(
          <AgentJobsTab scope="org" variant="settings" canManageOrg={false} />,
        );
      });

      const row = [...container.querySelectorAll("article")].find((article) =>
        article.textContent?.includes("owner digest"),
      );
      expect(row?.querySelector('[role="switch"]')).toBeNull();
      expect(row?.textContent).not.toContain("Pause");
    });

    it("keeps the note off for owners and admins", () => {
      act(() => {
        root.render(
          <AgentJobsTab
            scope="org"
            variant="settings"
            canManageOrg
            organizationName="Acme"
          />,
        );
      });
      expect(container.textContent).not.toContain(
        "You can manage automations you created.",
      );
    });
  });

  it("offers an organization-scoped agent create path when the section is empty", () => {
    jobMocks.useAutomations.mockReturnValue(queryResult([]));
    jobMocks.useRecurringJobs.mockReturnValue(queryResult([]));
    act(() => {
      root.render(<AgentJobsTab scope="org" canManageOrg />);
    });

    const orgCreationButton = Array.from(
      container.querySelectorAll("[data-creation-context]"),
    ).find((button) =>
      button
        .getAttribute("data-creation-context")
        ?.includes("scope=organization"),
    );

    expect(orgCreationButton).not.toBeUndefined();
    expect(organizationAutomationCreationContext()).toContain(
      "manage-automations with action=define and scope=organization",
    );
  });
});
