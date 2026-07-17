import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { hookMessagesByLocale } from "../../../hook-i18n";
import { hookRuntimeMessagesByLocale } from "../../../hook-runtime-i18n";

const panelSource = readFileSync(
  new URL("./DatabaseHooksPanel.tsx", import.meta.url),
  "utf8",
);
const databaseViewSource = readFileSync(
  new URL("./DatabaseView.tsx", import.meta.url),
  "utf8",
);
const incidentControlsSource = readFileSync(
  new URL("./DatabaseHookIncidentControls.tsx", import.meta.url),
  "utf8",
);
const headerSource = readFileSync(
  new URL("../../layout/Header.tsx", import.meta.url),
  "utf8",
);
const toolbarSource = readFileSync(
  new URL("../DocumentToolbar.tsx", import.meta.url),
  "utf8",
);
const i18nSource = readFileSync(
  new URL("../../../i18n-data.ts", import.meta.url),
  "utf8",
);
const hookRuntimeI18nSource = readFileSync(
  new URL("../../../hook-runtime-i18n.ts", import.meta.url),
  "utf8",
);

describe("Content database hooks product surface", () => {
  it("mounts notifications in ordinary and document-specific chrome", () => {
    expect(headerSource).toContain("<NotificationsBell");
    expect(toolbarSource).toContain("<NotificationsBell");
    expect(headerSource).toContain("browserNotifications");
    expect(toolbarSource).toContain("browserNotifications");
    expect(databaseViewSource).toContain('scope: "item"');
    expect(databaseViewSource).toContain('"unsubscribeFromItem"');
    expect(databaseViewSource).toContain('"subscribeToItem"');
  });

  it("mounts the hook panel in the live database settings drill-down", () => {
    expect(databaseViewSource).toContain('| "hooks"');
    expect(databaseViewSource).toContain("<DatabaseHooksPanel");
    expect(databaseViewSource).toContain("canManage={canManage}");
    expect(databaseViewSource).toContain(
      'onClick={() => onPanelChange("hooks")}',
    );
  });

  it("uses the shared action surface and stable database identifiers", () => {
    expect(panelSource).toContain("useContentDatabaseHooks(databaseId)");
    expect(panelSource).toContain(
      "useContentDatabaseHookExecutions(databaseId)",
    );
    expect(panelSource).toContain("useManageContentDatabaseHook(databaseId)");
    expect(panelSource).toContain("propertyId: draft.propertyId");
    expect(panelSource).toContain("toOptionId:");
    expect(panelSource).toContain("recipientPersonPropertyId:");
    expect(panelSource).not.toContain("fetch(");
    expect(panelSource).not.toContain("deliveryAttempt");
  });

  it("keeps advanced transition detail and execution history disclosed", () => {
    expect(panelSource).toContain("showPreviousValue");
    expect(panelSource).toContain("<details");
    expect(panelSource).toContain("latestHookExecutions");
    expect(panelSource).toContain("disabled={!canManage}");
  });

  it("uses shared scheduling controls for deterministic timing", () => {
    expect(panelSource).toContain('kind: "immediate"');
    expect(panelSource).toContain('value="delayed"');
    expect(panelSource).toContain('value="debounced"');
    expect(panelSource).toContain('value="escalation"');
    expect(panelSource).toContain("delayMinutes");
    expect(panelSource).toContain("whenBuilderPublicationConfirmed");
    expect(panelSource).toContain("publicationAction");
    expect(panelSource).toContain("agentJudgmentUsesAutomations");
  });

  it("progressively discloses stable-ID conditions as the Rule if layer", () => {
    expect(panelSource).toContain('t("database.if")');
    expect(panelSource).toContain("addConditions");
    expect(panelSource).toContain("matchAllConditions");
    expect(panelSource).toContain("matchAnyCondition");
    expect(panelSource).toContain('value="not_equals"');
    expect(panelSource).toContain('value="contains"');
    expect(panelSource).toContain('value="is_empty"');
    expect(panelSource).toContain("condition.propertyId");
    expect(panelSource).toContain("conditions: draft.conditions");
  });

  it("presents one Rules model with submission as the primary trigger", () => {
    expect(panelSource).toContain('candidate.kind === "item_submitted"');
    expect(panelSource).toContain('value="item_submitted"');
    expect(panelSource).toContain("anItemIsSubmitted");
    expect(panelSource).toContain('value="item_created"');
    expect(panelSource).toContain(
      'availabilityFor("item_created")?.available !== true',
    );
    expect(panelSource).toContain("itemCreatedUnavailable");
    expect(i18nSource).toContain('notificationsAndHooks: "Rules"');
    expect(i18nSource).toContain('effects: "Actions"');
    expect(i18nSource).toContain('addEffect: "Add action"');
    expect(hookRuntimeI18nSource).toContain("Rules and Automations");
    expect(i18nSource).not.toContain('notificationsAndHooks: "Notifications');
    for (const messages of Object.values(hookMessagesByLocale)) {
      expect(messages.notificationsAndHooks).not.toMatch(/hooks?/i);
      expect(messages.noHookExecutions).not.toMatch(/hooks?/i);
      expect(messages.effects).not.toMatch(/effects?/i);
    }
    for (const messages of Object.values(hookRuntimeMessagesByLocale)) {
      expect(messages.hookProcessingPaused).not.toMatch(/hooks?/i);
      expect(messages.hookProcessingActive).not.toMatch(/hooks?/i);
      expect(messages.agentJudgmentUsesAutomations).not.toMatch(/hooks?/i);
    }
  });

  it("closes the versioned deterministic property-effect builder", () => {
    expect(panelSource).toContain('value="set_property"');
    expect(panelSource).toContain("version: 1");
    expect(panelSource).toContain("deterministicEffectProperties");
    expect(panelSource).toContain("hookCycleStopped");
    expect(panelSource).toContain("hookDepthStopped");
    expect(panelSource).toContain("assertNever(effect)");
  });

  it("exposes viewer-visible incident state through actions", () => {
    expect(panelSource).toContain("<DatabaseHookIncidentControls");
    expect(incidentControlsSource).toContain(
      "useContentHookRuntimeControls(databaseId)",
    );
    expect(incidentControlsSource).toContain(
      "useManageContentHookRuntimeControl(databaseId)",
    );
    expect(incidentControlsSource).toContain('scope === "database"');
    expect(incidentControlsSource).toContain("data.canManageGlobal");
    expect(incidentControlsSource).toContain("pausedHookEventsNotReplayed");
    expect(incidentControlsSource).not.toContain("fetch(");
  });
});
