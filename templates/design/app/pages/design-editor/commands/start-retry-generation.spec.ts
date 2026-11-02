import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failPendingGenerationForMissingImagePayload: vi.fn(() => false),
  patchPendingGeneration: vi.fn(),
  readAgentRunStatus: vi.fn(),
}));

vi.mock("@/lib/agent-run-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agent-run-status")>()),
  readAgentRunStatus: mocks.readAgentRunStatus,
}));

vi.mock("@/lib/pending-generation", () => ({
  failPendingGenerationForMissingImagePayload:
    mocks.failPendingGenerationForMissingImagePayload,
  patchPendingGeneration: mocks.patchPendingGeneration,
}));

vi.mock("@/lib/composer-context", () => ({
  formatComposerContext: vi.fn(() => ""),
  hasComposerSystemContext: vi.fn(() => false),
}));

vi.mock("@/pages/design-editor/generation-prompt-directives", () => ({
  designGenerationDirectives: vi.fn(() => []),
  designTemplateRefinementDirectives: vi.fn(() => []),
  formatUploadedFileContext: vi.fn(() => ""),
  imageAttachmentsFromUploadedFiles: vi.fn(() => []),
  loadDesignSystemGenerationContext: vi.fn(async () => ""),
}));

import { runStartRetryGeneration } from "./start-retry-generation";

function createArgs(
  overrides: Partial<Parameters<typeof runStartRetryGeneration>[0]> = {},
) {
  return {
    agentSubmit: vi.fn(() => "run-tab"),
    canEditDesign: true,
    clearAutoRetryTimer: vi.fn(),
    clearGenerationCompleteTimer: vi.fn(),
    design: { title: "Design" },
    generationModelRef: { current: null },
    imageAttachmentUnavailableMessage: "Attach the image again.",
    invalidCanvasDimensionsMessage: "Invalid canvas dimensions.",
    id: "design-1",
    previousRunTabId: null,
    retryInFlightRef: { current: false },
    trackActiveRun: vi.fn(),
    setGenerationChatTabId: vi.fn(),
    setGenerationIssue: vi.fn(),
    setHasPendingGeneration: vi.fn(),
    setRetryablePrompt: vi.fn(),
    ...overrides,
  } as Parameters<typeof runStartRetryGeneration>[0];
}

const promptState = {
  prompt: "Create a design",
  files: [],
  designSystemId: null,
};

describe("runStartRetryGeneration output baseline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves an unknown baseline instead of writing an empty one", async () => {
    const args = createArgs();

    await runStartRetryGeneration(args, promptState, 2, "manual");

    expect(mocks.patchPendingGeneration).toHaveBeenCalledTimes(2);
    for (const [, patch] of mocks.patchPendingGeneration.mock.calls) {
      expect(patch).not.toHaveProperty("outputBaselineFiles");
    }
  });

  it("persists a known empty baseline", async () => {
    const args = createArgs({ outputBaselineFiles: [] });

    await runStartRetryGeneration(args, promptState, 2, "manual");

    expect(mocks.patchPendingGeneration).toHaveBeenCalledTimes(2);
    for (const [, patch] of mocks.patchPendingGeneration.mock.calls) {
      expect(patch).toHaveProperty("outputBaselineFiles", []);
    }
  });
});

describe("runStartRetryGeneration auto retry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("follows a run still active on the previous tab instead of submitting again", async () => {
    mocks.readAgentRunStatus.mockResolvedValue({
      ok: true,
      status: "running",
      active: true,
      runId: "skip-run",
      turnId: "skip-turn",
    });
    const args = createArgs({ previousRunTabId: "question-tab" });

    await runStartRetryGeneration(
      args,
      { ...promptState, attempt: 1 },
      2,
      "auto",
    );

    expect(args.agentSubmit).not.toHaveBeenCalled();
    expect(args.trackActiveRun).toHaveBeenCalledWith("question-tab", {
      currentRunId: "skip-run",
      currentTurnId: "skip-turn",
    });
    expect(mocks.patchPendingGeneration).toHaveBeenCalledWith(
      "design-1",
      expect.objectContaining({
        attempt: 1,
        runTabId: "question-tab",
        currentRunId: "skip-run",
      }),
    );
    expect(args.setGenerationIssue).toHaveBeenCalledWith(null);
    expect(args.setRetryablePrompt).toHaveBeenCalledWith(null);
  });

  it("refuses a second retry while the first is still reading run state", async () => {
    let finishRead: (value: {
      ok: true;
      status: string;
      active: boolean;
    }) => void = () => {};
    mocks.readAgentRunStatus.mockReturnValueOnce(
      new Promise((resolve) => {
        finishRead = resolve;
      }),
    );
    const args = createArgs({ previousRunTabId: "question-tab" });

    const first = runStartRetryGeneration(args, promptState, 2, "auto");
    await runStartRetryGeneration(args, promptState, 2, "manual");
    expect(args.agentSubmit).not.toHaveBeenCalled();

    finishRead({ ok: true, status: "idle", active: false });
    await first;
    expect(args.agentSubmit).toHaveBeenCalledTimes(1);
    expect(args.retryInFlightRef.current).toBe(false);
  });

  it("does not submit while the previous run state is unreadable", async () => {
    mocks.readAgentRunStatus.mockResolvedValue({ ok: false });
    const args = createArgs({ previousRunTabId: "question-tab" });

    await runStartRetryGeneration(args, promptState, 2, "auto");

    expect(args.agentSubmit).not.toHaveBeenCalled();
    expect(args.trackActiveRun).not.toHaveBeenCalled();
    expect(mocks.patchPendingGeneration).not.toHaveBeenCalled();
    expect(args.setRetryablePrompt).not.toHaveBeenCalled();
  });

  it("does not submit when the server will not reveal the previous thread", async () => {
    mocks.readAgentRunStatus.mockResolvedValue({
      ok: true,
      status: "unknown",
      active: false,
    });
    const args = createArgs({ previousRunTabId: "question-tab" });

    await runStartRetryGeneration(args, promptState, 2, "auto");

    expect(args.agentSubmit).not.toHaveBeenCalled();
    expect(args.trackActiveRun).not.toHaveBeenCalled();
    expect(args.setRetryablePrompt).not.toHaveBeenCalled();
  });

  it("follows a run waiting to be redispatched instead of submitting", async () => {
    mocks.readAgentRunStatus.mockResolvedValue({
      ok: true,
      status: "completed",
      active: false,
      runId: "deferred-run",
      awaitingRedispatch: true,
    });
    const args = createArgs({ previousRunTabId: "question-tab" });

    await runStartRetryGeneration(args, promptState, 2, "auto");

    expect(args.agentSubmit).not.toHaveBeenCalled();
    expect(args.trackActiveRun).toHaveBeenCalledWith("question-tab", {
      currentRunId: "deferred-run",
    });
  });

  it("follows a run that ended to continue instead of submitting", async () => {
    mocks.readAgentRunStatus.mockResolvedValue({
      ok: true,
      status: "completed",
      active: false,
      runId: "continuing-run",
      turnId: "continuing-turn",
      terminalReason: "auto_continue",
    });
    const args = createArgs({ previousRunTabId: "question-tab" });

    await runStartRetryGeneration(args, promptState, 2, "auto");

    expect(args.agentSubmit).not.toHaveBeenCalled();
    expect(args.trackActiveRun).toHaveBeenCalledWith("question-tab", {
      currentRunId: "continuing-run",
      currentTurnId: "continuing-turn",
    });
  });

  it("submits the retry once the previous run is idle", async () => {
    mocks.readAgentRunStatus.mockResolvedValue({
      ok: true,
      status: "idle",
      active: false,
    });
    const args = createArgs({ previousRunTabId: "question-tab" });

    await runStartRetryGeneration(args, promptState, 2, "auto");

    expect(args.agentSubmit).toHaveBeenCalledTimes(1);
    expect(args.trackActiveRun).not.toHaveBeenCalled();
  });
});
