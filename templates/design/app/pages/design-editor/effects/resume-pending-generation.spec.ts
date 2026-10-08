import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPendingGeneration: vi.fn(),
  shouldSkipPendingGenerationResume: vi.fn(() => false),
  isPendingGenerationStale: vi.fn(() => false),
  clearPendingGeneration: vi.fn(),
  failPendingGenerationForMissingImagePayload:
    vi.fn<
      (
        id: string | undefined,
        error: unknown,
        message: string,
        setGenerationIssue: (message: string) => void,
        setHasPendingGeneration: (pending: boolean) => void,
      ) => boolean
    >(),
  formatUploadedFileContext: vi.fn(() => ""),
  imageAttachmentsFromUploadedFiles: vi.fn((): string[] => []),
  patchPendingGeneration: vi.fn(),
  loadDesignSystemGenerationContext: vi.fn(),
}));

vi.mock("@/lib/pending-generation", () => ({
  clearPendingGeneration: mocks.clearPendingGeneration,
  failPendingGenerationForMissingImagePayload:
    mocks.failPendingGenerationForMissingImagePayload,
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
  imageAttachmentsFromUploadedFiles: mocks.imageAttachmentsFromUploadedFiles,
  loadDesignSystemGenerationContext: mocks.loadDesignSystemGenerationContext,
  promptRequestsVariantExploration: vi.fn(() => false),
}));

vi.mock("@/pages/design-editor/intake-question-topics", () => ({
  allIntakeTopicsCovered: vi.fn(() => false),
  loadIntakeContextFromAppState: vi.fn(),
}));

import { MissingVisualImagePayloadError } from "@/lib/chat-image-attachments";
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
    imageAttachmentUnavailableMessage: "Attach the image again.",
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
  mocks.imageAttachmentsFromUploadedFiles.mockReturnValue([]);
  mocks.failPendingGenerationForMissingImagePayload.mockImplementation(
    (id, error, message, setGenerationIssue, setHasPendingGeneration) => {
      if (!(error instanceof MissingVisualImagePayloadError)) return false;
      mocks.clearPendingGeneration(id);
      setGenerationIssue(message);
      setHasPendingGeneration(false);
      return true;
    },
  );
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

  it("clears a pending generation when its image payload cannot be restored", () => {
    const error = new MissingVisualImagePayloadError();
    mocks.readPendingGeneration.mockReturnValue({
      prompt: "Create a design from this screenshot",
      files: [{ type: "image/png", originalName: "reference.png" }],
    });
    mocks.imageAttachmentsFromUploadedFiles.mockImplementationOnce(() => {
      throw error;
    });
    const args = createArgs({ creativeContextLabLoading: false });

    runResumePendingGeneration(args);

    expect(mocks.clearPendingGeneration).toHaveBeenCalledWith("design-1");
    expect(args.setGenerationIssue).toHaveBeenCalledWith(
      "Attach the image again.",
    );
    expect(args.setHasPendingGeneration).toHaveBeenCalledWith(false);
    expect(args.agentSubmit).not.toHaveBeenCalled();
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

  it("clears a retry when its image payload is unavailable", async () => {
    const error = new MissingVisualImagePayloadError();
    mocks.imageAttachmentsFromUploadedFiles.mockImplementationOnce(() => {
      throw error;
    });
    const args = {
      ...createArgs(),
      canEditDesign: true,
      clearAutoRetryTimer: vi.fn(),
      setRetryablePrompt: vi.fn(),
    };
    const promptState = {
      prompt: "Create a design from this screenshot",
      files: [
        {
          type: "image/png",
          originalName: "reference.png",
          filename: "reference.png",
          path: "/uploads/reference.png",
          size: 123,
        },
      ],
    };

    await runStartRetryGeneration(args, promptState, 2, "manual");

    expect(mocks.clearPendingGeneration).toHaveBeenCalledWith("design-1");
    expect(args.setGenerationIssue).toHaveBeenCalledWith(
      "Attach the image again.",
    );
    expect(args.setHasPendingGeneration).toHaveBeenCalledWith(false);
    expect(args.setRetryablePrompt).toHaveBeenCalledWith(null);
    expect(args.agentSubmit).not.toHaveBeenCalled();
  });
});
