import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./DesignEditor.tsx", import.meta.url),
  "utf8",
);

describe("empty design", () => {
  it("renders the board instead of an empty state", () => {
    // Overview draws the board with zero screens, so only the single-screen
    // canvas needs a file. Requiring one here is what produced a full-page
    // "No files yet" card on the one screen where drawing is the whole point.
    expect(source).toContain(') : viewMode === "overview" || activeFile ? (');
    expect(source).not.toContain("designEditor.noFiles");
    expect(source).not.toContain("canvasEngaged");
  });

  it("keeps a failed generation recoverable", () => {
    // Losing the card entirely would strand a failed run with no retry.
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
    // Goes through agent-panel:open, which opens the panel AND focuses the
    // composer — a direct setActiveLeftPanel would open it with no caret.
    expect(handler).toContain('new Event("agent-panel:open")');
    // Focus lives in focus-agent-composer.ts with its own retry tests; the
    // listener must call it instead of growing a second copy here.
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
