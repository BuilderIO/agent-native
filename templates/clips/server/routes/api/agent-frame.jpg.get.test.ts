import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetQuery = vi.hoisted(() => vi.fn());
const mockSetResponseHeader = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockLoadPublicAgentAccess = vi.hoisted(() => vi.fn());
const mockLoadRecordingMediaBytes = vi.hoisted(() => vi.fn());
const mockExtractJpegFrame = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../lib/public-agent-context.js", () => ({
  loadPublicAgentAccess: (...args: unknown[]) =>
    mockLoadPublicAgentAccess(...args),
  loadRecordingMediaBytes: (...args: unknown[]) =>
    mockLoadRecordingMediaBytes(...args),
  RecordingMediaFetchError: class RecordingMediaFetchError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 502) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  queryString: (value: unknown) => {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    return "";
  },
}));

vi.mock("../../lib/video-frame.js", () => ({
  extractJpegFrame: (...args: unknown[]) => mockExtractJpegFrame(...args),
  VideoFrameExtractionError: class VideoFrameExtractionError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  },
}));

import handler from "./agent-frame.jpg.get";
import { RecordingMediaFetchError } from "../../lib/public-agent-context.js";

function makeAccess(overrides: Record<string, unknown> = {}) {
  const { recording: recordingOverrides, ...accessOverrides } = overrides;
  return {
    recording: {
      id: "rec-1",
      visibility: "public",
      password: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 10_000,
      ...((recordingOverrides as Record<string, unknown> | undefined) ?? {}),
    },
    viewerIsOwner: false,
    apiToken: null,
    ...accessOverrides,
  };
}

function makeEvent(query: Record<string, string>) {
  return {
    query,
    headers: new Map<string, string>(),
    status: 200,
  };
}

function headerValue(event: ReturnType<typeof makeEvent>, name: string) {
  return event.headers.get(name.toLowerCase());
}

describe("agent-frame.jpg route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuery.mockImplementation((event) => event.query);
    mockSetResponseHeader.mockImplementation((event, name, value) => {
      event.headers.set(String(name).toLowerCase(), String(value));
    });
    mockSetResponseStatus.mockImplementation((event, status) => {
      event.status = status;
    });
    mockLoadPublicAgentAccess.mockResolvedValue({
      ok: true,
      access: makeAccess(),
    });
    mockLoadRecordingMediaBytes.mockResolvedValue({
      bytes: new Uint8Array([9, 9, 9]),
      mimeType: "video/webm",
    });
    mockExtractJpegFrame.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("caches anonymous public frames and marks them publicly cacheable", async () => {
    mockLoadPublicAgentAccess.mockResolvedValue({
      ok: true,
      access: makeAccess({
        recording: { id: "public-cacheable" },
      }),
    });

    const firstEvent = makeEvent({ id: "public-cacheable", atMs: "1000" });
    const secondEvent = makeEvent({ id: "public-cacheable", atMs: "1000" });

    const first = await handler(firstEvent as any);
    const second = await handler(secondEvent as any);

    expect(Buffer.from(first as Buffer)).toEqual(Buffer.from([1, 2, 3]));
    expect(Buffer.from(second as Buffer)).toEqual(Buffer.from([1, 2, 3]));
    expect(mockLoadRecordingMediaBytes).toHaveBeenCalledTimes(1);
    expect(mockExtractJpegFrame).toHaveBeenCalledTimes(1);
    expect(headerValue(firstEvent, "Cache-Control")).toBe(
      "public, max-age=300",
    );
    expect(headerValue(secondEvent, "Cache-Control")).toBe(
      "public, max-age=300",
    );
  });

  it("does not cache owner/private frames when no token is present", async () => {
    mockLoadPublicAgentAccess.mockResolvedValue({
      ok: true,
      access: makeAccess({
        recording: {
          id: "private-owner",
          visibility: "private",
        },
        viewerIsOwner: true,
        apiToken: null,
      }),
    });

    const firstEvent = makeEvent({ id: "private-owner", atMs: "1000" });
    const secondEvent = makeEvent({ id: "private-owner", atMs: "1000" });

    await handler(firstEvent as any);
    await handler(secondEvent as any);

    expect(mockLoadRecordingMediaBytes).toHaveBeenCalledTimes(2);
    expect(mockExtractJpegFrame).toHaveBeenCalledTimes(2);
    expect(headerValue(firstEvent, "Cache-Control")).toBe(
      "private, max-age=0, no-store",
    );
  });

  it("does not cache tokenized public frames", async () => {
    mockLoadPublicAgentAccess.mockResolvedValue({
      ok: true,
      access: makeAccess({
        recording: { id: "tokenized-public" },
        apiToken: "token",
      }),
    });

    await handler(makeEvent({ id: "tokenized-public", atMs: "1000" }) as any);
    await handler(makeEvent({ id: "tokenized-public", atMs: "1000" }) as any);

    expect(mockLoadRecordingMediaBytes).toHaveBeenCalledTimes(2);
    expect(mockExtractJpegFrame).toHaveBeenCalledTimes(2);
  });

  it("returns media fetch status when recording bytes cannot be loaded", async () => {
    mockLoadRecordingMediaBytes.mockRejectedValue(
      new RecordingMediaFetchError(
        "Recording media could not be fetched.",
        502,
      ),
    );

    const event = makeEvent({ id: "rec-1", atMs: "1000" });
    const result = await handler(event as any);

    expect(event.status).toBe(502);
    expect(result).toEqual({
      error: "Recording media could not be fetched.",
    });
    expect(mockExtractJpegFrame).not.toHaveBeenCalled();
  });
});
