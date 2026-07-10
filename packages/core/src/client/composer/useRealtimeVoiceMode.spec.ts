// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRealtimeVoiceSession,
  executeRealtimeVoiceTool,
  extractCompletedRealtimeVoiceTranscript,
  extractRealtimeVoiceFunctionCalls,
} from "./useRealtimeVoiceMode.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Realtime voice client transport", () => {
  it("creates a same-origin SDP session without exposing a provider key", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("answer-sdp", {
          status: 200,
          headers: { "Content-Type": "application/sdp" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createRealtimeVoiceSession("offer-sdp", { browserTabId: "tab-1" }),
    ).resolves.toBe("answer-sdp");
    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/realtime-voice/session",
      expect.objectContaining({
        method: "POST",
        body: "offer-sdp",
        headers: {
          "Content-Type": "application/sdp",
          "X-Agent-Native-Browser-Tab": "tab-1",
        },
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "OPENAI_API_KEY",
    );
  });

  it("sends function calls to the authenticated Agent Native tool bridge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          callId: "call-1",
          status: "completed",
          output: '{"ok":true}',
        }),
      ),
    );

    await expect(
      executeRealtimeVoiceTool({
        name: "navigate",
        args: { path: "/inbox" },
        callId: "call-1",
        sessionId: "session-1",
        browserTabId: "tab-1",
      }),
    ).resolves.toEqual({
      callId: "call-1",
      status: "completed",
      output: '{"ok":true}',
    });
  });
});

describe("extractRealtimeVoiceFunctionCalls", () => {
  it("uses the low-latency completed-arguments event", () => {
    expect(
      extractRealtimeVoiceFunctionCalls({
        type: "response.function_call_arguments.done",
        name: "navigate",
        call_id: "call-1",
        arguments: '{"path":"/inbox"}',
      }),
    ).toEqual([
      {
        name: "navigate",
        callId: "call-1",
        argumentsText: '{"path":"/inbox"}',
      },
    ]);
  });

  it("falls back to completed function items on response.done", () => {
    expect(
      extractRealtimeVoiceFunctionCalls({
        type: "response.done",
        response: {
          output: [
            { type: "message", role: "assistant" },
            {
              type: "function_call",
              name: "view-screen",
              call_id: "call-2",
              arguments: "{}",
            },
          ],
        },
      }),
    ).toEqual([
      {
        name: "view-screen",
        callId: "call-2",
        argumentsText: "{}",
      },
    ]);
  });
});

describe("extractCompletedRealtimeVoiceTranscript", () => {
  it("accepts completed user and assistant transcripts with stable provider ids", () => {
    expect(
      extractCompletedRealtimeVoiceTranscript({
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "  Find the latest report.  ",
        item_id: "item-1",
      }),
    ).toEqual({
      role: "user",
      text: "Find the latest report.",
      providerId: "item-1",
    });

    expect(
      extractCompletedRealtimeVoiceTranscript({
        type: "response.output_audio_transcript.done",
        transcript: "I found it.",
        response_id: "response-1",
      }),
    ).toEqual({
      role: "assistant",
      text: "I found it.",
      providerId: "response-1",
    });
  });

  it("ignores transcript deltas, unrelated events, and empty completed text", () => {
    expect(
      extractCompletedRealtimeVoiceTranscript({
        type: "response.output_audio_transcript.delta",
        transcript: "partial",
      }),
    ).toBeNull();
    expect(
      extractCompletedRealtimeVoiceTranscript({
        type: "response.output_audio_transcript.done",
        transcript: "   ",
      }),
    ).toBeNull();
  });
});
