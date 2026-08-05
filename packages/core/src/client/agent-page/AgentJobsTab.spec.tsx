// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({
  manageAutomation: {
    org: vi.fn(),
    user: vi.fn(),
  },
  useRunAutomationNow: vi.fn(),
  useAutomationEvents: vi.fn(),
  useAutomations: vi.fn(),
  useManageAutomation: vi.fn(),
  useManageRecurringJob: vi.fn(),
  useRecurringJobs: vi.fn(),
}));

vi.mock("./use-jobs.js", () => ({
  useAutomationEvents: jobMocks.useAutomationEvents,
  useAutomations: jobMocks.useAutomations,
  useManageAutomation: jobMocks.useManageAutomation,
  useManageRecurringJob: jobMocks.useManageRecurringJob,
  useRecurringJobs: jobMocks.useRecurringJobs,
  useRunAutomationNow: jobMocks.useRunAutomationNow,
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

import { AgentJobsTab } from "./AgentJobsTab.js";

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
    jobMocks.useAutomationEvents.mockReturnValue(queryResult([]));
    jobMocks.useManageRecurringJob.mockReturnValue(mutationResult());
    jobMocks.useRunAutomationNow.mockReturnValue(mutationResult());
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
    expect(container.textContent).toContain("Runs when lead.created.");
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

  it("opens organization creation with scope fixed by its section", () => {
    act(() => {
      root.render(<AgentJobsTab canManageOrg />);
    });

    const organizationSection = [...container.querySelectorAll("section")].find(
      (section) => section.textContent?.includes("Organization"),
    );
    const createButton = [
      ...(organizationSection?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.trim() === "New automation");
    act(() => createButton?.click());

    expect(document.body.textContent).toContain(
      "fixed to the organization scope",
    );
  });

  it("closes the full editor after an explicit automation update succeeds", () => {
    jobMocks.useManageAutomation.mockImplementation(
      (scope: "user" | "org") => ({
        error: null,
        isPending: false,
        mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
          jobMocks.manageAutomation[scope](input);
          options?.onSuccess?.();
        },
      }),
    );
    act(() => {
      root.render(<AgentJobsTab canManageOrg />);
    });

    const eventRow = [...container.querySelectorAll("article")].find((row) =>
      row.textContent?.includes("new lead alert"),
    );
    const editButton = [...(eventRow?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Edit",
    );
    act(() => editButton?.click());
    expect(document.body.textContent).toContain("Edit automation");

    const body =
      document.querySelector<HTMLTextAreaElement>("#automation-body");
    if (!body) throw new Error("No automation instructions field");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(body, "Notify the account team.");
      body.dispatchEvent(new Event("input", { bubbles: true }));
      body.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const saveButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Save changes",
    );
    act(() => saveButton?.click());

    expect(jobMocks.manageAutomation.org).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "update",
        name: "new-lead-alert",
        scope: "organization",
        body: "Notify the account team.",
      }),
    );
    expect(document.body.textContent).not.toContain("Edit automation");
  });
});
