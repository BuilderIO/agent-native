import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPendingGeneration: vi.fn(),
  shouldSkipPendingGenerationResume: vi.fn(() => false),
  isPendingGenerationStale: vi.fn(() => false),
  formatUploadedFileContext: vi.fn(() => ""),
  patchPendingGeneration: vi.fn(),
  loadDesignSystemGenerationContext: vi.fn(),
}));

vi.mock("@/lib/pending-generation", () => ({
  isPendingGenerationStale: mocks.isPendingGenerationStale,
  patchPendingGeneration: mocks.patchPendingGeneration,
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
  designGenerationDirectives: vi.fn(() => []),
  designIntakeQuestionDirectives: vi.fn(() => []),
  designTemplateRefinementDirectives: vi.fn(() => []),
  designVariantGenerationDirectives: vi.fn(() => []),
  formatUploadedFileContext: mocks.formatUploadedFileContext,
  imageAttachmentsFromUploadedFiles: vi.fn(() => []),
  loadDesignSystemGenerationContext: mocks.loadDesignSystemGenerationContext,
  promptRequestsVariantExploration: vi.fn(() => false),
}));

vi.mock("@/pages/design-editor/intake-question-topics", () => ({
  allIntakeTopicsCovered: vi.fn(() => false),
  loadIntakeContextFromAppState: vi.fn(),
}));

import {
  SYSTEM_CONTEXT_KEY,
  TEMPLATE_CONTEXT_KEY,
} from "@/lib/composer-context";

import { runStartRetryGeneration } from "../commands/start-retry-generation.js";
import { runResumePendingGeneration } from "./resume-pending-generation.js";

const frozenContext = Object.freeze([
  Object.freeze({
    key: SYSTEM_CONTEXT_KEY,
    title: "Brand",
    context: "Frozen brand rules",
  }),
  Object.freeze({
    key: "reference",
    title: "Reference",
    context: "Frozen source content",
  }),
  Object.freeze({ key: TEMPLATE_CONTEXT_KEY, title: "Template", context: "" }),
]);

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

  it.each([undefined, "template-1"])(
    "resumes with frozen context and model selection (template: %s)",
    async (templateId) => {
      const files = [{ name: "brief.txt", textContent: "Uploaded brief" }];
      mocks.readPendingGeneration.mockReturnValue({
        prompt: "Keep the original brief",
        files,
        contextItems: frozenContext,
        designSystemId: "system-1",
        model: "selected-model",
        engine: "builder",
        effort: "high",
        skipQuestions: true,
        templateId,
      });
      const args = createArgs({
        creativeContextLabLoading: false,
        creativeContextEnabled: false,
      });

      runResumePendingGeneration(args);

      await vi.waitFor(() => expect(args.agentSubmit).toHaveBeenCalledOnce());
      expect(args.agentSubmit).toHaveBeenCalledWith(
        "Keep the original brief",
        expect.stringContaining("Frozen source content"),
        expect.objectContaining({
          model: "selected-model",
          engine: "builder",
          effort: "high",
        }),
      );
      expect(args.agentSubmit).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining("Frozen brand rules"),
        expect.anything(),
      );
      expect(mocks.formatUploadedFileContext).toHaveBeenCalledWith(files);
      expect(mocks.loadDesignSystemGenerationContext).not.toHaveBeenCalled();
    },
  );

  it("retains the same frozen context, attachments and model through retry persistence and submission", async () => {
    const args = {
      ...createArgs(),
      canEditDesign: true,
      clearAutoRetryTimer: vi.fn(),
      setRetryablePrompt: vi.fn(),
    };
    const promptState = {
      prompt: "Keep the original brief",
      files: [
        {
          originalName: "brief.txt",
          filename: "brief.txt",
          path: "/uploads/brief.txt",
          size: 14,
          type: "text/plain",
          textContent: "Uploaded brief",
        },
      ],
      contextItems: frozenContext,
      designSystemId: "system-1",
      model: "selected-model",
      engine: "builder",
      effort: "high" as const,
    };

    await runStartRetryGeneration(args, promptState, 2, "manual");

    expect(mocks.patchPendingGeneration).toHaveBeenCalledWith(
      "design-1",
      expect.objectContaining({
        contextItems: frozenContext,
        files: promptState.files,
        model: "selected-model",
        effort: "high",
      }),
    );
    expect(args.agentSubmit).toHaveBeenCalledWith(
      promptState.prompt,
      expect.stringContaining("Frozen source content"),
      expect.objectContaining({
        model: "selected-model",
        engine: "builder",
        effort: "high",
      }),
    );
    expect(mocks.loadDesignSystemGenerationContext).not.toHaveBeenCalled();
  });
});
