import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const databaseViewSource = readFileSync(
  new URL("./DatabaseView.tsx", import.meta.url),
  "utf8",
);
const hooksPanelSource = readFileSync(
  new URL("./DatabaseHooksPanel.tsx", import.meta.url),
  "utf8",
);
const policyActionSource = readFileSync(
  new URL(
    "../../../../actions/manage-content-database-policy.ts",
    import.meta.url,
  ),
  "utf8",
);
const virtualRuleSource = readFileSync(
  new URL(
    "../../../../actions/_content-default-person-rule.ts",
    import.meta.url,
  ),
  "utf8",
);
const propertyUtilsSource = readFileSync(
  new URL("../../../../actions/_property-utils.ts", import.meta.url),
  "utf8",
);

describe("default Person notification owner policy", () => {
  it("defaults the persisted database policy to enabled with an immutable version", () => {
    expect(propertyUtilsSource).toContain(
      "defaultPersonNotificationsEnabled: true",
    );
    expect(propertyUtilsSource).toContain(
      "defaultPersonNotificationsPolicyVersion: 1",
    );
    expect(policyActionSource).toContain(
      "defaultPersonNotificationsPolicyVersion: nextPolicyVersion",
    );
    expect(policyActionSource).toContain("requireContentDatabaseOwner");
  });

  it("shows a compact owner-only switch through the shared action surface", () => {
    expect(hooksPanelSource).toContain("useManageContentDatabasePolicy()");
    expect(hooksPanelSource).toContain("{isOwner ? (");
    expect(hooksPanelSource).toContain(
      "defaultPersonNotificationsEnabled: enabled",
    );
    expect(hooksPanelSource).toContain(
      't("database.defaultPersonNotificationsDescription")',
    );
    expect(databaseViewSource).toContain('onPanelChange("hooks")');
  });

  it("resolves immutable policy history at each event sequence", () => {
    expect(virtualRuleSource).toContain(
      "schema.contentDatabasePolicies.activeAfterSequence",
    );
    expect(virtualRuleSource).toContain("event.eventSequence");
    expect(virtualRuleSource).toContain("version: policy?.version ?? 1");
    expect(policyActionSource).toContain(
      "allocateContentWorkflowEventSequence(tx)",
    );
    expect(policyActionSource).toContain(
      "tx.insert(schema.contentDatabasePolicies)",
    );
    expect(virtualRuleSource).toContain('disabledReason: "owner_disabled"');
    expect(virtualRuleSource).toContain(
      "eq(schema.contentDatabases.ownerEmail, event.ownerEmail)",
    );
  });
});
