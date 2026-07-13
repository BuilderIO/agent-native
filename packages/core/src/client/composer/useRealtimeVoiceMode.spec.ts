// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRealtimeVoiceGreetingEvent,
  createRealtimeVoiceGreetingStarter,
  createRealtimeVoicePreferenceUpdate,
  createRealtimeVoiceSession,
  createRealtimeVoiceSessionWithCapability,
  createRealtimeVoiceTranscriptSequencer,
  createRealtimeVoiceConnectionTimeout,
  createRealtimeVoiceConnectionGate,
  createRealtimeVoiceAudioConstraints,
  createRealtimeVoiceToolManifestCoordinator,
  executeRealtimeVoiceTool,
  extractCompletedRealtimeVoiceTranscript,
  extractRealtimeVoiceFunctionCalls,
  extractRealtimeVoiceSessionTools,
  isRealtimeVoiceAbortError,
  isRealtimeVoiceSetupRequiredError,
  listenForRealtimeVoicePageHide,
  mergeRealtimeVoiceToolManifest,
  normalizeRealtimeVoicePreferences,
  REALTIME_VOICE_AUDIO_CONSTRAINTS,
  replaceRealtimeVoiceMicrophone,
  realtimeVoiceReasoningEffort,
  resolveRealtimeVoiceLanguage,
  shouldRestoreRealtimeVoiceTranscriptThread,
} from "./useRealtimeVoiceMode.js";
import type { RealtimeVoiceFunctionTool } from "./useRealtimeVoiceMode.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function realtimeTool(name: string): RealtimeVoiceFunctionTool {
  return {
    type: "function",
    name,
    description: `Call ${name}`,
    parameters: { type: "object", properties: {} },
  };
}

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

  it("replaces the live microphone before stopping the previous track", async () => {
    const events: string[] = [];
    const oldTrack = {
      kind: "audio",
      onended: vi.fn(),
      stop: vi.fn(() => events.push("old-stopped")),
    };
    const replacementTrack = { kind: "audio", stop: vi.fn() };
    const replacementStream = {
      getAudioTracks: () => [replacementTrack],
      getTracks: () => [replacementTrack],
    };
    const sender = {
      track: oldTrack,
      replaceTrack: vi.fn(async () => {
        events.push("replaced");
      }),
    };

    await expect(
      replaceRealtimeVoiceMicrophone({
        mediaDevices: {
          getUserMedia: vi.fn(async () => replacementStream),
        } as unknown as Pick<MediaDevices, "getUserMedia">,
        peer: {
          getSenders: () => [sender],
        } as unknown as Pick<RTCPeerConnection, "getSenders">,
        currentStream: {
          getTracks: () => [oldTrack],
        } as unknown as MediaStream,
        deviceId: "studio",
      }),
    ).resolves.toBe(replacementStream);

    expect(events).toEqual(["replaced", "old-stopped"]);
    expect(oldTrack.onended).toBeNull();
    expect(replacementTrack.stop).not.toHaveBeenCalled();
  });

  it("keeps the current microphone when replacing its track fails", async () => {
    const oldTrack = { kind: "audio", stop: vi.fn() };
    const replacementTrack = { kind: "audio", stop: vi.fn() };
    const replacementStream = {
      getAudioTracks: () => [replacementTrack],
      getTracks: () => [replacementTrack],
    };

    await expect(
      replaceRealtimeVoiceMicrophone({
        mediaDevices: {
          getUserMedia: vi.fn(async () => replacementStream),
        } as unknown as Pick<MediaDevices, "getUserMedia">,
        peer: {
          getSenders: () => [
            {
              track: oldTrack,
              replaceTrack: vi.fn(async () => {
                throw new Error("replace failed");
              }),
            },
          ],
        } as unknown as Pick<RTCPeerConnection, "getSenders">,
        currentStream: {
          getTracks: () => [oldTrack],
        } as unknown as MediaStream,
        deviceId: "studio",
      }),
    ).rejects.toThrow("replace failed");

    expect(oldTrack.stop).not.toHaveBeenCalled();
    expect(replacementTrack.stop).toHaveBeenCalledOnce();
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
          headers: {
            "Content-Type": "application/sdp",
            "X-Agent-Native-Realtime-Capability": "capability-1",
          },
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
    await expect(
      createRealtimeVoiceSessionWithCapability("offer-sdp"),
    ).resolves.toEqual({
      sdp: "answer-sdp",
      capability: "capability-1",
    });
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
        capability: "capability-1",
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
          "X-Agent-Native-Realtime-Capability": "capability-1",
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

describe("Realtime voice dynamic tool manifests", () => {
  it("reads full tool manifests from session lifecycle events", () => {
    const tools = [realtimeTool("navigate"), realtimeTool("tool-search")];
    expect(
      extractRealtimeVoiceSessionTools({
        type: "session.created",
        session: { id: "session-1", tools },
      }),
    ).toEqual(tools);
    expect(
      extractRealtimeVoiceSessionTools({
        type: "session.updated",
        session: { tools },
      }),
    ).toEqual(tools);
    expect(
      extractRealtimeVoiceSessionTools({
        type: "response.done",
        response: {},
      }),
    ).toBeNull();
  });

  it("keeps pinned tools and newest discoveries when the manifest is full", () => {
    const pinned = [
      "navigate",
      "set-url-path",
      "set-search-params",
      "view-screen",
      "tool-search",
    ].map(realtimeTool);
    const current = [
      ...pinned,
      ...Array.from({ length: 27 }, (_, index) => realtimeTool(`old-${index}`)),
    ];

    const merged = mergeRealtimeVoiceToolManifest(current, [
      realtimeTool("open-dashboard"),
      realtimeTool("list-dashboards"),
    ]);
    const names = merged.map((tool) => tool.name);

    expect(merged).toHaveLength(32);
    expect(names.slice(0, 5)).toEqual(pinned.map((tool) => tool.name));
    expect(names).toContain("open-dashboard");
    expect(names).toContain("list-dashboards");
    expect(names).not.toContain("old-26");
  });

  it("packs dynamic schemas within the realtime session byte budget", () => {
    const largeTool = (name: string): RealtimeVoiceFunctionTool => ({
      ...realtimeTool(name),
      description: "x".repeat(25_000),
    });

    const merged = mergeRealtimeVoiceToolManifest(
      [],
      [largeTool("large-1"), largeTool("large-2"), largeTool("large-3")],
    );

    expect(merged.map((tool) => tool.name)).toEqual(["large-1", "large-2"]);
  });

  it("waits for session.updated before exposing discovered tools to the model", () => {
    const sent: Record<string, unknown>[] = [];
    const coordinator = createRealtimeVoiceToolManifestCoordinator((event) =>
      sent.push(event),
    );
    coordinator.setSessionTools([
      realtimeTool("navigate"),
      realtimeTool("tool-search"),
    ]);
    coordinator.enqueue({
      callId: "call-search",
      status: "completed",
      output: '{"matches":["open-dashboard"]}',
      expandedTools: [realtimeTool("open-dashboard")],
    });

    expect(sent.map((event) => event.type)).toEqual(["session.update"]);
    expect(sent[0]?.event_id).toBe("realtime_tool_manifest_1");
    const updateTools = (
      sent[0]?.session as { tools: RealtimeVoiceFunctionTool[] }
    ).tools;
    coordinator.setSessionTools([realtimeTool("navigate")]);
    expect(sent.map((event) => event.type)).toEqual(["session.update"]);

    coordinator.setSessionTools(updateTools);
    expect(sent.map((event) => event.type)).toEqual([
      "session.update",
      "conversation.item.create",
      "response.create",
    ]);
    const output = JSON.parse(
      String(
        (sent[1]?.item as { output?: unknown } | undefined)?.output ?? "{}",
      ),
    ) as Record<string, unknown>;
    expect(output.output).toBe('{"matches":["open-dashboard"]}');
    expect(output).not.toHaveProperty("expandedTools");
  });

  it("handles a rejected manifest update without failing the voice session", () => {
    const sent: Record<string, unknown>[] = [];
    const coordinator = createRealtimeVoiceToolManifestCoordinator((event) =>
      sent.push(event),
    );
    coordinator.setSessionTools([realtimeTool("tool-search")]);
    coordinator.enqueue({
      callId: "call-search",
      status: "completed",
      output: "Found open-dashboard",
      expandedTools: [realtimeTool("open-dashboard")],
    });

    expect(
      coordinator.handleError(
        "realtime_tool_manifest_1",
        "Invalid session tools",
      ),
    ).toBe(true);
    expect(sent.map((event) => event.type)).toEqual([
      "session.update",
      "conversation.item.create",
      "response.create",
    ]);
    const failure = JSON.parse(
      String((sent[1]?.item as { output: string }).output),
    ) as Record<string, unknown>;
    expect(failure.status).toBe("failed");
    expect(failure.output).toContain("Invalid session tools");
    expect(failure.output).toContain("Found open-dashboard");
    expect(coordinator.handleError("some_other_event", "unrelated")).toBe(
      false,
    );
  });

  it("serializes updates and falls back after a missing confirmation", () => {
    vi.useFakeTimers();
    const sent: Record<string, unknown>[] = [];
    const coordinator = createRealtimeVoiceToolManifestCoordinator(
      (event) => sent.push(event),
      1_000,
    );
    coordinator.setSessionTools([realtimeTool("tool-search")]);
    coordinator.enqueue({
      callId: "call-1",
      status: "completed",
      output: "first",
      expandedTools: [realtimeTool("first-tool")],
    });
    coordinator.enqueue({
      callId: "call-2",
      status: "completed",
      output: "second",
      expandedTools: [realtimeTool("second-tool")],
    });

    expect(sent.map((event) => event.type)).toEqual(["session.update"]);
    vi.advanceTimersByTime(1_000);
    expect(sent.map((event) => event.type)).toEqual([
      "session.update",
      "conversation.item.create",
      "response.create",
      "session.update",
    ]);
    expect(
      JSON.parse(String((sent[1]?.item as { output: string }).output)).status,
    ).toBe("failed");
    vi.advanceTimersByTime(1_000);
    expect(sent.map((event) => event.type)).toEqual([
      "session.update",
      "conversation.item.create",
      "response.create",
      "session.update",
      "conversation.item.create",
      "response.create",
    ]);
    expect(
      JSON.parse(String((sent[4]?.item as { output: string }).output)).status,
    ).toBe("failed");
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
