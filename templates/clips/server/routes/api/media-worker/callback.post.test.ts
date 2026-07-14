import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetRequestHeader = vi.hoisted(() => vi.fn());
const mockReadRawBody = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockResolveSecret = vi.hoisted(() => vi.fn());
const mockRunWithRequestContext = vi.hoisted(() => vi.fn());
const mockApplyMediaWorkerCallback = vi.hoisted(() => vi.fn());
const mockDbRows = vi.hoisted(
  () =>
    [] as Array<{
      ownerEmail: string;
      orgId?: string | null;
    }>,
);

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRequestHeader: (...args: unknown[]) => mockGetRequestHeader(...args),
  readRawBody: (...args: unknown[]) => mockReadRawBody(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("@agent-native/core/server", () => ({
  resolveSecret: (...args: unknown[]) => mockResolveSecret(...args),
  runWithRequestContext: (...args: unknown[]) =>
    mockRunWithRequestContext(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("../../../db/index.js", () => ({
  getDb: () => ({
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(async () => mockDbRows),
      };
      return builder;
    }),
  }),
  schema: {
    recordings: {
      id: "recordings.id",
      ownerEmail: "recordings.ownerEmail",
      orgId: "recordings.orgId",
    },
  },
}));

vi.mock("../../../lib/builder-media-compression.js", () => ({
  applyMediaWorkerCallback: (...args: unknown[]) =>
    mockApplyMediaWorkerCallback(...args),
}));

import {
  MEDIA_WORKER_SIGNATURE_HEADER,
  MEDIA_WORKER_TIMESTAMP_HEADER,
  signMediaWorkerPayload,
} from "../../../../shared/media-worker-contract.js";
import handler from "./callback.post";

function signedHeaders(rawBody: string, secret = "worker-secret") {
  return signMediaWorkerPayload({
    rawBody,
    secret,
    timestamp: Math.floor(Date.now() / 1000).toString(),
  });
}

describe("/api/media-worker/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRows.length = 0;
    mockDbRows.push({ ownerEmail: "owner@example.com", orgId: "org-1" });
    mockResolveSecret.mockResolvedValue("worker-secret");
    mockRunWithRequestContext.mockImplementation((_ctx, callback) =>
      callback(),
    );
    mockApplyMediaWorkerCallback.mockResolvedValue({
      ok: true,
      status: 200,
      recordingId: "rec-1",
    });
  });

  it("accepts a valid signed callback", async () => {
    const rawBody = JSON.stringify({
      jobId: "rec-1:compress",
      status: "done",
      outputUrl:
        "https://cdn.builder.io/o/assets%2Forg%2Fasset%2Fcompressed?apiKey=org",
    });
    const headers = signedHeaders(rawBody);
    mockReadRawBody.mockResolvedValue(rawBody);
    mockGetRequestHeader.mockImplementation((_event, name) => {
      if (name === MEDIA_WORKER_TIMESTAMP_HEADER) {
        return headers[MEDIA_WORKER_TIMESTAMP_HEADER];
      }
      if (name === MEDIA_WORKER_SIGNATURE_HEADER) {
        return headers[MEDIA_WORKER_SIGNATURE_HEADER];
      }
      return undefined;
    });

    const result = await handler({} as any);

    expect(mockApplyMediaWorkerCallback).toHaveBeenCalledWith({
      jobId: "rec-1:compress",
      status: "done",
      outputUrl:
        "https://cdn.builder.io/o/assets%2Forg%2Fasset%2Fcompressed?apiKey=org",
      durationMs: undefined,
      error: undefined,
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 200);
    expect(result).toEqual({ ok: true, status: 200, recordingId: "rec-1" });
  });

  it("rejects a bad signature", async () => {
    const rawBody = JSON.stringify({
      jobId: "rec-1:compress",
      status: "failed",
    });
    mockReadRawBody.mockResolvedValue(rawBody);
    mockGetRequestHeader.mockImplementation((_event, name) => {
      if (name === MEDIA_WORKER_TIMESTAMP_HEADER) {
        return Math.floor(Date.now() / 1000).toString();
      }
      if (name === MEDIA_WORKER_SIGNATURE_HEADER) return "v1=bad";
      return undefined;
    });

    const result = await handler({} as any);

    expect(mockApplyMediaWorkerCallback).not.toHaveBeenCalled();
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 401);
    expect(result).toEqual({
      ok: false,
      error: "Invalid media worker signature",
    });
  });

  it("rejects stale signed callbacks", async () => {
    const rawBody = JSON.stringify({
      jobId: "rec-1:compress",
      status: "failed",
    });
    const headers = signMediaWorkerPayload({
      rawBody,
      secret: "worker-secret",
      timestamp: "2000",
    });
    mockReadRawBody.mockResolvedValue(rawBody);
    mockGetRequestHeader.mockImplementation((_event, name) => {
      if (name === MEDIA_WORKER_TIMESTAMP_HEADER) {
        return headers[MEDIA_WORKER_TIMESTAMP_HEADER];
      }
      if (name === MEDIA_WORKER_SIGNATURE_HEADER) {
        return headers[MEDIA_WORKER_SIGNATURE_HEADER];
      }
      return undefined;
    });

    const result = await handler({} as any);

    expect(mockApplyMediaWorkerCallback).not.toHaveBeenCalled();
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 401);
    expect(result).toEqual({
      ok: false,
      error: "Invalid media worker signature",
    });
  });

  it("returns not found for unknown job recordings", async () => {
    mockDbRows.length = 0;
    const rawBody = JSON.stringify({
      jobId: "missing:compress",
      status: "failed",
    });
    const headers = signedHeaders(rawBody);
    mockReadRawBody.mockResolvedValue(rawBody);
    mockGetRequestHeader.mockImplementation((_event, name) => {
      if (name === MEDIA_WORKER_TIMESTAMP_HEADER) {
        return headers[MEDIA_WORKER_TIMESTAMP_HEADER];
      }
      if (name === MEDIA_WORKER_SIGNATURE_HEADER) {
        return headers[MEDIA_WORKER_SIGNATURE_HEADER];
      }
      return undefined;
    });

    const result = await handler({} as any);

    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 404);
    expect(result).toEqual({ ok: false, error: "Recording not found" });
  });
});
