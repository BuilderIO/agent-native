import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPendingGeneration: vi.fn(),
  shouldSkipPendingGenerationResume: vi.fn(() => false),
  isPendingGenerationStale: vi.fn(() => false),
  formatUploadedFileContext: vi.fn(() => ""),
}));

vi.mock("@/lib/pending-generation", () => ({
  isPendingGenerationStale: mocks.isPendingGenerationStale,
  patchPendingGeneration: vi.fn(),
  readPendingGeneration: mocks.readPendingGeneration,
  shouldSkipPendingGenerationResume: mocks.shouldSkipPendingGenerationResume,
}));

vi.mock("@agent-native/creative-context/client", () => ({
  readCreativeContextState: vi.fn(),
}));

vi.mock("@/pages/design-editor/creative-context-precedent", () => ({
  designPrecedentDirectives: vi.fn(),
}));

vi.mock("@/pages/design-editor/generation-prompt-directives", () => ({
  designGenerationDirectives: vi.fn(),
  designIntakeQuestionDirectives: vi.fn(),
  designTemplateRefinementDirectives: vi.fn(),
  designVariantGenerationDirectives: vi.fn(),
  formatUploadedFileContext: mocks.formatUploadedFileContext,
  imageAttachmentsFromUploadedFiles: vi.fn(() => []),
  loadDesignSystemGenerationContext: vi.fn(),
  promptRequestsVariantExploration: vi.fn(() => false),
}));

vi.mock("@/pages/design-editor/intake-question-topics", () => ({
  allIntakeTopicsCovered: vi.fn(() => false),
  loadIntakeContextFromAppState: vi.fn(),
}));

import { runResumePendingGeneration } from "./resume-pending-generation.js";

function createArgs(
  overrides: Partial<Parameters<typeof runResumePendingGeneration>[0]> = {},
) {
  return {
    agentSubmit: vi.fn(() => "run-tab"),
    clearGenerationCompleteTimer: vi.fn(),
    creativeContextEnabled: true,
    creativeContextLabLoading: true,
    creativeContextLabError: null,
    design: { title: "New design" } as never,
    files: [],
    generationModelRef: { current: null } as never,
    id: "design-1",
    markGenerationStale: vi.fn(),
    setGenerationChatTabId: vi.fn(),
    setGenerationIssue: vi.fn(),
    setHasPendingGeneration: vi.fn(),
    trackAgentGeneration: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.shouldSkipPendingGenerationResume.mockReturnValue(false);
  mocks.isPendingGenerationStale.mockReturnValue(false);
});

describe("runResumePendingGeneration", () => {
  it("waits for Labs before consuming a pending generation", () => {
    const args = createArgs();

    runResumePendingGeneration(args);

    expect(mocks.readPendingGeneration).not.toHaveBeenCalled();
    expect(args.agentSubmit).not.toHaveBeenCalled();
  });

  it("keeps the pending generation and reports an unreadable Labs state", () => {
    mocks.readPendingGeneration.mockReturnValue({
      autoGenerate: true,
      files: [],
      prompt: "Create a design",
    });
    const args = createArgs({
      creativeContextLabLoading: false,
      creativeContextLabError: "Could not read Labs settings.",
    });

    runResumePendingGeneration(args);

    expect(args.setGenerationIssue).toHaveBeenCalledWith(
      "Could not read Labs settings.",
    );
    expect(args.setHasPendingGeneration).toHaveBeenCalledWith(true);
    expect(args.agentSubmit).not.toHaveBeenCalled();
    expect(mocks.formatUploadedFileContext).not.toHaveBeenCalled();
  });
});
