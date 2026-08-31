// @vitest-environment happy-dom

import { createAgentNativeWebMcpRegistration } from "@agent-native/core/client/webmcp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLIPS_WEBMCP_TOOL_NAMES } from "../../../shared/agent-context";
import { createClipAgentWebMcpActions } from "./clip-agent-webmcp";

function documentWithModelContext(modelContext: Record<string, unknown>) {
  return { modelContext } as unknown as Document;
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function contextPayload() {
  return {
    type: "agent-native.clip.context",
    clip: {
      id: "rec-1",
      title: "Demo",
      durationMs: 5000,
      status: "ready",
      agentReadiness: { state: "ready" },
    },
    apis: {
      frame: {
        method: "GET",
        urlTemplate: `${window.location.origin}/api/agent-frame.jpg?id=rec-1&agent_access=token&atMs={timestampMs}`,
      },
    },
    transcript: { status: "ready", language: "en", segmentCount: 2 },
    recommendedFrames: [{ atMs: 0, timestamp: "0:00", reason: "opening" }],
    instructions: ["Use the transcript and frames."],
  };
}

describe("Clip WebMCP tools", () => {
  const contextUrl = `${window.location.origin}/api/agent-context.json?id=rec-1&agent_access=token`;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/share/rec-1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers discoverable read-only tools and preserves scoped URLs", async () => {
    const registrations: Array<{ tool: any; options: any }> = [];
    const modelContext = {
      registerTool: vi.fn(async (tool, options) => {
        registrations.push({ tool, options });
      }),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: createClipAgentWebMcpActions({
        recordingId: "rec-1",
        agentContextUrl: contextUrl,
        recordingStatus: "ready",
      }),
    });

    await registration.start();

    expect(registrations.map(({ tool }) => tool.name)).toEqual([
      CLIPS_WEBMCP_TOOL_NAMES.context,
      CLIPS_WEBMCP_TOOL_NAMES.transcript,
      CLIPS_WEBMCP_TOOL_NAMES.frame,
    ]);
    expect(registrations[1]?.tool).toMatchObject({
      description: expect.stringMatching(/timestamped transcript/i),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
    });

    fetchMock.mockResolvedValueOnce(jsonResponse(contextPayload()));
    const contextResult = JSON.parse(
      await registrations[0].tool.execute(
        {},
        {
          signal: new AbortController().signal,
        },
      ),
    );
    expect(contextResult.apis.transcript.url).toBe(
      `${window.location.origin}/api/agent-transcript.json?id=rec-1&agent_access=token`,
    );
    expect(contextResult.recommendedFrames).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      contextUrl,
      expect.objectContaining({
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("pages timestamped transcripts without silently losing segments", async () => {
    const registrations: Array<{ tool: any }> = [];
    const modelContext = {
      registerTool: vi.fn(async (tool) => registrations.push({ tool })),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: createClipAgentWebMcpActions({
        recordingId: "rec-1",
        agentContextUrl: contextUrl,
        recordingStatus: "ready",
      }),
    });
    await registration.start();

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          type: "agent-native.clip.transcript",
          recording: { id: "rec-1", title: "Demo", status: "ready" },
          apis: {},
          transcript: {
            status: "ready",
            language: "en",
            fullText: "First. Second.",
            segmentCount: 3,
            returnedSegmentCount: 1,
            truncated: true,
            nextStartMs: 1001,
            segments: [{ startMs: 0, endMs: 1000, text: "First." }],
          },
          instructions: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          type: "agent-native.clip.transcript",
          recording: { id: "rec-1", title: "Demo", status: "ready" },
          apis: {},
          transcript: {
            status: "ready",
            language: "en",
            segmentCount: 3,
            returnedSegmentCount: 1,
            truncated: true,
            nextStartMs: 2001,
            segments: [{ startMs: 1000, endMs: 2000, text: "Second." }],
          },
          instructions: [],
        }),
      );

    const transcriptTool = registrations.find(
      ({ tool }) => tool.name === CLIPS_WEBMCP_TOOL_NAMES.transcript,
    )?.tool;
    const result = JSON.parse(
      await transcriptTool.execute(
        { maxSegments: 1 },
        { signal: new AbortController().signal },
      ),
    );

    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe("First.");
    expect(result.transcript).toMatchObject({
      segmentCount: 3,
      returnedSegmentCount: 1,
      truncated: true,
      fullTextIncluded: false,
    });
    expect(result.nextStartMs).toBe(1001);
    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/api/agent-transcript.json?id=rec-1&agent_access=token&maxSegments=1`,
      expect.any(Object),
    );

    const nextResult = JSON.parse(
      await transcriptTool.execute(
        { startMs: result.nextStartMs, maxSegments: 1 },
        { signal: new AbortController().signal },
      ),
    );
    expect(nextResult.segments[0].text).toBe("Second.");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${window.location.origin}/api/agent-transcript.json?id=rec-1&agent_access=token&maxSegments=1&startMs=1001`,
      expect.any(Object),
    );
  });

  it("keeps oversized transcript pages below the WebMCP result limit", async () => {
    const registrations: Array<{ tool: any }> = [];
    const modelContext = {
      registerTool: vi.fn(async (tool) => registrations.push({ tool })),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: createClipAgentWebMcpActions({
        recordingId: "rec-1",
        agentContextUrl: contextUrl,
        recordingStatus: "ready",
      }),
    });
    await registration.start();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        type: "agent-native.clip.transcript",
        recording: { id: "rec-1", title: "Demo", status: "ready" },
        apis: {},
        transcript: {
          status: "ready",
          language: "en",
          segmentCount: 50,
          returnedSegmentCount: 50,
          truncated: true,
          nextStartMs: 50_001,
          segments: Array.from({ length: 50 }, (_, index) => ({
            startMs: index * 1000,
            endMs: index * 1000 + 999,
            text: "x".repeat(4000),
          })),
        },
        instructions: [],
      }),
    );

    const transcriptTool = registrations.find(
      ({ tool }) => tool.name === CLIPS_WEBMCP_TOOL_NAMES.transcript,
    )?.tool;
    const result = JSON.parse(
      await transcriptTool.execute(
        {},
        { signal: new AbortController().signal },
      ),
    );

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(50_000);
    expect(result.transcript.truncated).toBe(true);
    expect(result.nextStartMs).toBeGreaterThan(0);
    expect(result.segments.length).toBeLessThan(50);
  });

  it("returns an authenticated image URL and leaves stale-duration recovery to the API", async () => {
    const registrations: Array<{ tool: any }> = [];
    const modelContext = {
      registerTool: vi.fn(async (tool) => registrations.push({ tool })),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: createClipAgentWebMcpActions({
        recordingId: "rec-1",
        agentContextUrl: contextUrl,
        recordingStatus: "ready",
      }),
    });
    await registration.start();

    fetchMock.mockResolvedValueOnce(jsonResponse(contextPayload()));
    const frameTool = registrations.find(
      ({ tool }) => tool.name === CLIPS_WEBMCP_TOOL_NAMES.frame,
    )?.tool;
    const result = JSON.parse(
      await frameTool.execute(
        { atMs: 9000 },
        { signal: new AbortController().signal },
      ),
    );

    expect(result).toMatchObject({
      type: "image",
      atMs: 9000,
      timestamp: "0:09",
      mimeType: "image/jpeg",
      imageUrl: `${window.location.origin}/api/agent-frame.jpg?id=rec-1&agent_access=token&atMs=9000`,
    });
  });

  it("does not advertise frame extraction before a clip is ready", async () => {
    const modelContext = {
      registerTool: vi.fn(async () => {}),
      getTools: vi.fn(async () => []),
      executeTool: vi.fn(async () => ""),
    };
    const registration = createAgentNativeWebMcpRegistration({
      document: documentWithModelContext(modelContext),
      actions: createClipAgentWebMcpActions({
        recordingId: "rec-1",
        agentContextUrl: contextUrl,
        recordingStatus: "processing",
      }),
    });

    await registration.start();

    expect(modelContext.registerTool).toHaveBeenCalledTimes(2);
  });
});
