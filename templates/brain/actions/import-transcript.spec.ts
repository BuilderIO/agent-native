import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCapture: vi.fn(),
  ensureManualSource: vi.fn(),
  BrainCaptureBlockedError: class BrainCaptureBlockedError extends Error {},
  enqueueCaptureDistillation: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/brain.js", () => ({
  BrainCaptureBlockedError: mocks.BrainCaptureBlockedError,
  createCaptureWithWarnings: async (
    ...args: Parameters<typeof mocks.createCapture>
  ) => ({
    capture: await mocks.createCapture(...args),
  }),
  ensureManualSource: mocks.ensureManualSource,
  serializeCapture: (capture: unknown) => capture,
  serializeSource: (source: unknown) => source,
}));

vi.mock("../server/lib/distillation-queue.js", () => ({
  enqueueCaptureDistillation: mocks.enqueueCaptureDistillation,
}));

import { BrainClassifierUnavailableError } from "../server/lib/capture-sanitization.js";
import action from "./import-transcript.js";

const baseArgs = {
  sourceId: "source-1",
  title: "Planning meeting",
  transcript: "Decision: ship the beta.",
  participants: [],
  tags: [],
  enqueueDistillation: false,
};

describe("import-transcript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createCapture.mockResolvedValue({
      id: "capture-1",
      sourceId: "source-1",
      status: "queued",
      updatedAt: "2026-07-30T10:00:00.000Z",
    });
    mocks.enqueueCaptureDistillation.mockResolvedValue({
      queueItem: {
        id: "queue-1",
        updatedAt: "2026-07-30T10:01:00.000Z",
      },
      existing: false,
      guidance: {},
    });
  });

  it("makes the authenticated importer the meeting audience when participants are omitted", async () => {
    mocks.getRequestUserEmail.mockReturnValue(" Importer@Example.Test ");

    await action.run(baseArgs);

    expect(mocks.createCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: expect.objectContaining({
          kind: "meeting",
          memberEmails: ["importer@example.test"],
        }),
        metadata: expect.objectContaining({
          participants: ["importer@example.test"],
        }),
      }),
    );
  });

  it("keeps an explicit participant ACL unchanged", async () => {
    mocks.getRequestUserEmail.mockReturnValue("importer@example.test");

    await action.run({ ...baseArgs, participants: ["attendee@example.test"] });

    expect(mocks.createCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: expect.objectContaining({
          memberEmails: ["attendee@example.test"],
        }),
      }),
    );
  });

  it("rejects an empty participant ACL without an authenticated importer", async () => {
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    await expect(action.run(baseArgs)).rejects.toThrow(
      "requires an authenticated importer",
    );
    expect(mocks.createCapture).not.toHaveBeenCalled();
  });

  it("queues distillation immediately when requested", async () => {
    mocks.getRequestUserEmail.mockReturnValue("importer@example.test");

    const result = await action.run({
      ...baseArgs,
      enqueueDistillation: true,
    });

    expect(mocks.enqueueCaptureDistillation).toHaveBeenCalledWith({
      capture: expect.objectContaining({ id: "capture-1" }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        capture: expect.objectContaining({
          id: "capture-1",
          status: "distilling",
          updatedAt: "2026-07-30T10:01:00.000Z",
        }),
        distillation: expect.objectContaining({
          existing: false,
          queueItem: expect.objectContaining({ id: "queue-1" }),
        }),
      }),
    );
    expect(result).not.toHaveProperty("nextAction");
  });
});

describe("report BRAIN-IMPORT-001: import-transcript screening unavailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureManualSource.mockResolvedValue({ id: "source-1" });
  });

  it.each(["jev-credential-unavailable", "jev-timeout"])(
    "refuses a fresh import with a typed 503 and queues nothing (%s)",
    async (reason) => {
      mocks.createCapture.mockRejectedValue(
        new BrainClassifierUnavailableError(reason),
      );
      const error = await (async () =>
        action.run({
          ...baseArgs,
          sourceId: undefined,
          enqueueDistillation: true,
        }))().catch((e: unknown) => e);
      expect(error).toMatchObject({
        errorCode: "screening_unavailable",
        statusCode: 503,
        details: { reason },
      });
      const message = (error as Error).message;
      expect(message).toMatch(/not stored/i);
      expect(message).toMatch(/retry the import once screening works/i);
      expect(message).not.toMatch(
        /scheduled|retries (this source|at the next)/i,
      );
      expect(mocks.enqueueCaptureDistillation).not.toHaveBeenCalled();
    },
  );

  it("rethrows an unexpected error with its identity intact", async () => {
    const boom = new Error("database exploded");
    mocks.createCapture.mockRejectedValue(boom);
    await expect(
      action.run({
        ...baseArgs,
        sourceId: undefined,
        enqueueDistillation: true,
      }),
    ).rejects.toBe(boom);
    expect(mocks.enqueueCaptureDistillation).not.toHaveBeenCalled();
  });

  it("still returns the receipt for a blocked capture", async () => {
    const receipt = { id: "receipt-1", disposition: "quarantined" };
    mocks.createCapture.mockRejectedValue(
      Object.assign(new mocks.BrainCaptureBlockedError("blocked"), { receipt }),
    );
    const result = await action.run({
      ...baseArgs,
      sourceId: undefined,
      enqueueDistillation: true,
    });
    expect(result).toMatchObject({
      capture: undefined,
      sensitivityReceipt: receipt,
    });
    expect(mocks.enqueueCaptureDistillation).not.toHaveBeenCalled();
  });
});
