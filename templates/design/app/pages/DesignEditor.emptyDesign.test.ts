import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

const source = readDesignEditorSource();

describe("empty design", () => {
  it("shares composer context with signed-in editor chats, not capability-only sessions", () => {
    const surfaceStart = source.indexOf("<MemoAgentChatSurface");
    const surfaceEnd = source.indexOf('mode="panel"', surfaceStart);
    expect(surfaceStart).toBeGreaterThan(-1);
    expect(surfaceEnd).toBeGreaterThan(surfaceStart);
    expect(source.slice(surfaceStart, surfaceEnd)).toMatch(
      /composerContextProvider=\{\s*isSignedIn \? DesignComposerContextProvider : undefined\s*\}/,
    );
    expect(source).toContain(") : canApplyPendingVisualEditsWithAgent ? (");
    expect(source).toContain(
      "canEditDesign && (isSignedIn || hostEmbeddedEditor || pageHasWebMcpHost())",
    );
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
});
