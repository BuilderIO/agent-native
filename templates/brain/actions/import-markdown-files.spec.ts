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
    BrainCaptureConcurrentError: class extends Error {
      constructor() {
        super("Capture changed concurrently. Retry the import.");
      }
    },
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
  BrainCaptureConcurrentError: mocks.BrainCaptureConcurrentError,
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
      metadataJson: JSON.stringify({
        ...(input.capturedAt ? { capturedAtSource: "manual-markdown" } : {}),
        ...(input.metadata?.participants?.length
          ? { participantsCount: input.metadata.participants.length }
          : {}),
      }),
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

  // oracle-change: participant labels are now accepted and screened to a count.
  it.each([
    { participants: [""] },
    { participants: ["   "] },
    { participants: ["x".repeat(201)] },
    { participants: [42] },
    { participants: Array(101).fill("Avery") },
  ])("rejects invalid participant labels %j", ({ participants }) => {
    const schema = (
      action as unknown as {
        schema: { safeParse: (value: unknown) => { success: boolean } };
      }
    ).schema;
    expect(
      schema.safeParse({
        files: [{ path: "meeting.md", content: "Meeting", participants }],
      }).success,
    ).toBe(false);
  });

  it("accepts per-file transcript provenance without changing the source audience", async () => {
    const schema = (
      action as unknown as {
        schema: { parse: (value: unknown) => Parameters<typeof action.run>[0] };
      }
    ).schema;
    const args = schema.parse({
      sourceId: "source-1",
      files: [
        {
          path: "meetings/launch.md",
          content: "Avery: The launch is approved.",
          kind: "transcript",
          capturedAt: "2026-05-20T15:00:00.000Z",
        },
        { path: "docs/plan.md", content: "Plan" },
      ],
      enqueueDistillation: false,
    });
    await action.run(args);

    expect(mocks.createCapture).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: "transcript",
        capturedAt: "2026-05-20T15:00:00.000Z",
        metadata: { path: "meetings/launch.md", sourceFormat: "markdown" },
      }),
    );
    expect(mocks.createCapture.mock.calls[0]?.[0]).not.toHaveProperty(
      "audience",
    );
    expect(mocks.createCapture.mock.calls[1]?.[0]).not.toHaveProperty("kind");
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
        kind: input.kind,
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
    expect(mocks.createCapture.mock.calls[0]?.[0].kind).toBe("transcript");
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
    expect(mocks.createCapture.mock.calls[1]?.[0].kind ?? "document").toBe(
      "document",
    );
    expect(document.files[0]?.status).toBe("blocked");
  });

  it("does not report a different persisted kind as an imported document", async () => {
    mocks.createCapture.mockResolvedValue({
      id: "stored-transcript",
      kind: "transcript",
      status: "queued",
      metadataJson: JSON.stringify({
        passageQuarantine: { version: 1, withheldPassages: 2 },
      }),
    });
    const result = await action.run({
      sourceId: "source-1",
      files: [{ path: "notes.txt", content: "Plan" }],
      kind: "document",
      enqueueDistillation: true,
    });
    expect(result.files[0]).toMatchObject({
      status: "failed",
      errorCode: "capture_concurrent",
      error: expect.stringMatching(/concurrent.*retry/i),
    });
    expect(mocks.enqueueCaptureDistillation).not.toHaveBeenCalled();
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

  it("stops screening files once the request time budget is used up", async () => {
    vi.useFakeTimers();
    try {
      mocks.createCapture.mockImplementationOnce(async (input) => {
        vi.setSystemTime(Date.now() + 120_000);
        return {
          id: "capture-slow",
          sourceId: input.sourceId,
          status: "queued",
          ...input,
        };
      });
      const result = await action.run({
        sourceTitle: "Onboarding docs",
        files: [
          { path: "first.md", content: "First" },
          { path: "second.md", content: "Second" },
        ],
        enqueueDistillation: false,
      });
      expect(mocks.createCapture).toHaveBeenCalledTimes(1);
      expect(result.summary).toMatchObject({ imported: 1, failed: 1 });
      expect(result.files[1]).toMatchObject({
        path: "second.md",
        status: "failed",
        errorCode: "batch_time_budget",
      });
    } finally {
      vi.useRealTimers();
    }
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
      return {
        id: `capture-${input.title}`,
        status: "queued",
        kind: input.kind,
      };
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

describe("import-markdown-files provenance races and extra fields", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.ensureManualSource.mockResolvedValue(source);
    mocks.getAccessibleSource.mockResolvedValue({ resource: source });
    mocks.enqueueCaptureDistillation.mockResolvedValue({
      existing: false,
      queueItem: { id: "queue-1" },
    });
  });

  it("applies the supplied meeting time when a concurrent import won the insert", async () => {
    mocks.createCapture
      .mockResolvedValueOnce({
        id: "capture-raced",
        sourceId: "source-1",
        status: "queued",
        kind: "document",
        capturedAt: "2026-11-22T00:00:00.000Z",
      })
      .mockImplementationOnce(async (input) => ({
        id: "capture-raced",
        sourceId: "source-1",
        status: "queued",
        kind: input.kind,
        capturedAt: input.capturedAt,
        metadataJson: JSON.stringify({ capturedAtSource: "manual-markdown" }),
      }));

    const result = await action.run({
      sourceTitle: "Onboarding docs",
      files: [
        {
          path: "meeting.md",
          content: "Morgan will ship Atlas",
          kind: "transcript",
          capturedAt: "2026-11-18T12:00:00.000Z",
        },
      ],
      enqueueDistillation: false,
    });

    expect(mocks.createCapture).toHaveBeenCalledTimes(2);
    expect(result.summary).toMatchObject({ imported: 1, failed: 0 });
  });

  it("retries when a concurrent first import dropped supplied participants", async () => {
    mocks.createCapture
      .mockResolvedValueOnce({
        id: "capture-raced",
        status: "queued",
        metadataJson: "{}",
      })
      .mockResolvedValueOnce({
        id: "capture-raced",
        status: "queued",
        metadataJson: JSON.stringify({ participantsCount: 2 }),
      });
    const result = await action.run({
      sourceId: "source-1",
      files: [
        {
          path: "meeting.md",
          content: "Meeting",
          participants: ["Avery", "Jordan"],
        },
      ],
      enqueueDistillation: false,
    });
    expect(mocks.createCapture).toHaveBeenCalledTimes(2);
    expect(result.summary).toMatchObject({ imported: 1, failed: 0 });
  });

  it("reports failure if a participant count cannot be applied on retry", async () => {
    mocks.createCapture.mockResolvedValue({
      id: "capture-raced",
      status: "queued",
      metadataJson: "{}",
    });
    const result = await action.run({
      sourceId: "source-1",
      files: [
        { path: "meeting.md", content: "Meeting", participants: ["Avery"] },
      ],
      enqueueDistillation: false,
    });
    expect(mocks.createCapture).toHaveBeenCalledTimes(2);
    expect(result.summary).toMatchObject({ imported: 0, failed: 1 });
    expect(result.files[0]).toMatchObject({
      status: "failed",
      errorCode: "capture_changed",
    });
  });

  it("retries when the same time lacks explicit timestamp provenance", async () => {
    mocks.createCapture
      .mockResolvedValueOnce({
        id: "capture-raced",
        status: "queued",
        capturedAt: "2026-11-18T12:00:00.000Z",
        metadataJson: "{}",
      })
      .mockResolvedValueOnce({
        id: "capture-raced",
        status: "queued",
        capturedAt: "2026-11-18T12:00:00.000Z",
        metadataJson: JSON.stringify({ capturedAtSource: "manual-markdown" }),
      });
    const result = await action.run({
      sourceId: "source-1",
      files: [
        {
          path: "meeting.md",
          content: "Meeting",
          capturedAt: "2026-11-18T12:00:00.000Z",
        },
      ],
      enqueueDistillation: false,
    });
    expect(mocks.createCapture).toHaveBeenCalledTimes(2);
    expect(result.summary).toMatchObject({ imported: 1, failed: 0 });
  });

  it("reports a failure instead of success when the supplied meeting time still cannot be applied", async () => {
    mocks.createCapture.mockResolvedValue({
      id: "capture-raced",
      sourceId: "source-1",
      status: "queued",
      kind: "document",
      capturedAt: "2026-11-22T00:00:00.000Z",
    });

    const result = await action.run({
      sourceTitle: "Onboarding docs",
      files: [
        {
          path: "meeting.md",
          content: "Morgan will ship Atlas",
          capturedAt: "2026-11-18T12:00:00.000Z",
        },
      ],
      enqueueDistillation: false,
    });

    expect(result.summary).toMatchObject({ imported: 0, failed: 1 });
  });

  it("ignores unknown per-file fields instead of rejecting the batch", () => {
    const schema = (
      action as unknown as {
        schema: { safeParse: (value: unknown) => { success: boolean } };
      }
    ).schema;
    expect(
      schema.safeParse({
        files: [{ path: "a.md", content: "text", title: "A", metadata: {} }],
      }).success,
    ).toBe(true);
  });
});
