/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({
  manageRecurringJob: vi.fn(),
  useRunAutomationNow: vi.fn(),
  useAutomations: vi.fn(),
  useAutomationRuns: vi.fn(),
  useManageAutomation: vi.fn(),
  useManageRecurringJob: vi.fn(),
}));

vi.mock("./use-jobs.js", () => ({
  useAutomations: jobMocks.useAutomations,
  useAutomationAccountSearch: () => ({ data: [], isFetching: false }),
  useAutomationEvents: () => ({ data: [], error: null, isLoading: false }),
  useAutomationRuns: jobMocks.useAutomationRuns,
  useManageAutomation: jobMocks.useManageAutomation,
  useManageRecurringJob: jobMocks.useManageRecurringJob,
  useRunAutomationNow: jobMocks.useRunAutomationNow,
}));

vi.mock("../org/hooks.js", () => ({
  useOrg: () => ({ data: { orgId: null, orgName: null } }),
}));

vi.mock("../i18n.js", () => ({
  useFormatters: () => ({ formatDate: (value: string) => value }),
  useT:
    () =>
    (
      key: string,
      options?: Record<string, string | number | undefined>,
    ): string => {
      let result = String(options?.defaultValue ?? key);
      for (const [name, value] of Object.entries(options ?? {})) {
        result = result.replaceAll(`{{${name}}}`, String(value));
      }
      return result;
    },
}));

import { AgentJobsTab } from "./AgentJobsTab.js";

const BLOCKED_REASON = 'user "tmilazzo@builder.io" no longer exists';

function queryResult<T>(data: T) {
  return { data, error: null, isLoading: false };
}

describe("AgentJobsTab blocked automation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    jobMocks.useAutomations.mockReturnValue(
      queryResult([
        {
          id: "blocked-job",
          resourceId: "blocked-job",
          name: "competitive-intelligence-daily-email",
          path: "jobs/competitive-intelligence-daily-email.md",
          scope: "personal",
          classification: "recurring-job",
          triggerType: "schedule",
          event: null,
          schedule: "0 8 * * *",
          timezone: "UTC",
          scheduleDescription: "Every day at 8 AM",
          condition: null,
          body: "Send the briefing.",
          enabled: true,
          // The job has never executed; a blocked tick only sets lastCheck.
          lastRun: null,
          lastCheck: "2026-07-31T17:04:14.688Z",
          lastStatus: "skipped",
          lastError: BLOCKED_REASON,
          nextRun: "2026-08-01T08:00:00.000Z",
          createdBy: "tmilazzo@builder.io",
          model: null,
          mcpTools: [],
          originScopeId: null,
          deliveryPlatform: null,
          deliveryDestination: null,
          deliveryThreadRef: null,
          deliveryTenantId: null,
          canUpdate: true,
          effectiveRole: "owner",
          capabilities: {
            canEdit: true,
            canOperate: true,
            canDelete: true,
            canManageSharing: true,
          },
          sharing: {
            source: "legacy",
            visibility: "private",
            organizationId: null,
            grantCount: 0,
          },
          creator: {
            email: "tmilazzo@builder.io",
            label: "tmilazzo@builder.io",
          },
        },
      ]),
    );
    jobMocks.useAutomationRuns.mockReturnValue(queryResult([]));
    jobMocks.useManageRecurringJob.mockReturnValue({
      error: null,
      isPending: false,
      mutate: jobMocks.manageRecurringJob,
    });
    jobMocks.useManageAutomation.mockReturnValue({
      error: null,
      isPending: false,
      mutate: vi.fn(),
    });
    jobMocks.useRunAutomationNow.mockReturnValue({
      error: null,
      isPending: false,
      mutate: vi.fn(),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows why it is not running instead of a bare skipped chip", () => {
    act(() => {
      root.render(<AgentJobsTab />);
    });

    expect(container.textContent).toContain(BLOCKED_REASON);
  });

  it("reports last run as Never rather than the time of a skipped tick", () => {
    act(() => {
      root.render(<AgentJobsTab />);
    });

    const manageButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Manage",
    );
    act(() => manageButton?.click());
    const detailsButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Details",
    );
    act(() => detailsButton?.click());

    expect(document.body.textContent).toContain("Last run");
    expect(document.body.textContent).toContain("Never");
  });

  it("submits a new cron expression from the edit dialog", () => {
    act(() => {
      root.render(<AgentJobsTab />);
    });

    const manageButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Manage",
    );
    act(() => manageButton?.click());
    const editButton = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Edit",
    );
    expect(editButton).toBeDefined();

    act(() => {
      editButton?.click();
    });
    const advancedButton = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === "Advanced");
    act(() => {
      advancedButton?.click();
    });

    const input = document.querySelector<HTMLInputElement>(
      "#automation-schedule",
    );
    expect(input?.value).toBe("0 8 * * *");
  });
});
