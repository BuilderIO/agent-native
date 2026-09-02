import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource() {
  return readFileSync(
    new URL("./CreateFactoryAutomationView.tsx", import.meta.url),
    "utf8",
  );
}

describe("CreateFactoryAutomationView destination gating", () => {
  it("uses the shared create gate and Dispatch integrations href", () => {
    const source = readSource();
    expect(source).toContain("canCreateFactoryAutomation(form, connections)");
    expect(source).toContain("factoryAutomationConnectionsFromConfig");
    expect(source).toContain("factoryAutomationReadinessFailed");
    expect(source).toContain("dispatchIntegrationsHref(appsQuery.data)");
    expect(source).toContain(
      "workspaceIntegrationsHref={workspaceIntegrationsHref}",
    );
    expect(source).toContain("readinessError={readinessError}");
    expect(source).toContain(
      "disabled={createMutation.isPending || !canCreate}",
    );
  });
});
