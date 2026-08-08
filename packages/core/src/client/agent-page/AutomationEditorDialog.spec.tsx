/* @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as Array<{
    name: string;
    description: string;
    payloadSchema: null;
    example: null;
  }>,
  openAgentSettings: vi.fn(),
  org: { orgId: null as string | null, orgName: null as string | null },
}));

vi.mock("./use-jobs.js", () => ({
  useAutomationEvents: () => ({
    data: mocks.events,
    error: null,
    isLoading: false,
  }),
  useAutomationAccountSearch: () => ({ data: [], isFetching: false }),
}));

vi.mock("../org/hooks.js", () => ({
  useOrg: () => ({ data: mocks.org }),
}));

vi.mock("../CommandMenu.js", () => ({
  openAgentSettings: mocks.openAgentSettings,
}));

vi.mock("../i18n.js", () => ({
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

vi.mock("./TimezoneSelect.js", () => ({
  browserTimezone: () => "UTC",
  TimezoneSelect: ({
    id,
    value,
    disabled,
    onChange,
  }: {
    id?: string;
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <option value="UTC">UTC</option>
      <option value="Europe/Paris">Europe/Paris</option>
    </select>
  ),
}));

import { AutomationEditorDialog } from "./AutomationEditorDialog.js";
import type { Automation } from "./use-jobs.js";

function findButton(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim().startsWith(text),
  );
  if (!button) throw new Error(`No button named "${text}"`);
  return button as HTMLButtonElement;
}

function changeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("Value setter unavailable");
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function input(id: string): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!element) throw new Error(`No input #${id}`);
  return element;
}

function click(text: string) {
  act(() => findButton(text).click());
}

function explicitAutomation(patch: Partial<Automation> = {}): Automation {
  return {
    id: "automation-1",
    resourceId: "automation-1",
    name: "customer-digest",
    path: "jobs/customer-digest.md",
    scope: "personal",
    classification: "automation",
    triggerType: "schedule",
    event: null,
    schedule: "  */15 * * * *  ",
    timezone: "UTC",
    scheduleDescription: null,
    condition: null,
    body: "Summarize customer updates.",
    enabled: true,
    lastRun: null,
    lastCheck: null,
    lastStatus: null,
    lastError: null,
    nextRun: null,
    createdBy: null,
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
      visibility: "private",
      organizationId: null,
      grantCount: 0,
    },
    creator: { email: "owner@example.com", label: "owner@example.com" },
    ...patch,
  };
}

describe("AutomationEditorDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSave = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Element.prototype.scrollIntoView = () => {};
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    mocks.events = [
      {
        name: "issue.created",
        description: "A new issue was created.",
        payloadSchema: null,
        example: null,
      },
      {
        name: "mail.message.received",
        description: "A new email arrived.",
        payloadSchema: null,
        example: null,
      },
    ];
    mocks.openAgentSettings.mockReset();
    mocks.org.orgId = null;
    mocks.org.orgName = null;
    onSave.mockReset();
    onCancel.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(
    props: Partial<React.ComponentProps<typeof AutomationEditorDialog>> = {},
  ) {
    act(() => {
      root.render(
        <AutomationEditorDialog
          open
          scope="personal"
          saving={false}
          onCancel={onCancel}
          onSave={onSave}
          {...props}
        />,
      );
    });
  }

  function fillRequired() {
    changeValue(input("automation-name"), "Customer digest");
    const body =
      document.querySelector<HTMLTextAreaElement>("#automation-body");
    if (!body) throw new Error("No instructions field");
    changeValue(body, "Summarize customer updates.");
  }

  it.each(["personal", "organization"] as const)(
    "fixes create payloads to the %s opener scope and defaults sharing to Personal",
    (scope) => {
      render({ scope });
      fillRequired();
      click("On demand");
      click("Create automation");

      expect(onSave).toHaveBeenCalledWith({
        operation: "create",
        name: "Customer digest",
        scope,
        triggerType: "manual",
        body: "Summarize customer updates.",
        sharing: { kind: "personal" },
      });
      expect(document.body.textContent).toContain(
        `fixed to the ${scope} scope`,
      );
    },
  );

  it("edits an existing manual automation without rejected trigger fields", () => {
    render({
      automation: explicitAutomation({
        triggerType: "manual",
        event: null,
        schedule: null,
        timezone: null,
        condition: null,
      }),
    });

    click("Save changes");

    expect(onSave).toHaveBeenCalledWith({
      operation: "update",
      resourceId: "automation-1",
      triggerType: "manual",
      body: "Summarize customer updates.",
      sharing: { kind: "personal" },
    });
    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const field of [
      "event",
      "schedule",
      "timezone",
      "condition",
      "name",
      "scope",
    ]) {
      expect(Object.hasOwn(payload, field)).toBe(false);
    }
  });

  it("switches an existing event to manual without stale trigger fields", () => {
    render({
      automation: explicitAutomation({
        triggerType: "event",
        event: "issue.created",
        schedule: null,
        timezone: null,
        condition: "Only customer-reported issues",
      }),
    });

    click("On demand");
    click("Save changes");

    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toEqual({
      operation: "update",
      resourceId: "automation-1",
      triggerType: "manual",
      body: "Summarize customer updates.",
      sharing: { kind: "personal" },
    });
    for (const field of ["event", "schedule", "timezone", "condition"]) {
      expect(Object.hasOwn(payload, field)).toBe(false);
    }
  });

  it("submits and preserves an advanced cron schedule", () => {
    render();
    fillRequired();
    click("Advanced");
    changeValue(input("automation-schedule"), "  */15 * * * *  ");
    const zone = document.querySelector<HTMLSelectElement>(
      "#automation-timezone",
    );
    if (!zone) throw new Error("No timezone field");
    changeValue(zone, "Europe/Paris");
    click("Create automation");

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: "schedule",
        schedule: "  */15 * * * *  ",
        timezone: "Europe/Paris",
      }),
    );
  });

  it("submits a selected registered app event and optional condition", () => {
    render();
    fillRequired();
    click("App event");
    click("Select an event");
    const eventOption = [...document.querySelectorAll("[cmdk-item]")].find(
      (item) => item.textContent?.includes("issue.created"),
    );
    if (!eventOption) throw new Error("No issue.created event option");
    act(() =>
      eventOption.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    changeValue(
      input("automation-event-condition"),
      "Only customer-reported issues",
    );
    click("Create automation");

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: "event",
        event: "issue.created",
        condition: "Only customer-reported issues",
      }),
    );
  });

  it("submits the email event with explicit natural-language field filters", () => {
    render({ scope: "organization" });
    fillRequired();
    click("Email received");
    changeValue(input("automation-email-from"), "alerts@example.test");
    changeValue(input("automation-email-to"), "team@example.test");
    changeValue(input("automation-email-subject"), "Urgent");
    changeValue(
      input("automation-email-condition"),
      "Only messages with attachments",
    );
    click("Create automation");

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "organization",
        triggerType: "event",
        event: "mail.message.received",
        condition:
          'The event field from must contain "alerts@example.test".\n' +
          'The event field to must contain "team@example.test".\n' +
          'The event field subject must contain "Urgent".\n' +
          "Also: Only messages with attachments",
      }),
    );
  });

  it("keeps Email received visible but unavailable and opens connection settings", () => {
    mocks.events = mocks.events.filter(
      (event) => event.name !== "mail.message.received",
    );
    render();

    const email = findButton(
      "Email receivedConnect Mail to use email-triggered automations.",
    );
    expect(email.getAttribute("aria-disabled")).toBe("true");
    act(() => email.click());
    expect(document.querySelector("#automation-email-from")).toBeNull();

    click("Open connections");
    expect(mocks.openAgentSettings).toHaveBeenCalledWith("connections");
  });

  it("retains entered values and shows a service error without closing", () => {
    render({ error: null });
    fillRequired();
    click("On demand");
    click("Create automation");

    render({ error: "The automation name is already in use." });

    expect(input("automation-name").value).toBe("Customer digest");
    expect(document.body.textContent).toContain(
      "The automation name is already in use.",
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("edits an explicit automation with an immutable name and preserved cron", () => {
    const automation = explicitAutomation();
    render({ automation });

    expect(input("automation-name").readOnly).toBe(true);
    expect(input("automation-name").value).toBe("customer digest");
    expect(input("automation-schedule").value).toBe("  */15 * * * *  ");

    const body =
      document.querySelector<HTMLTextAreaElement>("#automation-body");
    if (!body) throw new Error("No instructions field");
    changeValue(body, "Create a concise customer summary.");
    click("Save changes");

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "update",
        resourceId: "automation-1",
        triggerType: "schedule",
        schedule: "  */15 * * * *  ",
        body: "Create a concise customer summary.",
      }),
    );
  });

  it("restores specialized email fields while editing", () => {
    render({
      automation: explicitAutomation({
        triggerType: "event",
        event: "mail.message.received",
        schedule: null,
        timezone: null,
        condition:
          'The event field from must contain "billing@example.test".\nAlso: Only unread messages',
      }),
    });

    expect(input("automation-email-from").value).toBe("billing@example.test");
    expect(input("automation-email-condition").value).toBe(
      "Only unread messages",
    );
  });

  it("submits Organization sharing with the current organization id", () => {
    mocks.org.orgId = "org-1";
    mocks.org.orgName = "Acme";
    render();
    fillRequired();
    click("On demand");
    const organizationRadio = document.querySelector<HTMLButtonElement>(
      '[role="radio"][value="organization"]',
    );
    if (!organizationRadio) throw new Error("No Organization sharing radio");
    act(() => organizationRadio.click());
    click("Create automation");

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sharing: { kind: "organization", organizationId: "org-1" },
      }),
    );
  });

  it("shows a read-only sharing summary for a collaborator without sharing controls", () => {
    render({
      automation: explicitAutomation({
        effectiveRole: "collaborate",
        capabilities: {
          canEdit: true,
          canOperate: true,
          canDelete: false,
          canManageSharing: false,
        },
        sharing: {
          source: "explicit",
          visibility: "shared",
          organizationId: null,
          grantCount: 2,
        },
      }),
    });

    expect(document.body.textContent).toContain(
      "Only the owner can change sharing.",
    );
    click("Save changes");

    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.hasOwn(payload, "sharing")).toBe(false);
  });
});
