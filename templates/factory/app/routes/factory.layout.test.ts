import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource() {
  return readFileSync(new URL("./factory.tsx", import.meta.url), "utf8");
}

describe("Factory route factory switching", () => {
  it("remounts Settings and Automations when factoryId changes", () => {
    const source = readSource();
    expect(source).toContain("<FactorySettingsView");
    expect(source).toContain(
      "factoryName={graphData?.factory.name ?? graph.name}",
    );
    expect(source).toContain("onDeleted={goToFactoryList}");
    expect(source).toContain("<FactoryInboxView");
    expect(source).toContain("metrics={graphData?.metrics}");
    expect(source).toContain(
      "<AutomationsView key={factoryId} factoryId={factoryId} t={t} />",
    );
  });

  it("clears queued automation polling when factoryId changes", () => {
    const source = readSource();
    expect(source).toContain("setQueuedRuns({})");
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*setQueuedRuns\(\{\}\);\s*\}, \[factoryId\]\);/,
    );
  });

  it("opens create automation from the createAutomation query param", () => {
    const source = readSource();
    expect(source).toContain(
      'const createOpen = searchParams.get("createAutomation") === "1"',
    );
    expect(source).toContain('next.set("createAutomation", "1")');
    expect(source).toContain('next.delete("createAutomation")');
  });

  it("keeps the automation editor flush without a wrapping card", () => {
    const source = readSource();
    expect(source).toContain('id="factory-automation-panel"');
    expect(source).toContain('className="grid min-w-0 content-start gap-6"');
    expect(source).toContain("automationEditorTitle");
    expect(source).toContain("text-lg font-semibold");
    expect(source).toContain("showSource={false}");
    expect(source).toContain("connections={configQuery.data?.connections}");
    expect(source).toContain("canCreateFactoryAutomation(");
    expect(source).toContain("isDestinationReady(");
    expect(source).toContain(
      "workspaceIntegrationsHref={workspaceIntegrationsHref}",
    );
    expect(source).toContain("bg-emerald-500");
    expect(source).toContain('title={t("factoryRoute.pastRuns")}');
  });
});

describe("Factory route tabs", () => {
  it("opens a factory on Inbox and hides Overview, Flow, and History from the tab bar", () => {
    const source = readSource();
    expect(source).toContain('openFactory(factory.id, { tab: "inbox" })');
    expect(source).toContain("retainFactoryTabParams");
    expect(source).toContain("factorySearchParamsEqual");
    expect(source).toContain('value === "overview"');
    expect(source).toContain(': "inbox"');
    expect(source).toContain('onClick={() => setActiveTab("inbox")}');
    expect(source).not.toContain('onClick={() => setActiveTab("overview")}');
    expect(source).not.toContain('onClick={() => setActiveTab("map")}');
    expect(source).not.toContain('onClick={() => setActiveTab("history")}');
    expect(source).toContain('activeTab === "overview"');
    expect(source).toContain('activeTab === "map"');
    expect(source).toContain("<FactoryHistoryView");
  });
});
