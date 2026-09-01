import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetQuery = vi.hoisted(() => vi.fn());
const mockSetResponseStatus = vi.hoisted(() => vi.fn());
const mockLoadPublicAgentAccess = vi.hoisted(() => vi.fn());
const mockLoadAgentTranscript = vi.hoisted(() => vi.fn());

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => mockGetQuery(...args),
  getRequestURL: () =>
    new URL("https://clips.example.com/api/agent-transcript.json"),
  setResponseStatus: (...args: unknown[]) => mockSetResponseStatus(...args),
}));

vi.mock("../../lib/public-agent-context.js", () => ({
  applyAgentJsonHeaders: vi.fn(),
  getServerAppBasePath: () => "",
  loadAgentTranscript: (...args: unknown[]) => mockLoadAgentTranscript(...args),
  loadPublicAgentAccess: (...args: unknown[]) =>
    mockLoadPublicAgentAccess(...args),
  queryString: (value: unknown) =>
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
        ? value[0]
        : "",
  transcriptStatusInstructions: () => [],
  CLIPS_AGENT_ACCESS_PARAM: "agent_access",
}));

import handler from "./agent-transcript.json.get";

const segments = [
  {
    startMs: 0,
    endMs: 1000,
    timestamp: "0:00",
    range: "0:00-0:01",
    text: "First.",
  },
  {
    startMs: 1000,
    endMs: 2000,
    timestamp: "0:01",
    range: "0:01-0:02",
    text: "Second.",
  },
  {
    startMs: 2000,
    endMs: 3000,
    timestamp: "0:02",
    range: "0:02-0:03",
    text: "Third.",
  },
];

describe("/api/agent-transcript route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetQuery.mockReturnValue({ id: "rec-1" });
    mockLoadPublicAgentAccess.mockResolvedValue({
      ok: true,
      access: {
        recording: {
          id: "rec-1",
          title: "Demo",
          durationMs: 3000,
          status: "ready",
        },
        apiToken: null,
      },
    });
    mockLoadAgentTranscript.mockResolvedValue({
      transcript: {
        status: "ready",
        language: "en",
        fullText: "First. Second. Third.",
        failureReason: null,
      },
      agentSegments: segments,
    });
  });

  it("keeps the complete legacy response when no paging parameters are supplied", async () => {
    const result = await handler({} as any);

    expect(result.transcript).toMatchObject({
      fullText: "First. Second. Third.",
      segments,
      segmentCount: 3,
    });
    expect(result.transcript).not.toHaveProperty("truncated");
    expect(result).toMatchObject({
      instructions: expect.arrayContaining([
        expect.stringContaining(
          "Use this HTTP transcript endpoint directly; it works without a browser and is the complete transcript path.",
        ),
      ]),
    });
  });

  it("pages adjacent segments with an exclusive continuation cursor", async () => {
    mockGetQuery.mockReturnValue({ id: "rec-1", maxSegments: "1" });
    const first = await handler({} as any);

    expect(first.transcript).toMatchObject({
      segmentCount: 3,
      returnedSegmentCount: 1,
      truncated: true,
      segments: [{ ...segments[0], segmentIndex: 0 }],
      nextStartIndex: 1,
      nextStartMs: 1001,
    });
    expect(first.transcript).not.toHaveProperty("fullText");

    mockGetQuery.mockReturnValue({
      id: "rec-1",
      startMs: "1001",
      maxSegments: "1",
    });
    const second = await handler({} as any);

    expect(second.transcript).toMatchObject({
      segments: [{ ...segments[1], segmentIndex: 1 }],
      nextStartIndex: 2,
      nextStartMs: 2001,
    });
  });

  it("uses the stable segment index when transcript intervals overlap", async () => {
    const overlappingSegments = [
      { ...segments[0], endMs: 1500 },
      { ...segments[1], startMs: 500, endMs: 1200 },
      segments[2],
    ];
    mockLoadAgentTranscript.mockResolvedValue({
      transcript: {
        status: "ready",
        language: "en",
        fullText: "First. Second. Third.",
        failureReason: null,
      },
      agentSegments: overlappingSegments,
    });

    mockGetQuery.mockReturnValue({ id: "rec-1", maxSegments: "1" });
    const first = await handler({} as any);

    expect(first.transcript).toMatchObject({
      segments: [{ ...overlappingSegments[0], segmentIndex: 0 }],
      nextStartIndex: 1,
    });

    mockGetQuery.mockReturnValue({
      id: "rec-1",
      startIndex: "1",
      maxSegments: "1",
    });
    const second = await handler({} as any);

    expect(second.transcript).toMatchObject({
      segments: [{ ...overlappingSegments[1], segmentIndex: 1 }],
      nextStartIndex: 2,
    });
  });

  it("rejects invalid paging parameters after access is verified", async () => {
    mockGetQuery.mockReturnValue({ id: "rec-1", maxSegments: "0" });

    await expect(handler({} as any)).resolves.toEqual({
      error: "Transcript query maxSegments must be an integer from 1 to 50",
    });
    expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 400);
  });
});
