import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const source = {
    id: "source-1",
    ownerEmail: "owner@example.com",
    orgId: "org-1",
    provider: "generic" as const,
    sourceKey: "connector",
    ingestTokenHash: "hash-secret",
    configJson: JSON.stringify({
      sourceKey: "connector",
      ingestTokenHash: "hash-secret",
    }),
  };
  return {
    source,
    sources: [source],
    createCapture: vi.fn(),
    enqueueDistillation: vi.fn(),
    retireUpstreamDeletedCapture: vi.fn(),
    runWithRequestContext: vi.fn(
      async (
        _context: { userEmail: string; orgId?: string },
        fn: () => Promise<unknown>,
      ) => fn(),
    ),
  };
});

vi.mock("@agent-native/core/server", () => ({
  readBody: vi.fn(async (event: { body?: unknown }) => event.body),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  runWithRequestContext: mocks.runWithRequestContext,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
  isNull: (column: unknown) => ({ op: "isNull", column }),
  like: (column: unknown, value: unknown) => ({ op: "like", column, value }),
  or: (...conditions: unknown[]) => ({ op: "or", conditions }),
}));

vi.mock("h3", () => ({
  createError: (input: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(input.statusMessage), input),
  defineEventHandler: (handler: unknown) => handler,
  getHeader: (
    event: { headers?: Record<string, string> },
    name: string,
  ): string | undefined => event.headers?.[name.toLowerCase()],
}));

vi.mock("../../../../db/index.js", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: async () => mocks.sources,
      }),
    }),
  }),
  schema: {
    brainSources: {
      status: "status",
      sourceKey: "sourceKey",
      ingestTokenHash: "ingestTokenHash",
      configJson: "configJson",
    },
  },
}));

vi.mock("../../../../lib/brain.js", () => ({
  BrainCaptureBlockedError: class BrainCaptureBlockedError extends Error {},
  createCapture: mocks.createCapture,
  parseJson: (value: string, fallback: unknown) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  retireUpstreamDeletedCapture: mocks.retireUpstreamDeletedCapture,
  serializeCapture: (capture: unknown) => capture,
  sha256Hex: async (value: string) => `hash-${value}`,
}));

vi.mock("../../../../lib/distillation-queue.js", () => ({
  enqueueCaptureDistillation: mocks.enqueueDistillation,
}));

vi.mock("../../../../lib/meeting-audience.js", () => ({
  resolveMeetingMemberEmails: () => [
    "participant@example.com",
    "owner@example.com",
  ],
}));

import handler from "./ingest.post.js";

type TestEvent = {
  body: unknown;
  headers?: Record<string, string>;
};

async function ingest(body: unknown, token = "secret") {
  return (handler as unknown as (event: TestEvent) => Promise<unknown>)({
    body,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("signed Brain ingestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sources = [mocks.source];
    mocks.createCapture.mockResolvedValue({
      id: "capture-1",
      kind: "generic",
      status: "queued",
    });
    mocks.enqueueDistillation.mockResolvedValue({
      queueItem: { id: "queue-1" },
      existing: false,
    });
    mocks.retireUpstreamDeletedCapture.mockResolvedValue(true);
  });

  it("preserves the transcript payload and meeting audience contract", async () => {
    const result = await ingest({
      sourceKey: "connector",
      externalId: "meeting-1",
      title: "Weekly meeting",
      participants: [{ email: "participant@example.com" }],
      occurredAt: "2026-07-30T12:00:00.000Z",
      transcript: "  Speaker: Legacy transcript  ",
      sourceUrl: "https://example.com/meetings/1",
      tags: ["meeting"],
      raw: { provider: "legacy" },
    });

    expect(mocks.runWithRequestContext).toHaveBeenCalledWith(
      { userEmail: "owner@example.com", orgId: "org-1" },
      expect.any(Function),
    );
    expect(mocks.createCapture).toHaveBeenCalledWith({
      sourceId: "source-1",
      externalId: "meeting-1",
      title: "Weekly meeting",
      kind: "transcript",
      content: "Speaker: Legacy transcript",
      capturedAt: "2026-07-30T12:00:00.000Z",
      metadata: {
        sourceKey: "connector",
        participants: [{ email: "participant@example.com" }],
        segments: [],
        sourceUrl: "https://example.com/meetings/1",
        tags: ["meeting"],
        raw: { provider: "legacy" },
      },
      audience: {
        kind: "meeting",
        memberEmails: ["participant@example.com", "owner@example.com"],
        upstreamRefHash: "meeting-1",
      },
    });
    expect(mocks.enqueueDistillation).toHaveBeenCalledWith({
      capture: {
        id: "capture-1",
        kind: "generic",
        status: "queued",
      },
      priority: 50,
      payload: {
        sourceKey: "connector",
        externalId: "meeting-1",
      },
    });
    expect(result).toMatchObject({
      ok: true,
      sourceId: "source-1",
      distillation: {
        queued: true,
        queueId: "queue-1",
        existing: false,
      },
    });
  });

  it.each(["document", "note", "message", "generic"] as const)(
    "accepts normalized %s captures with source metadata",
    async (kind) => {
      await ingest({
        sourceKey: "connector",
        externalId: `${kind}-1`,
        title: `A ${kind}`,
        kind,
        content: `  ${kind} body  `,
        capturedAt: "2026-07-30T13:00:00.000Z",
        sourceUrl: `https://example.com/${kind}/1`,
        tags: ["normalized", kind],
        metadata: {
          channel: "customer-feedback",
          sourceKey: "cannot-override",
        },
      });

      expect(mocks.createCapture).toHaveBeenCalledWith({
        sourceId: "source-1",
        externalId: `${kind}-1`,
        title: `A ${kind}`,
        kind,
        content: `${kind} body`,
        capturedAt: "2026-07-30T13:00:00.000Z",
        metadata: {
          channel: "customer-feedback",
          sourceKey: "connector",
          sourceUrl: `https://example.com/${kind}/1`,
          tags: ["normalized", kind],
        },
        audience: undefined,
      });
      expect(mocks.enqueueDistillation).toHaveBeenCalledOnce();
    },
  );

  it("retires an upstream capture from a content-free tombstone", async () => {
    const result = await ingest({
      sourceKey: "connector",
      externalId: "deleted-1",
      deleted: true,
    });

    expect(mocks.retireUpstreamDeletedCapture).toHaveBeenCalledWith({
      sourceId: "source-1",
      externalId: "deleted-1",
      provider: "generic",
    });
    expect(mocks.createCapture).not.toHaveBeenCalled();
    expect(mocks.enqueueDistillation).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      sourceId: "source-1",
      capture: null,
      deleted: true,
      retired: true,
    });
  });

  it("does not requeue an unchanged terminal capture", async () => {
    mocks.createCapture.mockResolvedValue({
      id: "capture-1",
      kind: "document",
      status: "distilled",
    });

    const result = await ingest({
      sourceKey: "connector",
      externalId: "document-1",
      title: "Document",
      kind: "document",
      content: "Body",
    });

    expect(mocks.enqueueDistillation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      distillation: {
        queued: false,
        queueId: null,
        reason: "already-distilled",
      },
    });
  });

  it("still requires the signed bearer token", async () => {
    await expect(
      ingest(
        {
          sourceKey: "connector",
          externalId: "document-1",
          title: "Document",
          content: "Body",
        },
        "",
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: "Missing token",
    });
    expect(mocks.createCapture).not.toHaveBeenCalled();
  });
});
