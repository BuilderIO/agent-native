// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRealtimeVoiceGreetingEvent,
  createRealtimeVoiceGreetingStarter,
  createRealtimeVoicePreferenceUpdate,
  createRealtimeVoiceSession,
  createRealtimeVoiceTranscriptSequencer,
  createRealtimeVoiceConnectionTimeout,
  createRealtimeVoiceConnectionGate,
  createRealtimeVoiceAudioConstraints,
  executeRealtimeVoiceTool,
  extractCompletedRealtimeVoiceTranscript,
  extractRealtimeVoiceFunctionCalls,
  isRealtimeVoiceAbortError,
  isRealtimeVoiceSetupRequiredError,
  listenForRealtimeVoicePageHide,
  normalizeRealtimeVoicePreferences,
  REALTIME_VOICE_AUDIO_CONSTRAINTS,
  realtimeVoiceReasoningEffort,
  resolveRealtimeVoiceLanguage,
  shouldRestoreRealtimeVoiceTranscriptThread,
} from "./useRealtimeVoiceMode.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Realtime voice client transport", () => {
  it("normalizes persisted preferences and resolves Auto from the browser language", () => {
    expect(
      normalizeRealtimeVoicePreferences({
        language: "en",
        intelligence: "deep",
        voice: "cedar",
      }),
    ).toEqual({ language: "en", intelligence: "deep", voice: "cedar" });
    expect(
      normalizeRealtimeVoicePreferences({
        language: "xx",
        intelligence: "maximum",
        voice: "unknown",
      }),
    ).toEqual({ language: "auto", intelligence: "instant", voice: "marin" });
    expect(resolveRealtimeVoiceLanguage("auto", ["en-US", "fr"])).toBe("en");
    expect(resolveRealtimeVoiceLanguage("auto", ["nl-NL"])).toBe("en");
  });

  it("maps inline intelligence and language controls to a safe session update", () => {
    expect(realtimeVoiceReasoningEffort("instant")).toBe("minimal");
    expect(realtimeVoiceReasoningEffort("balanced")).toBe("low");
    expect(realtimeVoiceReasoningEffort("deep")).toBe("medium");
    expect(
      createRealtimeVoicePreferenceUpdate(
        { language: "auto", intelligence: "balanced", voice: "cedar" },
        { browserLanguages: ["en-US"], includeVoice: true },
      ),
    ).toEqual({
      type: "session.update",
      session: {
        type: "realtime",
        reasoning: { effort: "low" },
        audio: {
          input: {
            transcription: {
              model: "gpt-4o-mini-transcribe",
              language: "en",
            },
          },
          output: { voice: "cedar" },
        },
      },
    });
  });

  it("prefers the browser and OS default microphone without requiring it", () => {
    expect(REALTIME_VOICE_AUDIO_CONSTRAINTS).toEqual(
      expect.objectContaining({
        deviceId: { ideal: "default" },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }),
    );
    expect(createRealtimeVoiceAudioConstraints("studio", true)).toEqual(
      expect.objectContaining({ deviceId: { exact: "studio" } }),
    );
    expect(createRealtimeVoiceAudioConstraints("studio")).toEqual(
      expect.objectContaining({ deviceId: { ideal: "studio" } }),
    );
  });

  it("times out a connection attempt and supports idempotent cancellation", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const cancelFirst = createRealtimeVoiceConnectionTimeout(onTimeout, 1_000);

    cancelFirst();
    cancelFirst();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).not.toHaveBeenCalled();

    const cancelSecond = createRealtimeVoiceConnectionTimeout(onTimeout, 1_000);

    vi.advanceTimersByTime(999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();

    cancelSecond();
    vi.useRealTimers();
  });

  it("keeps the handshake deadline armed until session.created", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const transportOnly = createRealtimeVoiceConnectionGate(onTimeout, 1_000);

    transportOnly.markTransportReady();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenCalledOnce();

    const liveSession = createRealtimeVoiceConnectionGate(onTimeout, 1_000);
    liveSession.markTransportReady();
    liveSession.markSessionCreated();
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("recognizes abort-like DOM errors without relying on Error identity", () => {
    expect(
      isRealtimeVoiceAbortError(
        new DOMException("The operation was aborted", "AbortError"),
      ),
    ).toBe(true);
    expect(isRealtimeVoiceAbortError({ name: "AbortError" })).toBe(true);
    expect(isRealtimeVoiceAbortError(new Error("signal was aborted"))).toBe(
      false,
    );
  });

  it("cleans up realtime transport when the page is hidden", () => {
    const cleanup = vi.fn();
    const stopListening = listenForRealtimeVoicePageHide(cleanup);

    window.dispatchEvent(new Event("pagehide"));
    expect(cleanup).toHaveBeenCalledOnce();

    stopListening();
    window.dispatchEvent(new Event("pagehide"));
    expect(cleanup).toHaveBeenCalledOnce();
  });

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
      createRealtimeVoiceSession("offer-sdp", {
        browserTabId: "tab-1",
        preferences: {
          language: "auto",
          intelligence: "instant",
          voice: "marin",
        },
        browserLanguages: ["en-US"],
      }),
    ).resolves.toBe("answer-sdp");
    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/realtime-voice/session",
      expect.objectContaining({
        method: "POST",
        body: "offer-sdp",
        headers: {
          "Content-Type": "application/sdp",
          "X-Agent-Native-Browser-Tab": "tab-1",
          "X-Agent-Native-Realtime-Language": "en",
          "X-Agent-Native-Realtime-Intelligence": "instant",
          "X-Agent-Native-Realtime-Voice": "marin",
        },
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "OPENAI_API_KEY",
    );
  });

  it("sends function calls to the authenticated Agent Native tool bridge", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        callId: "call-1",
        status: "completed",
        output: '{"ok":true}',
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

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
    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/realtime-voice/tool",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Agent-Native-Browser-Tab": "tab-1",
        }),
        body: JSON.stringify({
          name: "navigate",
          args: { path: "/inbox" },
          callId: "call-1",
          sessionId: "session-1",
          browserTabId: "tab-1",
        }),
      }),
    );
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

describe("Realtime voice startup and transcript ordering", () => {
  it("requests one brief uncapped greeting when the live session starts", () => {
    expect(createRealtimeVoiceGreetingEvent()).toEqual({
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        instructions:
          'Say exactly: "How can I help you?" Do not add anything else.',
      },
    });
  });

  it("starts the greeting exactly once across duplicate session lifecycle events", () => {
    const send = vi.fn();
    const greeting = createRealtimeVoiceGreetingStarter(send);

    expect(greeting.start()).toBe(true);
    expect(greeting.start()).toBe(false);
    expect(send).toHaveBeenCalledOnce();

    greeting.reset();
    expect(greeting.start()).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("publishes in conversation order when user ASR finishes after the assistant", () => {
    const published: Array<{ role: string; text: string }> = [];
    const sequencer = createRealtimeVoiceTranscriptSequencer((transcript) => {
      published.push(transcript);
    });

    sequencer.handle({
      type: "conversation.item.added",
      item: { id: "user-1", type: "message", role: "user" },
    });
    sequencer.handle({
      type: "conversation.item.added",
      item: { id: "assistant-1", type: "message", role: "assistant" },
    });
    sequencer.handle({
      type: "response.output_audio_transcript.done",
      item_id: "assistant-1",
      response_id: "response-1",
      transcript: "I can help with that.",
    });

    expect(published).toEqual([]);

    sequencer.handle({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "user-1",
      transcript: "Can you help me?",
    });

    expect(published).toEqual([
      expect.objectContaining({ role: "user", text: "Can you help me?" }),
      expect.objectContaining({
        role: "assistant",
        text: "I can help with that.",
      }),
    ]);
  });

  it("does not deadlock later turns when input transcription fails", () => {
    const published: Array<{ role: string; text: string }> = [];
    const sequencer = createRealtimeVoiceTranscriptSequencer((transcript) => {
      published.push(transcript);
    });

    sequencer.handle({
      type: "conversation.item.created",
      item: { id: "user-1", type: "message", role: "user" },
    });
    sequencer.handle({
      type: "conversation.item.created",
      item: { id: "assistant-1", type: "message", role: "assistant" },
    });
    sequencer.handle({
      type: "response.output_audio_transcript.done",
      item_id: "assistant-1",
      transcript: "Still here.",
    });
    sequencer.handle({
      type: "conversation.item.input_audio_transcription.failed",
      item_id: "user-1",
    });

    expect(published).toEqual([
      expect.objectContaining({ role: "assistant", text: "Still here." }),
    ]);
  });

  it("matches legacy completions without item_id to a reserved role slot", () => {
    const published: Array<{ role: string; text: string }> = [];
    const sequencer = createRealtimeVoiceTranscriptSequencer((transcript) => {
      published.push(transcript);
    });

    sequencer.handle({
      type: "conversation.item.added",
      item: { id: "user-1", type: "message", role: "user" },
    });
    sequencer.handle({
      type: "conversation.item.added",
      item: { id: "assistant-1", type: "message", role: "assistant" },
    });
    sequencer.handle({
      type: "response.output_audio_transcript.done",
      response_id: "response-1",
      transcript: "First answer.",
    });
    sequencer.handle({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "user-1",
      transcript: "First question.",
    });
    sequencer.handle({
      type: "conversation.item.added",
      item: { id: "assistant-2", type: "message", role: "assistant" },
    });
    sequencer.handle({
      type: "response.output_audio_transcript.done",
      item_id: "assistant-2",
      transcript: "Second answer.",
    });

    expect(published.map(({ text }) => text)).toEqual([
      "First question.",
      "First answer.",
      "Second answer.",
    ]);
  });

  it("ignores duplicate completion events and releases interrupted output", () => {
    const published: Array<{ role: string; text: string }> = [];
    const sequencer = createRealtimeVoiceTranscriptSequencer((transcript) => {
      published.push(transcript);
    });

    sequencer.handle({
      type: "conversation.item.added",
      item: { id: "assistant-1", type: "message", role: "assistant" },
    });
    const completed = {
      type: "response.output_audio_transcript.done",
      item_id: "assistant-1",
      transcript: "Only once.",
    };
    sequencer.handle(completed);
    sequencer.handle(completed);
    sequencer.handle({
      type: "conversation.item.added",
      item: { id: "assistant-interrupted", type: "message", role: "assistant" },
    });
    sequencer.handle({
      type: "response.done",
      response: {
        status: "cancelled",
        output: [{ id: "assistant-interrupted", type: "message" }],
      },
    });
    sequencer.handle({
      type: "conversation.item.added",
      item: { id: "assistant-2", type: "message", role: "assistant" },
    });
    sequencer.handle({
      type: "response.output_audio_transcript.done",
      item_id: "assistant-2",
      transcript: "After interruption.",
    });

    expect(published.map(({ text }) => text)).toEqual([
      "Only once.",
      "After interruption.",
    ]);
  });
});

describe("shouldRestoreRealtimeVoiceTranscriptThread", () => {
  it("restores the captured transcript when it remains active or chat has no active thread", () => {
    expect(
      shouldRestoreRealtimeVoiceTranscriptThread(
        "voice-thread",
        "voice-thread",
      ),
    ).toBe(true);
    expect(
      shouldRestoreRealtimeVoiceTranscriptThread("voice-thread", undefined),
    ).toBe(true);
  });

  it("does not restore over a thread selected while voice mode was active", () => {
    expect(
      shouldRestoreRealtimeVoiceTranscriptThread(
        "voice-thread",
        "other-thread",
      ),
    ).toBe(false);
    expect(
      shouldRestoreRealtimeVoiceTranscriptThread(undefined, "other-thread"),
    ).toBe(false);
  });

  it("recognizes the authoritative missing-provider response", () => {
    expect(isRealtimeVoiceSetupRequiredError({ status: 409 })).toBe(true);
    expect(isRealtimeVoiceSetupRequiredError({ status: 400 })).toBe(false);
    expect(isRealtimeVoiceSetupRequiredError(new Error("offline"))).toBe(false);
  });
});
