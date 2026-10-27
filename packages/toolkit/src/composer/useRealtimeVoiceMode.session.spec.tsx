// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  realtimeVoiceTranscriptRegistry,
  type RealtimeVoiceTranscriptMessage,
  type RealtimeVoiceWorkUpdate,
} from "./realtime-voice-transcript.js";
import { ComposerRuntimeAdaptersProvider } from "./runtime-adapters.js";
import {
  REALTIME_VOICE_PREFERENCES_KEY,
  RealtimeVoiceModeProvider,
  useRealtimeVoiceMode,
  type RealtimeVoiceModeApi,
  type RealtimeVoiceStartOptions,
} from "./useRealtimeVoiceMode.js";

interface FakeChannel {
  onmessage?: (event: { data: string }) => void;
  close: () => void;
}

let channel: FakeChannel;
let track: { enabled: boolean; stop: () => void; onended: unknown };
let audio: HTMLAudioElement | undefined;
let setAppState: ReturnType<typeof vi.fn>;

class FakePeerConnection {
  connectionState = "new";
  ontrack: unknown;
  onconnectionstatechange: unknown;
  addTrack() {}
  createDataChannel() {
    return channel;
  }
  // The offer never settles, so the session stays connecting with its
  // microphone and playback element in place.
  createOffer() {
    return new Promise(() => {});
  }
  close() {}
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  channel = { close: vi.fn() };
  track = { enabled: true, stop: vi.fn(), onended: null };
  audio = undefined;
  setAppState = vi.fn();
  vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
        getAudioTracks: () => [track],
      })),
      enumerateDevices: vi.fn(async () => []),
    },
  });
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions,
  ) => {
    const element = createElement(tagName, options);
    if (tagName === "audio") audio = element as HTMLAudioElement;
    return element;
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function startSession(
  readAppState: (key: string) => unknown = () => undefined,
  startOptions?: RealtimeVoiceStartOptions,
  trackEvent: (
    name: string,
    properties: Record<string, unknown>,
  ) => void = () => undefined,
) {
  let api: RealtimeVoiceModeApi | undefined;
  function Probe() {
    api = useRealtimeVoiceMode();
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ComposerRuntimeAdaptersProvider
        adapters={{
          voice: {
            readAppState: readAppState as never,
            setAppState: setAppState as never,
            getBrowserTabId: () => "tab-1",
            trackEvent,
          },
        }}
      >
        <RealtimeVoiceModeProvider>
          <Probe />
        </RealtimeVoiceModeProvider>
      </ComposerRuntimeAdaptersProvider>,
    );
  });
  await act(async () => {
    void api!.start(startOptions);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    api: () => api!,
    send: async (event: Record<string, unknown>) => {
      await act(async () => {
        channel.onmessage?.({ data: JSON.stringify(event) });
      });
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("realtime voice session controls", () => {
  it("groups one reply's tool calls into one piece of work", async () => {
    const work: RealtimeVoiceWorkUpdate[] = [];
    const unregister = realtimeVoiceTranscriptRegistry.register({
      threadId: "thread-work",
      active: true,
      append: () => true,
      appendWork: (update) => {
        work.push(update);
        return true;
      },
    });
    const results: Array<(value: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => results.push(resolve))),
    );
    const session = await startSession();
    const resolveCall = async (callId: string) => {
      await act(async () => {
        results.shift()?.(
          Response.json({ callId, status: "completed", output: "{}" }),
        );
        await new Promise((done) => setTimeout(done, 0));
      });
    };

    await session.send({ type: "response.created" });
    for (const [callId, name] of [
      ["call-search", "web-search"],
      ["call-read", "web-request"],
    ] as const) {
      await session.send({
        type: "response.function_call_arguments.done",
        call_id: callId,
        name,
        arguments: "{}",
      });
    }
    // The response that asked for the tools is not the end of the reply.
    await session.send({
      type: "response.done",
      response: { status: "completed", output: [] },
    });
    await resolveCall("call-search");
    await resolveCall("call-read");
    expect(work.every((update) => !update.completedAt)).toBe(true);

    await session.send({ type: "response.created" });
    await session.send({
      type: "response.done",
      response: { status: "completed", output: [] },
    });

    const last = work.at(-1);
    expect(new Set(work.map((update) => update.id))).toEqual(
      new Set(["call-search"]),
    );
    expect(last?.calls.map((call) => [call.id, call.status])).toEqual([
      ["call-search", "completed"],
      ["call-read", "completed"],
    ]);
    expect(last?.completedAt).toBe(last?.calls.at(-1)?.completedAt);
    unregister();
    session.unmount();
  });

  it("groups a GPT-Live delegation's tool calls into one piece of work", async () => {
    const work: RealtimeVoiceWorkUpdate[] = [];
    const unregister = realtimeVoiceTranscriptRegistry.register({
      threadId: "thread-live-work",
      active: true,
      append: () => true,
      appendWork: (update) => {
        work.push(update);
        return true;
      },
    });
    const results: Array<(value: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => results.push(resolve))),
    );
    const session = await startSession();
    const nested = (delegationId: string, event: Record<string, unknown>) =>
      session.send({
        type: "response.event",
        delegation_id: delegationId,
        event,
      });
    // Live response snapshots never carry their output.
    const doneSnapshot = {
      type: "response.done",
      response: { status: "completed" },
    };
    const callResponse = async (delegationId: string, callId: string) => {
      await nested(delegationId, { type: "response.created" });
      await nested(delegationId, {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          call_id: callId,
          name: "web-search",
          arguments: "{}",
        },
      });
      await nested(delegationId, doneSnapshot);
      await act(async () => {
        results.shift()?.(
          Response.json({ callId, status: "completed", output: "{}" }),
        );
        await new Promise((done) => setTimeout(done, 0));
      });
    };

    await callResponse("delegation-1", "call-1");
    await callResponse("delegation-1", "call-2");
    await callResponse("delegation-1", "call-3");
    expect(work.every((update) => !update.completedAt)).toBe(true);
    await nested("delegation-1", { type: "response.created" });
    await nested("delegation-1", doneSnapshot);
    expect(work.at(-1)).toMatchObject({ id: "call-1" });
    expect(work.at(-1)?.calls.map((call) => call.id)).toEqual([
      "call-1",
      "call-2",
      "call-3",
    ]);
    expect(work.at(-1)?.completedAt).toBeTruthy();

    // The next request is a new delegation and new work.
    await callResponse("delegation-2", "call-4");
    expect(work.at(-1)).toMatchObject({ id: "call-4" });
    unregister();
    session.unmount();
  });

  it("records a tool call that teardown aborted as cancelled", async () => {
    const work: RealtimeVoiceWorkUpdate[] = [];
    const unregister = realtimeVoiceTranscriptRegistry.register({
      threadId: "thread-teardown",
      active: true,
      append: () => true,
      appendWork: (update) => {
        work.push(update);
        return true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );
    const session = await startSession();
    await session.send({ type: "response.created" });
    await session.send({
      type: "response.function_call_arguments.done",
      call_id: "call-edit",
      name: "web-search",
      arguments: "{}",
    });

    await act(async () => {
      session.api().end();
      await new Promise((done) => setTimeout(done, 0));
    });

    expect(work.at(-1)?.calls.map((call) => [call.id, call.status])).toEqual([
      ["call-edit", "cancelled"],
    ]);
    unregister();
    session.unmount();
  });

  it("reports each turn's timing without the words spoken", async () => {
    const trackEvent = vi.fn();
    const session = await startSession(undefined, undefined, trackEvent);

    await session.send({ type: "input_audio_buffer.speech_started" });
    await session.send({ type: "input_audio_buffer.speech_stopped" });
    await session.send({ type: "output_audio_buffer.started" });
    await session.send({
      type: "response.output_audio_transcript.delta",
      item_id: "assistant-1",
      delta: "Opening the secret plans",
    });
    expect(trackEvent).not.toHaveBeenCalled();
    await session.send({ type: "input_audio_buffer.speech_started" });

    expect(trackEvent).toHaveBeenCalledTimes(1);
    const [name, properties] = trackEvent.mock.calls[0]!;
    expect(name).toBe("realtime_voice_turn");
    expect(properties).toMatchObject({
      turn_index: 0,
      tool_calls: 0,
      latency_clock: "browser",
      spoke_again_after_edit: null,
    });
    expect(properties.speech_to_audio_ms).toEqual(expect.any(Number));
    expect(JSON.stringify(properties)).not.toContain("secret");
    session.unmount();
  });

  it("mutes the microphone track and the assistant's playback", async () => {
    const session = await startSession();
    expect(session.api().state).toBe("connecting");
    expect(audio?.muted).toBe(false);

    await act(async () => session.api().setInputMuted(true));
    expect(track.enabled).toBe(false);
    expect(session.api().inputMuted).toBe(true);

    await act(async () => session.api().setOutputMuted(true));
    expect(audio?.muted).toBe(true);
    expect(session.api().outputMuted).toBe(true);

    await act(async () => session.api().setInputMuted(false));
    expect(track.enabled).toBe(true);
    session.unmount();
  });

  it("streams both speakers into the thread that was on screen at start", async () => {
    const received: RealtimeVoiceTranscriptMessage[] = [];
    const unregister = realtimeVoiceTranscriptRegistry.register({
      threadId: "thread-session",
      active: true,
      append: (message) => {
        received.push(message);
        return true;
      },
    });
    const session = await startSession();

    await session.send({
      type: "conversation.item.added",
      item: { id: "user-1", type: "message", role: "user" },
    });
    await session.send({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "user-1",
      delta: "Open the docs",
    });
    await session.send({
      type: "response.output_audio_transcript.delta",
      item_id: "assistant-1",
      delta: "Opening",
    });
    await session.send({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "user-1",
      transcript: "Open the docs.",
    });

    expect(
      received.map(({ threadId, role, text, status }) => ({
        threadId,
        role,
        text,
        status,
      })),
    ).toEqual([
      {
        threadId: "thread-session",
        role: "user",
        text: "Open the docs",
        status: "streaming",
      },
      {
        threadId: "thread-session",
        role: "assistant",
        text: "Opening",
        status: "streaming",
      },
      {
        threadId: "thread-session",
        role: "user",
        text: "Open the docs.",
        status: "complete",
      },
    ]);
    // Every update of a turn shares its message id.
    expect(received[0]!.id).toBe(received[2]!.id);
    unregister();
    session.unmount();
  });

  it("streams into the thread it was started for until that thread is shown", async () => {
    const onScreen: RealtimeVoiceTranscriptMessage[] = [];
    const unregisterOnScreen = realtimeVoiceTranscriptRegistry.register({
      threadId: "thread-on-screen",
      active: true,
      append: (message) => {
        onScreen.push(message);
        return true;
      },
    });
    const session = await startSession(undefined, {
      threadId: "thread-handoff",
    });

    await session.send({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "user-handoff",
      transcript: "Plan my week.",
    });
    expect(onScreen).toEqual([]);

    const handedOff: RealtimeVoiceTranscriptMessage[] = [];
    const unregisterHandoff = realtimeVoiceTranscriptRegistry.register({
      threadId: "thread-handoff",
      active: true,
      append: (message) => {
        handedOff.push(message);
        return true;
      },
    });

    expect(
      handedOff.map(({ threadId, role, text, status }) => ({
        threadId,
        role,
        text,
        status,
      })),
    ).toEqual([
      {
        threadId: "thread-handoff",
        role: "user",
        text: "Plan my week.",
        status: "complete",
      },
    ]);
    unregisterHandoff();
    unregisterOnScreen();
    session.unmount();
  });

  it("saves the app's default level as not chosen so Settings can show it", async () => {
    vi.stubGlobal(
      "RTCPeerConnection",
      class extends FakePeerConnection {
        override createOffer() {
          return Promise.resolve({ type: "offer", sdp: "offer-sdp" });
        }
        setLocalDescription() {
          return Promise.resolve();
        }
        setRemoteDescription() {
          return Promise.resolve();
        }
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("answer-sdp", {
            headers: {
              "X-Agent-Native-Realtime-Protocol": "live",
              "X-Agent-Native-Realtime-Intelligence": "balanced",
            },
          }),
      ),
    );
    const session = await startSession();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(session.api().preferences).toMatchObject({
      intelligence: "balanced",
      intelligenceChosen: false,
    });
    expect(setAppState).toHaveBeenCalledWith(
      REALTIME_VOICE_PREFERENCES_KEY,
      expect.objectContaining({
        intelligence: "balanced",
        intelligenceChosen: false,
      }),
    );
    session.unmount();
  });

  it("starts from the voice chat choices saved in Settings", async () => {
    window.localStorage.setItem(
      "agent-native:realtime-voice-microphone",
      "studio",
    );
    const readAppState = vi.fn((key: string) =>
      key === REALTIME_VOICE_PREFERENCES_KEY
        ? { language: "ja", intelligence: "deep", voice: "cedar" }
        : undefined,
    );
    const session = await startSession(readAppState);

    expect(readAppState).toHaveBeenCalledWith(REALTIME_VOICE_PREFERENCES_KEY);
    expect(session.api().preferences).toEqual({
      language: "ja",
      intelligence: "deep",
      voice: "cedar",
      intelligenceChosen: true,
    });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ deviceId: { ideal: "studio" } }),
    });
    window.localStorage.removeItem("agent-native:realtime-voice-microphone");
    session.unmount();
  });
});
