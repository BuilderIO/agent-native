// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  useRecurringJobs: vi.fn(),
  useAutomations: vi.fn(),
  useManageRecurringJob: vi.fn(),
  useManageAutomation: vi.fn(),
  useRunAutomationNow: vi.fn(),
  useScheduledTriggerState: vi.fn(),
}));

vi.mock("./use-jobs.js", () => ({
  ...jobs,
  useAutomationRuns: vi.fn(),
  useAutomationEvents: vi.fn(),
  useAutomationAccountSearch: vi.fn(),
}));

vi.mock("../chat/index.js", () => ({
  AgentAskPopover: () => null,
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org-a", orgName: "Example" } }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useFormatters: () => ({ formatDate: (value: string) => value }),
  useT: () => (key: string, options?: { defaultValue?: string }) =>
    options?.defaultValue ?? key,
}));

import { AgentJobsTab } from "./AgentJobsTab.js";

function queryResult<T>(data: T) {
  return { data, error: null, isLoading: false };
}

const capabilities = {
  canEdit: false,
  canOperate: false,
  canDelete: false,
  canManageSharing: false,
};

describe("AgentJobsTab recurring resource deduplication", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const mutation = { error: null, isPending: false, mutate: vi.fn() };
    jobs.useManageRecurringJob.mockReturnValue(mutation);
    jobs.useManageAutomation.mockReturnValue(mutation);
    jobs.useRunAutomationNow.mockReturnValue(mutation);
    jobs.useScheduledTriggerState.mockReturnValue({
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

  it.each(["user", "org"] as const)(
    "renders each resource once in the %s scope",
    (scope) => {
      const resourceScope = scope === "org" ? "organization" : "personal";
      const job = {
        id: "shared-id",
        name: "weekly-report",
        path: "jobs/weekly-report.md",
        scope: resourceScope,
        schedule: "0 9 * * 1",
        timezone: "UTC",
        scheduleDescription: "Every Monday",
        instructions: "Prepare the report.",
        enabled: true,
        lastRun: null,
        lastCheck: null,
        lastStatus: null,
        lastError: null,
        nextRun: null,
        createdBy: null,
        mcpTools: [],
        canUpdate: false,
        capabilities,
      };
      const automation = {
        ...job,
        resourceId: job.id,
        classification: "recurring-job",
        triggerType: "schedule",
        body: job.instructions,
        effectiveRole: "owner",
        sharing: {
          source: "explicit",
          visibility: "private",
          organizationId: null,
          grantCount: 0,
        },
      };
      jobs.useRecurringJobs.mockImplementation((queryScope: "user" | "org") =>
        queryResult(queryScope === scope ? [job] : []),
      );
      jobs.useAutomations.mockImplementation((queryScope: "user" | "org") =>
        queryResult(
          queryScope === scope
            ? [
                automation,
                {
                  ...automation,
                  id: "different-id",
                  resourceId: "different-id",
                  classification: "automation",
                  triggerType: "event",
                  event: "example.created",
                },
                {
                  ...automation,
                  id: "event-id",
                  resourceId: "event-id",
                  name: "new-alert",
                  classification: "automation",
                  triggerType: "event",
                  event: "example.created",
                },
              ]
            : [],
        ),
      );

      act(() => root.render(<AgentJobsTab scope={scope} canManageOrg />));

      const section =
        container.querySelectorAll("section")[scope === "user" ? 0 : 1];
      expect(
        [...section.querySelectorAll("article h3")].map(
          (heading) => heading.textContent,
        ),
      ).toEqual(["weekly report", "weekly report", "new alert"]);
    },
  );
});
