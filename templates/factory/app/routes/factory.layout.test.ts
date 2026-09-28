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

  it("keeps one labeled create control that wraps beside chat", () => {
    const source = readSource();
    expect(source).toContain("lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]");
    expect(source).toContain("flex-wrap items-center justify-between");
    expect(source).toContain('{t("factoryRoute.createAutomation")}');
    expect(source).toContain("shrink-0");
    expect(source.match(/setCreateOpen\(true\)/g)?.length).toBe(1);
  });

  it("keeps the automation editor flush without a wrapping card", () => {
    const source = readSource();
    expect(source).toContain('id="factory-automation-panel"');
    expect(source).toContain('className="grid min-w-0 content-start gap-6"');
    expect(source).toContain("automationEditorTitle");
    expect(source).toContain("text-lg font-semibold");
    expect(source).toContain("showSource={false}");
    expect(source).toContain("factoryAutomationConnectionsFromConfig");
    expect(source).toContain("factoryAutomationReadinessFailed");
    expect(source).toContain("connections={connections}");
    expect(source).toContain("readinessError={readinessError}");
    expect(source).toContain("canSaveFactoryAutomation(");
    expect(source).toContain("isDestinationReady(");
    expect(source).toContain(
      "workspaceIntegrationsHref={workspaceIntegrationsHref}",
    );
    expect(source).toContain("bg-emerald-500");
    expect(source).toContain('title={t("factoryRoute.pastRuns")}');
  });

  it("does not steal the selected automation while the list catches up", () => {
    const source = readSource();
    expect(source).toContain("if (selectedId && !automationMissing) return;");
    expect(source).toContain("mergeListedAutomationDraft");
    expect(source).toContain("selectAutomation(automationId, listed)");
    expect(source).toContain("factoryRoute.automationCreateRefreshFailed");
    expect(source).not.toContain("automationsQuery.refetch().finally(");
    expect(source).not.toContain(
      "automations.find((automation) => automation.id === selectedId) ??\n    automations[0]",
    );
  });

  it("remembers the last selected automation per factory instead of the URL, and forgets it when opening create", () => {
    const source = readSource();
    expect(source).toContain(
      "function lastAutomationStorageKey(factoryId: string): string {",
    );
    expect(source).toContain(
      "const persistedId = selectedId ? null : persistedLastAutomationId(factoryId);",
    );
    expect(source).toContain("persistLastAutomationId(factoryId, id);");
    expect(source).toContain(
      "if (open) clearPersistedLastAutomationId(factoryId);",
    );
    expect(source).toContain(
      "persistLastAutomationId(factoryId, selected.id);",
    );
    expect(
      source.indexOf("persistLastAutomationId(factoryId, selected.id);"),
    ).toBeLessThan(
      source.indexOf("if (!selectedId) {\n      selectAutomation"),
    );
  });

  it("resyncs the editor after a save and refuses to run a stale config", () => {
    const source = readSource();
    expect(source).toMatch(
      /syncedConfigKeyRef\.current = null;\n\s+await automationsQuery\.refetch\(\);/,
    );
    expect(source).toContain("draftHasUnsavedEdits(draft)");
    expect(source).toContain("factoryRoute.automationRunNeedsSave");
    expect(source).toContain("factoryRoute.automationNotFound");
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

  it("wires the Audit refresh trigger to refetch and shows a spinner while fetching", () => {
    const source = readSource();
    expect(source).toContain(
      "onClick={() => setAuditRefreshToken((current) => current + 1)}",
    );
    expect(source).toContain("disabled={auditFetching}");
    expect(source).toContain('<IconLoader2 className="size-4 animate-spin" />');
    expect(source).toContain("onFetchingChange={setAuditFetching}");
    expect(source).toContain("refreshToken={auditRefreshToken}");
    const buttonIdx = source.indexOf(
      'aria-label={t("factoryRoute.auditRefresh")}',
    );
    const spinnerIdx = source.indexOf(
      '<IconLoader2 className="size-4 animate-spin" />',
    );
    const closingButtonIdx = source.indexOf("</Button>", buttonIdx);
    expect(buttonIdx).toBeGreaterThan(-1);
    expect(spinnerIdx).toBeGreaterThan(buttonIdx);
    expect(spinnerIdx).toBeLessThan(closingButtonIdx);
  });
});
