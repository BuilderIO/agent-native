import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource() {
  return readFileSync(
    new URL("./FactoryAutomationFields.tsx", import.meta.url),
    "utf8",
  );
}

describe("FactoryAutomationFields connection banner", () => {
  it("shows a Dispatch banner above Run when the destination is not ready", () => {
    const source = readSource();
    expect(source).toContain("WorkspaceConnectionBanner");
    expect(source).toContain('role="alert"');
    expect(source).toContain("factoryRoute.automationMissingSlack");
    expect(source).toContain("factoryRoute.automationMissingGithub");
    expect(source).toContain("factoryRoute.automationMissingSentry");
    expect(source).toContain("factoryRoute.automationReadinessUnavailable");
    expect(source).toContain("isConnectorExplicitlyMissing");
    expect(source).toContain("workspaceIntegrationsHref");
    expect(source).not.toContain("buildSettingsRoute");
    expect(source).toContain("disabled={destinationLocked}");
    expect(source).toContain("form.enabled && !destinationReady");
    expect(source).toContain("form.source && readinessError");
    expect(source.indexOf("showMissingBanner")).toBeLessThan(
      source.indexOf("factoryRoute.automationCardRunTitle"),
    );
  });
});
