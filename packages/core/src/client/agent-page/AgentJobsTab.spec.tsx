// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({
  manageAutomation: vi.fn(),
  useRunAutomationNow: vi.fn(),
  useAutomationEvents: vi.fn(),
  useAutomations: vi.fn(),
  useManageAutomation: vi.fn(),
  useManageRecurringJob: vi.fn(),
}));

vi.mock("./use-jobs.js", () => ({
  useAutomationEvents: jobMocks.useAutomationEvents,
  useAutomationAccountSearch: () => ({ data: [], isFetching: false }),
  useAutomations: jobMocks.useAutomations,
  useManageAutomation: jobMocks.useManageAutomation,
  useManageRecurringJob: jobMocks.useManageRecurringJob,
  useRunAutomationNow: jobMocks.useRunAutomationNow,
}));

vi.mock("../org/hooks.js", () => ({
  useOrg: () => ({ data: { orgId: "org-1", orgName: "Acme" } }),
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
import type { Automation } from "./use-jobs.js";

function queryResult<T>(data: T) {
  return { data, error: null, isLoading: false };
}

function mutationResult(mutate: ReturnType<typeof vi.fn> = vi.fn()) {
  return { error: null, isPending: false, mutate };
}

function ownerAutomation(patch: Partial<Automation> = {}): Automation {
  return {
    id: "event-automation",
    resourceId: "event-automation",
    name: "new-lead-alert",
    path: "jobs/new-lead-alert.md",
    scope: "organization",
    classification: "automation",
    triggerType: "event",
    event: "lead.created",
    schedule: null,
    timezone: null,
    scheduleDescription: null,
    condition: null,
    body: "Alert the sales team.",
    enabled: true,
    lastRun: null,
    lastCheck: null,
    lastStatus: null,
    lastError: null,
    nextRun: null,
    createdBy: "owner@example.com",
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
      source: "explicit",
      visibility: "organization",
      organizationId: "org-1",
      grantCount: 0,
    },
    creator: { email: "owner@example.com", label: "owner@example.com" },
    ...patch,
  };
}

describe("AgentJobsTab unified automations list", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    jobMocks.useAutomations.mockReturnValue(queryResult([ownerAutomation()]));
    jobMocks.useAutomationEvents.mockReturnValue(queryResult([]));
    jobMocks.useManageRecurringJob.mockReturnValue(mutationResult());
    jobMocks.useRunAutomationNow.mockReturnValue(mutationResult());
    jobMocks.useManageAutomation.mockReturnValue(
      mutationResult(jobMocks.manageAutomation),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows one unified list with no Personal/Organization sections", () => {
    act(() => {
      root.render(<AgentJobsTab />);
    });

    expect(container.textContent).toContain("new lead alert");
    expect(container.querySelectorAll("section").length).toBe(0);
    expect(container.textContent).toContain("Organization");
    expect(container.textContent).not.toContain("Personal automations");
  });

  it("routes pause/resume through the resourceId-first mutation", () => {
    act(() => {
      root.render(<AgentJobsTab />);
    });

    const row = container.querySelector("article");
    const toggle = row?.querySelector('[role="switch"]');
    act(() => {
      (toggle as HTMLButtonElement | null)?.click();
    });

    expect(jobMocks.manageAutomation).toHaveBeenCalledWith(
      {
        operation: "update",
        resourceId: "event-automation",
        enabled: false,
      },
      undefined,
    );
  });

  it("hides mutating controls for a View-only shared automation", () => {
    jobMocks.useAutomations.mockReturnValue(
      queryResult([
        ownerAutomation({
          effectiveRole: "view",
          capabilities: {
            canEdit: false,
            canOperate: false,
            canDelete: false,
            canManageSharing: false,
          },
          sharing: {
            source: "explicit",
            visibility: "shared",
            organizationId: null,
            grantCount: 1,
          },
        }),
      ]),
    );
    act(() => {
      root.render(<AgentJobsTab />);
    });

    expect(container.textContent).toContain("Shared with you · View");
    expect(container.querySelector('[role="switch"]')).toBeNull();

    const manageButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Manage",
    );
    act(() => manageButton?.click());
    const menuButtons = [...document.body.querySelectorAll("button")].map(
      (button) => button.textContent?.trim(),
    );
    expect(menuButtons).toContain("Details");
    expect(menuButtons).not.toContain("Edit");
    expect(menuButtons).not.toContain("Delete");
    expect(menuButtons).not.toContain("Run now");
  });

  it("closes the full editor after an explicit automation update succeeds", () => {
    jobMocks.useManageAutomation.mockReturnValue({
      error: null,
      isPending: false,
      mutate: (input: unknown, options?: { onSuccess?: () => void }) => {
        jobMocks.manageAutomation(input);
        options?.onSuccess?.();
      },
    });
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

    expect(jobMocks.manageAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "update",
        resourceId: "event-automation",
        body: "Notify the account team.",
      }),
    );
    expect(document.body.textContent).not.toContain("Edit automation");
  });
});
