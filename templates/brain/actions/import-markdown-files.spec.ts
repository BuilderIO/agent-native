import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

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
  createCaptureWithWarnings: async (
    ...args: Parameters<typeof mocks.createCapture>
  ) => ({
    capture: await mocks.createCapture(...args),
  }),
  ensureManualSource: mocks.ensureManualSource,
  getAccessibleSource: mocks.getAccessibleSource,
  serializeSource: (source: unknown) => source,
}));

vi.mock("../server/lib/distillation-queue.js", () => ({
  enqueueCaptureDistillation: mocks.enqueueCaptureDistillation,
}));

import {
  BrainClassifierUnavailableError,
  sanitizeCaptureForStorage,
} from "../server/lib/capture-sanitization.js";
import { withheldPassageCount } from "../server/lib/search-index-contracts.js";
import { DEFAULT_BRAIN_SETTINGS } from "../shared/types.js";
import action from "./import-markdown-files.js";

const schema = (
  action as typeof action & {
    schema: z.ZodType<Parameters<typeof action.run>[0]>;
  }
).schema;

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

  it("screens explicitly selected manual transcripts and reports only the safe receipt", async () => {
    const content = [
      "Roadmap launch is on track.",
      "The product plan is ready.",
      "Her salary increase is approved.",
      "The API project is next.",
      "The customer launch is Friday.",
    ].join("\n");
    let stored:
      | Awaited<ReturnType<typeof sanitizeCaptureForStorage>>
      | undefined;
    mocks.createCapture.mockImplementation(async (input) => {
      stored = await sanitizeCaptureForStorage({
        ...input,
        source: { ...source, ownerEmail: "owner@example.test" },
        settings: {
          ...DEFAULT_BRAIN_SETTINGS,
          privacyClassifier: "deterministic",
        },
      });
      if (stored.decision?.disposition !== "allowed") {
        throw new mocks.BrainCaptureBlockedError({
          disposition: "quarantined",
        });
      }
      return {
        id: "capture-1",
        status: "queued",
        metadataJson: JSON.stringify(stored.metadata),
      };
    });

    const args = schema.parse({
      sourceId: "source-1",
      files: [{ path: "meeting.txt", content }],
      kind: "transcript",
      enqueueDistillation: false,
    });
    const result = await action.run(args);
    expect(result.files[0]).toMatchObject({
      status: "imported",
      withheldPassages: 1,
      passageQuarantine: { version: 1, withheldPassages: 1 },
    });
    expect(mocks.createCapture.mock.calls[0][0].kind).toBe("transcript");
    expect(stored?.content).toContain("Roadmap launch");
    expect(stored?.content).toContain("customer launch");
    expect(stored?.content).not.toContain("salary");
    expect(stored?.content).toContain("[…]");
    expect(
      withheldPassageCount(stored?.metadata ?? null, "manual", "transcript"),
    ).toBe(1);
    expect(JSON.stringify(result)).not.toContain("salary");

    const documentArgs = schema.parse({
      sourceId: "source-1",
      files: [{ path: "document.txt", content }],
      enqueueDistillation: false,
    });
    const document = await action.run(documentArgs);
    expect(mocks.createCapture.mock.calls[1][0].kind).toBe("document");
    expect(document.files[0].status).toBe("blocked");
  });

  it("imports plain text files and records their format", async () => {
    await action.run({
      sourceId: "source-1",
      files: [
        { path: "notes/plan.txt", content: "Plan" },
        { path: "notes/RETRO.TXT", content: "Retro" },
      ],
      enqueueDistillation: true,
    });

    expect(
      mocks.createCapture.mock.calls.map(([input]) => input.metadata),
    ).toEqual([
      { path: "notes/plan.txt", sourceFormat: "text" },
      { path: "notes/RETRO.TXT", sourceFormat: "text" },
    ]);
  });

  it("reports unsupported and empty files without pretending they imported", async () => {
    const result = await action.run({
      sourceId: "source-1",
      files: [
        { path: "docs/deck.pdf", content: "not supported" },
        { path: "docs/empty.md", content: "   " },
      ],
      enqueueDistillation: true,
    });

    expect(mocks.createCapture).not.toHaveBeenCalled();
    expect(result.source).toBeUndefined();
    expect(result.files).toEqual([
      {
        path: "docs/deck.pdf",
        status: "failed",
        error: "Only .md, .markdown, and .txt files are supported.",
      },
      {
        path: "docs/empty.md",
        status: "failed",
        error: "The file has no text.",
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

describe("report BRAIN-IMPORT-001: markdown screening unavailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureManualSource.mockResolvedValue(source);
    mocks.enqueueCaptureDistillation.mockResolvedValue({
      existing: false,
      queueItem: { id: "queue-1" },
    });
  });

  it("keeps successful siblings and reports a truthful refusal per file", async () => {
    mocks.createCapture.mockImplementation(async (input) => {
      if (input.title === "docs/b.md") {
        throw new BrainClassifierUnavailableError("jev-credential-unavailable");
      }
      return { id: `capture-${input.title}`, status: "queued" };
    });

    const result = await action.run({
      files: [
        { path: "docs/a.md", content: "first" },
        { path: "docs/b.md", content: "second" },
        { path: "docs/c.md", content: "third" },
      ],
      enqueueDistillation: true,
    });

    expect(result.files).toEqual([
      expect.objectContaining({ path: "docs/a.md", status: "imported" }),
      expect.objectContaining({
        path: "docs/b.md",
        status: "failed",
        errorCode: "screening_unavailable",
        error: expect.stringMatching(/retry the import once screening works/i),
      }),
      expect.objectContaining({ path: "docs/c.md", status: "imported" }),
    ]);
    const refusal = result.files[1] as { error: string };
    expect(refusal.error).not.toMatch(
      /scheduled|retries (this source|at the next)/i,
    );
    expect(result.summary).toEqual({
      requested: 3,
      imported: 2,
      queued: 2,
      blocked: 0,
      failed: 1,
    });
    expect(mocks.enqueueCaptureDistillation).toHaveBeenCalledTimes(2);
  });
});
