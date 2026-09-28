import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./DesignEditor.tsx", import.meta.url),
  "utf8",
);

describe("empty design", () => {
  it("renders the board instead of an empty state", () => {
    expect(source).toContain(') : viewMode === "overview" || activeFile ? (');
    expect(source).not.toContain("designEditor.noFiles");
    expect(source).not.toContain("canvasEngaged");
  });

  it("keeps a failed generation recoverable", () => {
    expect(source).toContain("<GenerationStatusCard");
    expect(source).toContain("onRetry={handleRetryGeneration}");
    const gate = source.slice(
      source.indexOf("{designIsEmpty &&"),
      source.indexOf("<GenerationStatusCard"),
    );
    expect(gate).toContain(
      "generating || pendingGenerationActive || generationIssue",
    );
  });

  it("keeps the prompt and blocks generation when Labs state is unreadable", () => {
    const submit = source.slice(
      source.indexOf("onSubmit={async (\n          prompt: string,"),
      source.indexOf('title={t("designEditor.tweaksPromptTitle")'),
    );
    const labStateGuard = submit.indexOf("if (!creativeContextLab.isSuccess)");

    expect(labStateGuard).toBeGreaterThanOrEqual(0);
    expect(submit.indexOf("setGenerationIssue(issue)")).toBeGreaterThan(
      labStateGuard,
    );
    expect(submit.indexOf("throw new Error(issue)")).toBeGreaterThan(
      labStateGuard,
    );
    expect(submit.indexOf("agentSubmit(")).toBeGreaterThan(labStateGuard);
    expect(submit.indexOf("patchPendingGeneration(")).toBeGreaterThan(
      labStateGuard,
    );
  });

  it("offers creation prompts in the chat rather than orientation ones", () => {
    const config = source.slice(
      source.indexOf("const designAgentSuggestionConfig = useMemo"),
      source.indexOf("const activeLayerPanelNodes"),
    );
    expect(config).toContain("designIsEmpty");
    expect(config).toContain("buildDynamicAgentSuggestions(context)");
  });

  it("opens the agent and lands the caret in the chat on arrival", () => {
    const handler = source.slice(
      source.indexOf("const openGenerateInAgent = useCallback"),
      source.indexOf("const arrivedFromNewDesign"),
    );
    expect(handler).toContain('new Event("agent-panel:open")');
    const listener = source.slice(
      source.indexOf("const openAgentPanel = () => {"),
      source.indexOf('window.addEventListener("agent-panel:open"'),
    );
    expect(listener).toContain("focusAgentComposer()");
  });

  it("adds no second Generate control beside the toolbar", () => {
    expect(source).not.toContain("data-design-generate-cta");
  });
});
