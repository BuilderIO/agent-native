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
}));

vi.mock("../AgentAskPopover.js", () => ({
  AgentAskPopover: ({ title, label }: { title: string; label?: string }) => (
    <button type="button">{label ?? title}</button>
  ),
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

    jobMocks.useRecurringJobs.mockImplementation((scope: "user" | "org") =>
      queryResult(
        scope === "user"
          ? [
              {
                id: "blocked-job",
                name: "competitive-intelligence-daily-email",
                path: "jobs/competitive-intelligence-daily-email.md",
                scope: "personal",
                schedule: "0 8 * * *",
                scheduleDescription: "Every day at 8 AM",
                instructions: "Send the briefing.",
                enabled: true,
                // The job has never executed; a blocked tick only sets lastCheck.
                lastRun: null,
                lastCheck: "2026-07-31T17:04:14.688Z",
                lastStatus: "skipped",
                lastError: BLOCKED_REASON,
                nextRun: "2026-08-01T08:00:00.000Z",
                createdBy: "tmilazzo@builder.io",
                mcpTools: [],
                canUpdate: true,
              },
            ]
          : [],
      ),
    );
    jobMocks.useAutomations.mockReturnValue(queryResult([]));
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
    jobMocks.useScheduledTriggerState.mockReturnValue({
      kind: "resolved",
      status: { available: true, driver: "netlify-scheduled-function" },
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

    const row = container.querySelector("article");
    expect(row?.textContent).toContain("Last run: Never");
    expect(row?.textContent).toContain("Last checked");
  });

  it("makes failed run details and its agent thread discoverable", () => {
    jobMocks.useAutomationRuns.mockReturnValue(
      queryResult([
        {
          id: "run-1",
          automation: "competitive-intelligence-daily-email",
          scope: "personal",
          runId: "run-1",
          threadId: "thread-1",
          status: "error",
          startedAt: Date.now(),
          finishedAt: Date.now() + 1000,
          error: "The worker failed.",
        },
      ]),
    );

    act(() => {
      root.render(<AgentJobsTab />);
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "View details",
    );
    expect(detailsButton).toBeDefined();

    act(() => {
      detailsButton?.click();
    });

    expect(document.body.textContent).toContain("Open thread");
  });

  // The date itself is the misleading part: it is derived from the cron
  // expression, so it renders identically whether or not anything will run it.
  // A failed scheduler check must not let it read as confirmed.
  it("qualifies the next run date when the scheduler check failed", () => {
    jobMocks.useScheduledTriggerState.mockReturnValue({
      kind: "unknown",
      error: new Error("Failed to fetch"),
    });

    act(() => {
      root.render(<AgentJobsTab />);
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "View details",
    );
    act(() => {
      detailsButton?.click();
    });

    expect(document.body.textContent).toContain(
      "2026-08-01T08:00:00.000Z — unconfirmed, the scheduler check failed",
    );
  });

  // The known-dead case keeps replacing the date outright: there is nothing to
  // qualify when no driver exists.
  it("replaces the next run date when no scheduler exists", () => {
    jobMocks.useScheduledTriggerState.mockReturnValue({
      kind: "resolved",
      status: { available: false, reason: "no-platform-scheduler" },
    });

    act(() => {
      root.render(<AgentJobsTab />);
    });

    const detailsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "View details",
    );
    act(() => {
      detailsButton?.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(
      "Next runNever — no scheduler in this deploy",
    );
    expect(dialog?.textContent).not.toContain("2026-08-01T08:00:00.000Z");
  });

  it("submits a new cron expression from the edit dialog", () => {
    act(() => {
      root.render(<AgentJobsTab />);
    });

    const editButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Edit",
    );
    expect(editButton).toBeDefined();

    act(() => {
      editButton?.click();
    });

    const input = document.querySelector<HTMLInputElement>(
      "#automation-schedule",
    );
    expect(input?.value).toBe("0 8 * * *");
  });
});
