import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockBrainCaptureBlockedError extends Error {
    receipt: Record<string, unknown>;

    constructor(receipt: Record<string, unknown>) {
      super("blocked");
      this.receipt = receipt;
    }
  }

  return {
    BrainCaptureBlockedError: MockBrainCaptureBlockedError,
    createCapture: vi.fn(),
    ensureManualSource: vi.fn(),
    enqueueCaptureDistillation: vi.fn(),
    getAccessibleSource: vi.fn(),
  };
});

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("../server/lib/brain.js", () => ({
  BrainCaptureBlockedError: mocks.BrainCaptureBlockedError,
  createCapture: mocks.createCapture,
  ensureManualSource: mocks.ensureManualSource,
  getAccessibleSource: mocks.getAccessibleSource,
  serializeSource: (source: unknown) => source,
}));

vi.mock("../server/lib/distillation-queue.js", () => ({
  enqueueCaptureDistillation: mocks.enqueueCaptureDistillation,
}));

import action from "./import-markdown-files.js";

const source = {
  id: "source-1",
  title: "Onboarding docs",
  provider: "manual",
  visibility: "private",
};

describe("import-markdown-files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureManualSource.mockResolvedValue(source);
    mocks.getAccessibleSource.mockResolvedValue({ resource: source });
    mocks.createCapture.mockImplementation(async (input) => ({
      id: `capture-${input.externalId}`,
      sourceId: input.sourceId,
      status: "queued",
      ...input,
    }));
    mocks.enqueueCaptureDistillation.mockResolvedValue({
      existing: false,
      queueItem: { id: "queue-1" },
    });
  });

  it("imports Markdown files with stable relative-path ids and queues them", async () => {
    const result = await action.run({
      sourceTitle: "Onboarding docs",
      files: [
        { path: "docs/getting-started.md", content: "# Getting started" },
        { path: "docs\\setup.markdown", content: "# Setup" },
      ],
      enqueueDistillation: true,
    });

    expect(mocks.createCapture).toHaveBeenNthCalledWith(1, {
      sourceId: "source-1",
      externalId: "markdown:docs/getting-started.md",
      title: "docs/getting-started.md",
      kind: "document",
      content: "# Getting started",
      metadata: {
        path: "docs/getting-started.md",
        sourceFormat: "markdown",
      },
    });
    expect(mocks.createCapture).toHaveBeenNthCalledWith(2, {
      sourceId: "source-1",
      externalId: "markdown:docs/setup.markdown",
      title: "docs/setup.markdown",
      kind: "document",
      content: "# Setup",
      metadata: {
        path: "docs/setup.markdown",
        sourceFormat: "markdown",
      },
    });
    expect(result.summary).toEqual({
      requested: 2,
      imported: 2,
      queued: 2,
      blocked: 0,
      failed: 0,
    });
  });

  it("reports unsupported and empty files without pretending they imported", async () => {
    const result = await action.run({
      sourceId: "source-1",
      files: [
        { path: "docs/readme.txt", content: "not Markdown" },
        { path: "docs/empty.md", content: "   " },
      ],
      enqueueDistillation: true,
    });

    expect(mocks.createCapture).not.toHaveBeenCalled();
    expect(result.source).toBeUndefined();
    expect(result.files).toEqual([
      {
        path: "docs/readme.txt",
        status: "failed",
        error: "Only .md and .markdown files are supported.",
      },
      {
        path: "docs/empty.md",
        status: "failed",
        error: "The Markdown file is empty.",
      },
    ]);
    expect(result.summary.failed).toBe(2);
  });

  it("returns a sensitivity receipt for a blocked file", async () => {
    const receipt = { id: "receipt-1", disposition: "quarantined" };
    mocks.createCapture.mockRejectedValue(
      new mocks.BrainCaptureBlockedError(receipt),
    );

    const result = await action.run({
      sourceId: "source-1",
      files: [{ path: "docs/private.md", content: "Sensitive text" }],
      enqueueDistillation: true,
    });

    expect(result.files).toEqual([
      {
        path: "docs/private.md",
        status: "blocked",
        sensitivityReceipt: receipt,
      },
    ]);
    expect(result.summary).toEqual({
      requested: 1,
      imported: 0,
      queued: 0,
      blocked: 1,
      failed: 0,
    });
  });
});
