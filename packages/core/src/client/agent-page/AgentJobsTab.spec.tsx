// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({
  manageAutomation: {
    org: vi.fn(),
    user: vi.fn(),
  },
  useAutomations: vi.fn(),
  useManageAutomation: vi.fn(),
  useManageRecurringJob: vi.fn(),
  useRecurringJobs: vi.fn(),
}));

vi.mock("./use-jobs.js", () => ({
  useAutomations: jobMocks.useAutomations,
  useManageAutomation: jobMocks.useManageAutomation,
  useManageRecurringJob: jobMocks.useManageRecurringJob,
  useRecurringJobs: jobMocks.useRecurringJobs,
}));

vi.mock("../AgentAskPopover.js", () => ({
  AgentAskPopover: ({
    context,
    label,
    title,
  }: {
    context: string;
    label?: string;
    title: string;
  }) => (
    <button type="button" data-creation-context={context}>
      {label ?? title}
    </button>
  ),
}));

vi.mock("../i18n.js", () => ({
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
                name: "new-lead-alert",
                path: "jobs/new-lead-alert.md",
                scope: "organization",
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
              },
            ]
          : [],
      ),
    );
    jobMocks.useManageRecurringJob.mockReturnValue(mutationResult());
    jobMocks.useManageAutomation.mockImplementation((scope: "user" | "org") =>
      mutationResult(jobMocks.manageAutomation[scope]),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows scheduled and event-triggered organization automations", () => {
    act(() => {
      root.render(<AgentJobsTab canManageOrg />);
    });

    expect(jobMocks.useAutomations).toHaveBeenCalledWith("org");
    expect(container.textContent).toContain("weekly report");
    expect(container.textContent).toContain("new lead alert");
    expect(container.textContent).toContain("On lead.created");
    expect(container.textContent).toContain(
      "Scheduled and event-triggered automations shared with this organization.",
    );
    expect(container.textContent).not.toContain("personal today");
  });

  it("routes organization event updates through the organization mutation", () => {
    act(() => {
      root.render(<AgentJobsTab canManageOrg />);
    });

    const eventRow = Array.from(container.querySelectorAll("article")).find(
      (row) => row.textContent?.includes("new lead alert"),
    );
    const pauseButton = Array.from(
      eventRow?.querySelectorAll("button") ?? [],
    ).find((button) => button.textContent?.includes("Pause"));

    act(() => {
      pauseButton?.click();
    });

    expect(jobMocks.manageAutomation.org).toHaveBeenCalledWith(
      {
        operation: "update",
        name: "new-lead-alert",
        scope: "organization",
        enabled: false,
      },
      undefined,
    );
    expect(jobMocks.manageAutomation.user).not.toHaveBeenCalled();
  });

  it("creates organization automations through the scoped automation tool", () => {
    act(() => {
      root.render(<AgentJobsTab canManageOrg />);
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
