import { describe, expect, it } from "vitest";

import {
  automationEditorConfigKey,
  canCreateFactoryAutomation,
  canSaveFactoryAutomation,
  dispatchIntegrationsHref,
  emptyAutomationForm,
  factoryAutomationConnectionsFromConfig,
  factoryAutomationReadinessFailed,
  formAuthorFilter,
  isConnectorExplicitlyMissing,
  isDestinationFilled,
  isDestinationReady,
  mergeListedAutomationDraft,
  omitNullDestination,
  persistAuthorFilter,
  type AutomationEditorSnapshot,
} from "./factory-automation-form";

describe("factory-automation-form authors", () => {
  it("starts with no source and Everyone", () => {
    expect(emptyAutomationForm()).toMatchObject({
      source: null,
      authorFilter: "none",
      authorIds: [],
    });
  });

  it("maps stored exclude with no ids to Everyone, but keeps Include empty so ids can be added", () => {
    expect(formAuthorFilter("exclude", [])).toBe("none");
    expect(formAuthorFilter("include", [])).toBe("include");
  });

  it("persists Everyone as exclude with no ids", () => {
    expect(persistAuthorFilter("none", ["U1"])).toEqual({
      authorMode: "exclude",
      authorIds: [],
    });
  });

  it("keeps include and exclude when ids are present", () => {
    expect(formAuthorFilter("include", ["U1"])).toBe("include");
    expect(formAuthorFilter("exclude", ["U1"])).toBe("exclude");
    expect(persistAuthorFilter("include", ["U1"])).toEqual({
      authorMode: "include",
      authorIds: ["U1"],
    });
    expect(persistAuthorFilter("exclude", ["U1"])).toEqual({
      authorMode: "exclude",
      authorIds: ["U1"],
    });
  });
});

describe("factory-automation-form destination gating", () => {
  const connected = { slack: true, github: true, sentry: true };
  const disconnected = { slack: false, github: false, sentry: false };

  it("treats a missing connections payload as unknown, not ready", () => {
    expect(isDestinationReady("slack")).toBe(false);
    expect(isDestinationReady("slack", connected)).toBe(true);
    expect(isDestinationReady("slack", disconnected)).toBe(false);
    expect(isDestinationReady(null, connected)).toBe(false);
  });

  it("scopes Slack readiness to the selected workspace", () => {
    const primaryOnly = { ...connected, slack: true, slackSecondary: false };
    const secondaryOnly = { ...connected, slack: false, slackSecondary: true };
    expect(isDestinationReady("slack", primaryOnly, "primary")).toBe(true);
    expect(isDestinationReady("slack", primaryOnly, "secondary")).toBe(false);
    expect(isDestinationReady("slack", secondaryOnly, "primary")).toBe(false);
    expect(isDestinationReady("slack", secondaryOnly, "secondary")).toBe(true);
  });

  it("requires the source destination before create", () => {
    const slack = {
      ...emptyAutomationForm("slack"),
      displayName: "Slack feedback",
      slackChannelId: "C123",
    };
    expect(isDestinationFilled(slack)).toBe(true);
    expect(canCreateFactoryAutomation(slack, connected)).toBe(true);
    expect(canCreateFactoryAutomation(slack)).toBe(true);
    expect(canCreateFactoryAutomation({ ...slack, enabled: true })).toBe(false);
    expect(
      canCreateFactoryAutomation({ ...slack, enabled: true }, connected),
    ).toBe(true);
    expect(
      canCreateFactoryAutomation({ ...slack, enabled: true }, disconnected),
    ).toBe(false);
    expect(
      canCreateFactoryAutomation({ ...slack, slackChannelId: "" }, connected),
    ).toBe(false);
  });

  it("treats an unknown connections payload as not explicitly missing", () => {
    expect(isConnectorExplicitlyMissing("slack")).toBe(false);
    expect(isConnectorExplicitlyMissing("slack", disconnected)).toBe(true);
    expect(isConnectorExplicitlyMissing("slack", connected)).toBe(false);
  });

  it("ignores cached connections when readiness failed", () => {
    const cached = { slack: true, github: true, sentry: true };
    expect(
      factoryAutomationConnectionsFromConfig({
        data: { connections: cached },
        error: new Error("vault timeout"),
      }),
    ).toBeUndefined();
    expect(
      factoryAutomationReadinessFailed({
        data: { connections: cached },
        error: new Error("vault timeout"),
      }),
    ).toBe(true);
    expect(
      factoryAutomationConnectionsFromConfig({
        data: { readinessError: "vault timeout" },
      }),
    ).toBeUndefined();
    expect(
      factoryAutomationReadinessFailed({
        data: { readinessError: "vault timeout" },
      }),
    ).toBe(true);
    expect(
      factoryAutomationConnectionsFromConfig({
        data: { connections: cached },
      }),
    ).toEqual(cached);
    expect(
      factoryAutomationReadinessFailed({
        data: { connections: cached },
      }),
    ).toBe(false);
  });

  it("lets Save disable a job when the connector is missing", () => {
    const slack = {
      ...emptyAutomationForm("slack"),
      displayName: "Slack feedback",
      slackChannelId: "C123",
      enabled: false,
    };
    expect(canSaveFactoryAutomation(slack, disconnected)).toBe(true);
    expect(
      canSaveFactoryAutomation({ ...slack, enabled: true }, disconnected),
    ).toBe(false);
    expect(
      canSaveFactoryAutomation({ ...slack, displayName: "" }, disconnected),
    ).toBe(false);
    expect(
      canSaveFactoryAutomation(
        { ...slack, authorFilter: "include", authorIds: [] },
        disconnected,
      ),
    ).toBe(false);
  });

  it("omits unused destination nulls instead of sending them as empty clears", () => {
    expect(omitNullDestination(null)).toBeUndefined();
    expect(omitNullDestination(undefined)).toBeUndefined();
    expect(omitNullDestination("C0BUK2293SA")).toBe("C0BUK2293SA");
    expect(omitNullDestination("")).toBe("");
  });

  it("points workspace connect at Dispatch admin integrations", () => {
    expect(
      dispatchIntegrationsHref([
        {
          id: "dispatch",
          isDispatch: true,
          href: "https://beta.dispatch.agent-native.com/overview",
        },
      ]),
    ).toBe("https://beta.dispatch.agent-native.com/admin/integrations");
    expect(
      dispatchIntegrationsHref([
        {
          id: "dispatch",
          isDispatch: true,
          url: "https://beta.dispatch.agent-native.com/overview",
        },
      ]),
    ).toBe("https://beta.dispatch.agent-native.com/admin/integrations");
    expect(dispatchIntegrationsHref([])).toBe("/dispatch/admin/integrations");
    expect(
      dispatchIntegrationsHref([
        { id: "dispatch", isDispatch: true, path: "/dispatch" },
      ]),
    ).toBe("/dispatch/admin/integrations");
  });
});

describe("mergeListedAutomationDraft", () => {
  const listed: AutomationEditorSnapshot = {
    id: "a18",
    name: "factories/factorytester/factory-pr-babysit-2",
    displayName: "pr-babysit-2",
    source: "github",
    repository: "acme/widgets",
    authorMode: "exclude",
    authorIds: [],
    updatedAt: "2026-09-08T01:00:00.000Z",
    runs: [{ id: "run-1", status: "running" }],
  };

  it("keeps unsaved destination and authors when only updatedAt changes", () => {
    const syncedKey = automationEditorConfigKey(listed);
    const current: AutomationEditorSnapshot = {
      ...listed,
      authorFilter: "include",
      authorMode: "include",
      authorIds: ["138030887"],
      repository: "acme/other",
    };
    const nextListed: AutomationEditorSnapshot = {
      ...listed,
      updatedAt: "2026-09-08T01:00:05.000Z",
      runs: [{ id: "run-1", status: "success" }],
    };
    const merged = mergeListedAutomationDraft(current, nextListed, syncedKey);
    expect(merged.draft.authorIds).toEqual(["138030887"]);
    expect(merged.draft.authorFilter).toBe("include");
    expect(merged.draft.repository).toBe("acme/other");
    expect(merged.draft.updatedAt).toBe("2026-09-08T01:00:05.000Z");
    expect(merged.syncedKey).toBe(syncedKey);
  });

  it("adopts the saved row once the synced key is cleared", () => {
    // Save clears the key because the server normalized the row. Without this
    // the draft stays "unsaved" forever and stops accepting server updates.
    const normalized: AutomationEditorSnapshot = {
      ...listed,
      authorMode: "include",
      authorIds: ["U0FF"],
      timezone: null,
    };
    const merged = mergeListedAutomationDraft(
      { ...listed, authorIds: ["u0ff"], timezone: "America/New_York" },
      normalized,
      null,
    );
    expect(merged.draft.authorIds).toEqual(["U0FF"]);
    expect(merged.syncedKey).toBe(automationEditorConfigKey(normalized));
  });

  it("treats authorFilter as a view choice, not a pending change", () => {
    const current: AutomationEditorSnapshot = {
      ...listed,
      authorFilter: "include",
      authorMode: "exclude",
    };
    const merged = mergeListedAutomationDraft(
      current,
      listed,
      automationEditorConfigKey(listed),
    );
    expect(merged.draft.authorFilter).toBe("include");
    expect(merged.draft.repository).toBe(listed.repository);
    expect(merged.syncedKey).toBe(automationEditorConfigKey(listed));
  });

  it("ignores the timezone outside daily mode", () => {
    const interval: AutomationEditorSnapshot = {
      ...listed,
      scheduleMode: "interval",
    };
    expect(
      automationEditorConfigKey({ ...interval, timezone: "America/New_York" }),
    ).toBe(automationEditorConfigKey({ ...interval, timezone: null }));
    const daily: AutomationEditorSnapshot = {
      ...listed,
      scheduleMode: "daily",
    };
    expect(
      automationEditorConfigKey({ ...daily, timezone: "America/New_York" }),
    ).not.toBe(automationEditorConfigKey({ ...daily, timezone: null }));
  });

  it("takes the listed row after a matching save", () => {
    const original: AutomationEditorSnapshot = { ...listed, authorIds: [] };
    const saved: AutomationEditorSnapshot = {
      ...listed,
      authorMode: "include",
      authorIds: ["138030887"],
      updatedAt: "2026-09-08T01:01:00.000Z",
    };
    const merged = mergeListedAutomationDraft(
      saved,
      saved,
      automationEditorConfigKey(original),
    );
    expect(merged.draft).toEqual(saved);
    expect(merged.syncedKey).toBe(automationEditorConfigKey(saved));
  });
});
