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
  snapshotGenerationOutputBaseline: vi.fn(
    (): Array<{ id: string; contentHash: string }> => [],
  ),
}));

vi.mock("@/lib/pending-generation", () => ({
  clearPendingGeneration: mocks.clearPendingGeneration,
  failPendingGenerationForMissingImagePayload:
    mocks.failPendingGenerationForMissingImagePayload,
  isPendingGenerationStale: mocks.isPendingGenerationStale,
  patchPendingGeneration: mocks.patchPendingGeneration,
  readPendingGeneration: mocks.readPendingGeneration,
  snapshotGenerationOutputBaseline: mocks.snapshotGenerationOutputBaseline,
  shouldSkipPendingGenerationResume: mocks.shouldSkipPendingGenerationResume,
}));

vi.mock("@/pages/design-editor/generation-prompt-directives", () => ({
  designGenerationDirectives: vi.fn(() => []),
  designIntakeQuestionDirectives: vi.fn(() => []),
  designTemplateRefinementDirectives: vi.fn(() => []),
  designVariantGenerationDirectives: vi.fn(() => []),
  formatUploadedFileContext: mocks.formatUploadedFileContext,
  imageAttachmentsFromUploadedFiles: mocks.imageAttachmentsFromUploadedFiles,
  promptRequestsVariantExploration: vi.fn(() => false),
}));

import { InvalidCanvasDimensionsError } from "@shared/canvas-dimensions";

import { MissingVisualImagePayloadError } from "@/lib/chat-image-attachments";
import { TEMPLATE_CONTEXT_KEY } from "@/lib/composer-context";
import { FIGMA_REFERENCE_GENERATION_DIRECTIVE } from "@/lib/figma-attachment";
import { designGenerationDirectives } from "@/pages/design-editor/generation-prompt-directives";

import { runStartRetryGeneration } from "../commands/start-retry-generation.js";
import { runResumePendingGeneration } from "./resume-pending-generation.js";

const frozenContext = Object.freeze([
  Object.freeze({
    key: "brand",
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
    design: { title: "New design" } as never,
    files: [],
    generationModelRef: { current: null } as never,
    imageAttachmentUnavailableMessage: "Attach the image again.",
    invalidCanvasDimensionsMessage: "The requested canvas size is unsupported.",
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

// oracle-change: Creative context removed from Design; its assertions no longer apply
describe("runResumePendingGeneration", () => {
  it("restores the pending tab without resetting the canonical run tracker", () => {
    mocks.readPendingGeneration.mockReturnValue({
      runTabId: "run-tab",
      previousRunId: "previous-run",
      previousRunBaselineVerified: false,
      currentRunId: "current-run",
      prompt: "Create a design",
    });
    const args = createArgs();

    runResumePendingGeneration(args);

    expect(args.setGenerationChatTabId).toHaveBeenCalledWith("run-tab");
    expect(args.setHasPendingGeneration).toHaveBeenCalledWith(true);
    expect(args.trackAgentGeneration).not.toHaveBeenCalled();
  });

  it("shows invalid canvas dimensions instead of leaving a blank pending design", async () => {
    mocks.readPendingGeneration.mockReturnValue({
      autoGenerate: true,
      files: [],
      prompt: "Create an ad at 0x600",
      skipQuestions: true,
    });
    vi.mocked(designGenerationDirectives).mockImplementationOnce(() => {
      throw new InvalidCanvasDimensionsError("invalid dimensions");
    });
    const args = createArgs();

    runResumePendingGeneration(args);

    await vi.waitFor(() => {
      expect(args.setGenerationIssue).toHaveBeenCalledWith(
        "The requested canvas size is unsupported.",
      );
    });
    expect(mocks.clearPendingGeneration).toHaveBeenCalledWith("design-1");
    expect(args.setHasPendingGeneration).toHaveBeenCalledWith(false);
    expect(args.agentSubmit).not.toHaveBeenCalled();
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
    const args = createArgs();

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
      const args = createArgs();

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
      if (templateId) {
        expect(mocks.snapshotGenerationOutputBaseline).not.toHaveBeenCalled();
      } else {
        expect(mocks.snapshotGenerationOutputBaseline).toHaveBeenCalledWith(
          args.files,
        );
        expect(mocks.patchPendingGeneration).toHaveBeenCalledWith(
          "design-1",
          expect.objectContaining({ outputBaselineFiles: [] }),
        );
      }
    },
  );

  it("tells a new design to use an attached Figma frame's HTML, not redraw it", async () => {
    mocks.readPendingGeneration.mockReturnValue({
      prompt: "Make me this Figma design",
      files: [],
      contextItems: [
        {
          key: "figma-reference:file:Test.fig:1:1",
          title: "Test.fig",
          context: "The user attached a Figma design as reference",
          status: "ready",
        },
      ],
      skipQuestions: true,
    });
    const args = createArgs();

    runResumePendingGeneration(args);

    await vi.waitFor(() => expect(args.agentSubmit).toHaveBeenCalledOnce());
    const context = vi.mocked(args.agentSubmit).mock.calls[0]?.[1] ?? "";
    expect(context).toContain(FIGMA_REFERENCE_GENERATION_DIRECTIVE);
  });

  it("adds no Figma directive without a Figma attachment", async () => {
    mocks.readPendingGeneration.mockReturnValue({
      prompt: "Keep the original brief",
      files: [],
      contextItems: frozenContext,
      skipQuestions: true,
    });
    const args = createArgs();

    runResumePendingGeneration(args);

    await vi.waitFor(() => expect(args.agentSubmit).toHaveBeenCalledOnce());
    const context = vi.mocked(args.agentSubmit).mock.calls[0]?.[1] ?? "";
    expect(context).not.toContain(FIGMA_REFERENCE_GENERATION_DIRECTIVE);
  });

  it("reports invalid canvas dimensions and does not start a retry run", async () => {
    const args = {
      ...createArgs(),
      canEditDesign: true,
      clearAutoRetryTimer: vi.fn(),
      previousRunTabId: null,
      retryInFlightRef: { current: false },
      trackActiveRun: vi.fn(),
      setRetryablePrompt: vi.fn(),
    };
    vi.mocked(designGenerationDirectives).mockImplementationOnce(() => {
      throw new InvalidCanvasDimensionsError("invalid dimensions");
    });
    const promptState = {
      prompt: "Create an ad at 0x600",
      files: [],
      contextItems: frozenContext,
      model: "selected-model",
    };

    await runStartRetryGeneration(args, promptState, 2, "manual");

    expect(args.setGenerationIssue).toHaveBeenCalledWith(
      "The requested canvas size is unsupported.",
    );
    expect(args.setHasPendingGeneration).toHaveBeenCalledWith(false);
    expect(args.agentSubmit).not.toHaveBeenCalled();
  });

  it("retains the same frozen context, attachments and model through retry persistence and submission", async () => {
    const args = {
      ...createArgs(),
      canEditDesign: true,
      clearAutoRetryTimer: vi.fn(),
      previousRunTabId: null,
      retryInFlightRef: { current: false },
      trackActiveRun: vi.fn(),
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
      previousRunTabId: null,
      retryInFlightRef: { current: false },
      trackActiveRun: vi.fn(),
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
