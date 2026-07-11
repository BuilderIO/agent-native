import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { requestAgentChatThreadOpen } from "../agent-chat.js";
import {
  SIDEBAR_STATE_CHANGE_EVENT,
  type AgentSidebarStateChangeDetail,
} from "../agent-sidebar-state.js";
import { agentNativePath } from "../api-path.js";
import { readClientAppState, setClientAppState } from "../application-state.js";
import { getBrowserTabId } from "../browser-tab-id.js";
import { useT } from "../i18n.js";
import {
  createRealtimeVoiceAudioLevelStore,
  normalizeRealtimeVoiceRms,
  smoothRealtimeVoiceLevel,
  type RealtimeVoiceAudioLevelStore,
} from "./realtime-voice-audio-level.js";
import { realtimeVoiceTranscriptRegistry } from "./realtime-voice-transcript.js";
import {
  RealtimeVoiceModeDock,
  type RealtimeVoiceModeCopy,
  type RealtimeVoiceModeState,
} from "./RealtimeVoiceMode.js";

const REALTIME_VOICE_STATE_KEY = "realtime-voice-session";
const REALTIME_VOICE_REQUEST_SOURCE = "realtime-voice";
const REALTIME_VOICE_SESSION_PATH = "/_agent-native/realtime-voice/session";
const REALTIME_VOICE_TOOL_PATH = "/_agent-native/realtime-voice/tool";
const REALTIME_VOICE_CONNECTION_TIMEOUT_MS = 15_000;

export const REALTIME_VOICE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  // Prefer the browser/OS-selected input instead of whichever physical device
  // happens to be enumerated first. `ideal` keeps browsers without the
  // synthetic `default` device from failing with OverconstrainedError.
  deviceId: { ideal: "default" },
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

type RealtimeServerEvent = Record<string, unknown> & { type?: string };

export interface RealtimeVoiceToolResult {
  callId: string;
  status: "completed" | "failed" | "approval_required";
  output: string;
  approvalKey?: string;
}

export interface RealtimeVoiceModeApi {
  state: "idle" | RealtimeVoiceModeState;
  active: boolean;
  errorMessage: string | null;
  chatVisible: boolean;
  audioLevels: RealtimeVoiceAudioLevelStore;
  start: () => Promise<void>;
  end: () => void;
  toggleChat: () => void;
}

export interface CompletedRealtimeVoiceTranscript {
  role: "user" | "assistant";
  text: string;
  providerId?: string;
}

/**
 * Voice mode owns the chat only temporarily. Restore the captured transcript
 * when it is still the user's active thread (or the chat has no active thread)
 * but never pull them back after they deliberately selected another thread.
 */
export function shouldRestoreRealtimeVoiceTranscriptThread(
  transcriptThreadId: string | undefined,
  activeThreadId: string | undefined,
): transcriptThreadId is string {
  return Boolean(
    transcriptThreadId &&
    (!activeThreadId || activeThreadId === transcriptThreadId),
  );
}

export function extractCompletedRealtimeVoiceTranscript(
  event: RealtimeServerEvent,
): CompletedRealtimeVoiceTranscript | null {
  const userCompleted =
    event.type === "conversation.item.input_audio_transcription.completed";
  const assistantCompleted =
    event.type === "response.output_audio_transcript.done";
  if (!userCompleted && !assistantCompleted) return null;
  const text =
    typeof event.transcript === "string" ? event.transcript.trim() : "";
  if (!text) return null;
  const providerId = [event.item_id, event.response_id, event.event_id].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return {
    role: userCompleted ? "user" : "assistant",
    text,
    ...(providerId ? { providerId } : {}),
  };
}

export interface RealtimeVoiceModeProviderProps {
  children: ReactNode;
  browserTabId?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRealtimeVoiceAbortError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "AbortError",
  );
}

export function createRealtimeVoiceConnectionTimeout(
  onTimeout: () => void,
  timeoutMs = REALTIME_VOICE_CONNECTION_TIMEOUT_MS,
): () => void {
  const timeout = window.setTimeout(onTimeout, timeoutMs);
  return () => window.clearTimeout(timeout);
}

async function readErrorResponse(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  if (!raw) return response.statusText || `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    return String(parsed.error ?? parsed.message ?? raw);
  } catch {
    return raw.slice(0, 500);
  }
}

export async function createRealtimeVoiceSession(
  offerSdp: string,
  options: { browserTabId?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const response = await fetch(agentNativePath(REALTIME_VOICE_SESSION_PATH), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/sdp",
      ...(options.browserTabId
        ? { "X-Agent-Native-Browser-Tab": options.browserTabId }
        : {}),
    },
    body: offerSdp,
    signal: options.signal,
  });
  if (!response.ok) {
    const message = await readErrorResponse(response);
    const error = new Error(message);
    (error as { status?: number }).status = response.status;
    throw error;
  }
  return response.text();
}

export async function executeRealtimeVoiceTool(input: {
  name: string;
  args: Record<string, unknown>;
  callId: string;
  sessionId?: string;
  browserTabId?: string;
  signal?: AbortSignal;
}): Promise<RealtimeVoiceToolResult> {
  const response = await fetch(agentNativePath(REALTIME_VOICE_TOOL_PATH), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(input.browserTabId
        ? { "X-Agent-Native-Browser-Tab": input.browserTabId }
        : {}),
    },
    body: JSON.stringify({
      name: input.name,
      args: input.args,
      callId: input.callId,
      sessionId: input.sessionId,
      browserTabId: input.browserTabId,
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }
  return (await response.json()) as RealtimeVoiceToolResult;
}

export function extractRealtimeVoiceFunctionCalls(
  event: RealtimeServerEvent,
): Array<{ name: string; callId: string; argumentsText: string }> {
  if (event.type === "response.function_call_arguments.done") {
    const name = typeof event.name === "string" ? event.name : "";
    const callId = typeof event.call_id === "string" ? event.call_id : "";
    if (!name || !callId) return [];
    return [
      {
        name,
        callId,
        argumentsText:
          typeof event.arguments === "string" ? event.arguments : "{}",
      },
    ];
  }
  if (event.type !== "response.done") return [];
  const response = event.response;
  if (!response || typeof response !== "object") return [];
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (record.type !== "function_call") return [];
    const name = typeof record.name === "string" ? record.name : "";
    const callId = typeof record.call_id === "string" ? record.call_id : "";
    if (!name || !callId) return [];
    return [
      {
        name,
        callId,
        argumentsText:
          typeof record.arguments === "string" ? record.arguments : "{}",
      },
    ];
  });
}

function parseFunctionArguments(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The voice model returned invalid tool arguments.");
  }
  return parsed as Record<string, unknown>;
}

function sendDataChannelEvent(
  channel: RTCDataChannel | null,
  event: Record<string, unknown>,
): void {
  if (!channel || channel.readyState !== "open") return;
  channel.send(JSON.stringify(event));
}

function openOpenAiKeySettings(): void {
  if (typeof window === "undefined") return;
  window.location.hash = "#secrets:OPENAI_API_KEY";
  window.dispatchEvent(new Event("agent-panel:open"));
  window.dispatchEvent(
    new CustomEvent("agent-panel:open-settings", {
      detail: { section: "secrets" },
    }),
  );
}

function openMicrophoneSettings(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("agent-panel:open"));
  window.dispatchEvent(
    new CustomEvent("agent-panel:open-settings", {
      detail: { section: "voice" },
    }),
  );
}

function voiceCopy(t: ReturnType<typeof useT>): RealtimeVoiceModeCopy {
  return {
    entryButtonLabel: t("agentPanel.voiceMode.entryButtonLabel"),
    promptTitle: t("agentPanel.voiceMode.promptTitle"),
    promptDescription: t("agentPanel.voiceMode.promptDescription"),
    setupTitle: t("agentPanel.voiceMode.setupTitle"),
    setupDescription: t("agentPanel.voiceMode.setupDescription"),
    connectBuilder: t("agentPanel.voiceMode.connectBuilder"),
    useOpenAiKey: t("agentPanel.voiceMode.useOpenAiKey"),
    startWithOpenAiKey: t("agentPanel.voiceMode.startWithOpenAiKey"),
    startVoiceMode: t("agentPanel.voiceMode.start"),
    keepDictating: t("agentPanel.voiceMode.keepDictating"),
    showChat: t("agentPanel.voiceMode.showChat"),
    hideChat: t("agentPanel.voiceMode.hideChat"),
    endVoiceMode: t("agentPanel.voiceMode.end"),
    microphoneSettings: t("agentPanel.voiceMode.microphoneSettings"),
    status: {
      connecting: t("agentPanel.voiceMode.status.connecting"),
      listening: t("agentPanel.voiceMode.status.listening"),
      speaking: t("agentPanel.voiceMode.status.speaking"),
      working: t("agentPanel.voiceMode.status.working"),
      error: t("agentPanel.voiceMode.status.error"),
      ending: t("agentPanel.voiceMode.status.ending"),
    },
    errors: {
      unsupported: t("agentPanel.voiceMode.errors.unsupported"),
      responseFailed: t("agentPanel.voiceMode.errors.responseFailed"),
      sessionFailed: t("agentPanel.voiceMode.errors.sessionFailed"),
      channelDisconnected: t("agentPanel.voiceMode.errors.channelDisconnected"),
      connectionFailed: t("agentPanel.voiceMode.errors.connectionFailed"),
      offerFailed: t("agentPanel.voiceMode.errors.offerFailed"),
    },
  };
}

export function useRealtimeVoiceModeCopy(): RealtimeVoiceModeCopy {
  const t = useT();
  return useMemo(() => voiceCopy(t), [t]);
}

function useRealtimeVoiceModeController(
  browserTabId?: string,
  copy?: RealtimeVoiceModeCopy,
): RealtimeVoiceModeApi {
  const [state, setState] = useState<"idle" | RealtimeVoiceModeState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [chatVisible, setChatVisible] = useState(false);
  const [audioLevels] = useState(createRealtimeVoiceAudioLevelStore);
  const stateRef = useRef(state);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputMeterBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const outputMeterBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const meterFrameRef = useRef<number | null>(null);
  const lastMeterSampleRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const cancelConnectionTimeoutRef = useRef<(() => void) | null>(null);
  const handledCallsRef = useRef(new Set<string>());
  const sessionIdRef = useRef<string | undefined>(undefined);
  const startedAtRef = useRef<string | undefined>(undefined);
  const lastUserTextRef = useRef("");
  const lastAssistantTextRef = useRef("");
  const transcriptThreadIdRef = useRef<string | undefined>(undefined);
  const transcriptSequenceRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const syncAppState = useCallback(
    (nextState: "idle" | RealtimeVoiceModeState) => {
      const value =
        nextState === "idle"
          ? null
          : {
              active: true,
              status: nextState,
              model: "gpt-realtime-2.1",
              startedAt: startedAtRef.current,
              sessionId: sessionIdRef.current,
              browserTabId,
              lastUserText: lastUserTextRef.current || undefined,
              lastAssistantText: lastAssistantTextRef.current || undefined,
            };
      void setClientAppState(REALTIME_VOICE_STATE_KEY, value, {
        requestSource: REALTIME_VOICE_REQUEST_SOURCE,
      }).catch(() => undefined);
    },
    [browserTabId],
  );

  const transition = useCallback(
    (nextState: "idle" | RealtimeVoiceModeState) => {
      stateRef.current = nextState;
      setState(nextState);
      syncAppState(nextState);
    },
    [syncAppState],
  );

  const startMeterLoop = useCallback(() => {
    if (meterFrameRef.current !== null) return;
    const sample = (timestamp: number) => {
      meterFrameRef.current = requestAnimationFrame(sample);
      if (timestamp - lastMeterSampleRef.current < 50) return;
      lastMeterSampleRef.current = timestamp;

      const current = audioLevels.getSnapshot();
      let input = current.input;
      let output = current.output;
      const inputAnalyser = inputAnalyserRef.current;
      const inputBuffer = inputMeterBufferRef.current;
      if (inputAnalyser && inputBuffer) {
        inputAnalyser.getByteTimeDomainData(inputBuffer);
        input = smoothRealtimeVoiceLevel(
          input,
          normalizeRealtimeVoiceRms(inputBuffer),
        );
      }
      const outputAnalyser = outputAnalyserRef.current;
      const outputBuffer = outputMeterBufferRef.current;
      if (outputAnalyser && outputBuffer) {
        outputAnalyser.getByteTimeDomainData(outputBuffer);
        output = smoothRealtimeVoiceLevel(
          output,
          normalizeRealtimeVoiceRms(outputBuffer),
        );
      }
      audioLevels.set({ input, output });
    };
    meterFrameRef.current = requestAnimationFrame(sample);
  }, [audioLevels]);

  const attachAudioMeter = useCallback(
    (stream: MediaStream, channel: "input" | "output") => {
      try {
        const AudioCtor =
          window.AudioContext ??
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!AudioCtor) return;
        const context = audioContextRef.current ?? new AudioCtor();
        audioContextRef.current = context;
        void context.resume().catch(() => undefined);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        const buffer = new Uint8Array(analyser.frequencyBinCount);
        if (channel === "input") {
          inputSourceRef.current?.disconnect();
          inputSourceRef.current = source;
          inputAnalyserRef.current = analyser;
          inputMeterBufferRef.current = buffer;
        } else {
          outputSourceRef.current?.disconnect();
          outputSourceRef.current = source;
          outputAnalyserRef.current = analyser;
          outputMeterBufferRef.current = buffer;
        }
        startMeterLoop();
      } catch {
        // Audio metering is visual-only; keep the realtime call healthy.
      }
    },
    [startMeterLoop],
  );

  const cleanupTransport = useCallback(() => {
    cancelConnectionTimeoutRef.current?.();
    cancelConnectionTimeoutRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    channelRef.current?.close();
    channelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    audioRef.current = null;
    if (meterFrameRef.current !== null) {
      cancelAnimationFrame(meterFrameRef.current);
      meterFrameRef.current = null;
    }
    inputSourceRef.current?.disconnect();
    outputSourceRef.current?.disconnect();
    inputSourceRef.current = null;
    outputSourceRef.current = null;
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;
    inputMeterBufferRef.current = null;
    outputMeterBufferRef.current = null;
    lastMeterSampleRef.current = 0;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext) void audioContext.close().catch(() => undefined);
    audioLevels.reset();
    handledCallsRef.current.clear();
  }, [audioLevels]);

  const fail = useCallback(
    (message: string, options?: { openKeySettings?: boolean }) => {
      cleanupTransport();
      setError(message);
      transition("error");
      if (options?.openKeySettings) openOpenAiKeySettings();
    },
    [cleanupTransport, transition],
  );

  const handleFunctionCall = useCallback(
    async (call: { name: string; callId: string; argumentsText: string }) => {
      if (handledCallsRef.current.has(call.callId)) return;
      handledCallsRef.current.add(call.callId);
      transition("working");
      let result: RealtimeVoiceToolResult;
      try {
        const args = parseFunctionArguments(call.argumentsText);
        result = await executeRealtimeVoiceTool({
          name: call.name,
          args,
          callId: call.callId,
          sessionId: sessionIdRef.current,
          browserTabId,
          signal: abortRef.current?.signal,
        });
      } catch (toolError) {
        result = {
          callId: call.callId,
          status: "failed",
          output: errorMessage(toolError),
        };
      }
      sendDataChannelEvent(channelRef.current, {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: call.callId,
          output: JSON.stringify(result),
        },
      });
      sendDataChannelEvent(channelRef.current, { type: "response.create" });
    },
    [browserTabId, transition],
  );

  const persistCompletedTranscript = useCallback(
    (event: RealtimeServerEvent) => {
      const transcript = extractCompletedRealtimeVoiceTranscript(event);
      const threadId = transcriptThreadIdRef.current;
      if (!transcript || !threadId) return;
      const sessionIdentity =
        sessionIdRef.current ?? startedAtRef.current ?? "pending";
      const providerIdentity =
        transcript.providerId ?? `sequence-${++transcriptSequenceRef.current}`;
      realtimeVoiceTranscriptRegistry.publish({
        id: `realtime-voice:${sessionIdentity}:${transcript.role}:${providerIdentity}`,
        threadId,
        role: transcript.role,
        text: transcript.text,
        createdAt: new Date().toISOString(),
      });
    },
    [],
  );

  const handleServerEvent = useCallback(
    (event: RealtimeServerEvent) => {
      if (event.type === "session.created") {
        const session = event.session;
        if (session && typeof session === "object") {
          const id = (session as { id?: unknown }).id;
          if (typeof id === "string") sessionIdRef.current = id;
        }
        transition("listening");
      } else if (event.type === "input_audio_buffer.speech_started") {
        transition("listening");
      } else if (event.type === "input_audio_buffer.speech_stopped") {
        transition("working");
      } else if (event.type === "response.created") {
        lastAssistantTextRef.current = "";
        transition("working");
      } else if (event.type === "response.output_audio_transcript.delta") {
        if (typeof event.delta === "string") {
          lastAssistantTextRef.current += event.delta;
        }
        transition("speaking");
      } else if (event.type === "response.output_audio_transcript.done") {
        if (typeof event.transcript === "string") {
          lastAssistantTextRef.current = event.transcript;
        }
        persistCompletedTranscript(event);
        syncAppState("speaking");
      } else if (
        event.type === "conversation.item.input_audio_transcription.completed"
      ) {
        if (typeof event.transcript === "string") {
          lastUserTextRef.current = event.transcript;
        }
        persistCompletedTranscript(event);
        syncAppState("working");
      } else if (event.type === "response.done") {
        const response = event.response;
        const status =
          response && typeof response === "object"
            ? (response as { status?: unknown }).status
            : undefined;
        if (status === "failed") {
          fail(
            copy?.errors.responseFailed ??
              "OpenAI could not complete the voice response.",
          );
          return;
        }
      } else if (event.type === "error") {
        const detail = event.error;
        const message =
          detail && typeof detail === "object"
            ? String((detail as { message?: unknown }).message ?? "")
            : typeof detail === "string"
              ? detail
              : "";
        fail(
          message ||
            copy?.errors.sessionFailed ||
            "The realtime voice session encountered an error.",
        );
        return;
      }

      const calls = extractRealtimeVoiceFunctionCalls(event);
      for (const call of calls) void handleFunctionCall(call);
      if (event.type === "response.done" && calls.length === 0) {
        transition("listening");
      }
    },
    [
      copy,
      fail,
      handleFunctionCall,
      persistCompletedTranscript,
      syncAppState,
      transition,
    ],
  );

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    if (
      typeof RTCPeerConnection === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      fail(
        copy?.errors.unsupported ??
          "This browser does not support realtime voice conversations.",
      );
      return;
    }
    setError(null);
    startedAtRef.current = new Date().toISOString();
    lastUserTextRef.current = "";
    lastAssistantTextRef.current = "";
    sessionIdRef.current = undefined;
    transcriptThreadIdRef.current =
      realtimeVoiceTranscriptRegistry.activeThreadId();
    transcriptSequenceRef.current = 0;
    transition("connecting");
    setChatVisible(false);
    window.dispatchEvent(new Event("agent-panel:close"));

    const abortController = new AbortController();
    abortRef.current = abortController;
    const isCurrentAttempt = () =>
      abortRef.current === abortController && !abortController.signal.aborted;
    const markConnected = () => {
      if (!isCurrentAttempt()) return;
      cancelConnectionTimeoutRef.current?.();
      cancelConnectionTimeoutRef.current = null;
      transition("listening");
    };
    cancelConnectionTimeoutRef.current = createRealtimeVoiceConnectionTimeout(
      () => {
        if (!isCurrentAttempt()) return;
        fail(
          copy?.errors.connectionFailed ??
            "The realtime voice connection timed out.",
        );
      },
    );
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: REALTIME_VOICE_AUDIO_CONSTRAINTS,
      });
      if (!isCurrentAttempt()) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      attachAudioMeter(stream, "input");

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      audioRef.current = audio;
      peer.ontrack = (trackEvent) => {
        const remoteStream = trackEvent.streams[0] ?? null;
        audio.srcObject = remoteStream;
        if (remoteStream) attachAudioMeter(remoteStream, "output");
        void audio.play().catch(() => undefined);
      };

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.onopen = markConnected;
      channel.onmessage = (messageEvent) => {
        if (!isCurrentAttempt()) return;
        try {
          handleServerEvent(JSON.parse(String(messageEvent.data)));
        } catch {
          // Ignore malformed provider events without ending a healthy call.
        }
      };
      channel.onerror = () => {
        if (!isCurrentAttempt()) return;
        fail(
          copy?.errors.channelDisconnected ??
            "The realtime voice control channel disconnected.",
        );
      };
      peer.onconnectionstatechange = () => {
        if (!isCurrentAttempt()) return;
        if (peer.connectionState === "connected") markConnected();
        if (peer.connectionState === "failed") {
          fail(
            copy?.errors.connectionFailed ??
              "The realtime voice connection failed.",
          );
        }
      };

      const offer = await peer.createOffer();
      if (!isCurrentAttempt()) return;
      await peer.setLocalDescription(offer);
      if (!isCurrentAttempt()) return;
      if (!offer.sdp) {
        throw new Error(
          copy?.errors.offerFailed ??
            "The browser did not create an audio offer.",
        );
      }
      const answerSdp = await createRealtimeVoiceSession(offer.sdp, {
        browserTabId,
        signal: abortController.signal,
      });
      if (!isCurrentAttempt()) return;
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (startError) {
      // Ending a connection aborts the SDP request by design. A superseded
      // attempt must never resurrect the dock or surface that cancellation as
      // an error after cleanup.
      if (
        isRealtimeVoiceAbortError(startError) ||
        abortController.signal.aborted ||
        abortRef.current !== abortController
      ) {
        return;
      }
      const status = (startError as { status?: unknown })?.status;
      fail(errorMessage(startError), { openKeySettings: status === 400 });
    }
  }, [
    attachAudioMeter,
    browserTabId,
    copy,
    fail,
    handleServerEvent,
    transition,
  ]);

  const end = useCallback(() => {
    if (stateRef.current === "idle" || stateRef.current === "ending") return;
    const transcriptThreadId = transcriptThreadIdRef.current;
    const activeThreadId = realtimeVoiceTranscriptRegistry.activeThreadId();
    transition("ending");
    cleanupTransport();
    setError(null);
    sessionIdRef.current = undefined;
    startedAtRef.current = undefined;
    transcriptThreadIdRef.current = undefined;
    setChatVisible(true);
    if (
      shouldRestoreRealtimeVoiceTranscriptThread(
        transcriptThreadId,
        activeThreadId,
      )
    ) {
      requestAgentChatThreadOpen({
        threadId: transcriptThreadId,
        // The request is delivered asynchronously. Re-checking this at the
        // receiver prevents a navigation that happened during that gap from
        // being overwritten.
        onlyIfActiveThreadId: transcriptThreadId,
      });
    } else {
      window.dispatchEvent(new Event("agent-panel:open"));
    }
    transition("idle");
  }, [cleanupTransport, transition]);

  const toggleChat = useCallback(() => {
    setChatVisible((current) => !current);
    window.dispatchEvent(new Event("agent-panel:toggle"));
  }, []);

  useEffect(() => {
    const onSidebarState = (event: Event) => {
      const detail = (event as CustomEvent<AgentSidebarStateChangeDetail>)
        .detail;
      if (detail && typeof detail.open === "boolean") {
        setChatVisible(detail.open);
      }
    };
    window.addEventListener(SIDEBAR_STATE_CHANGE_EVENT, onSidebarState);
    return () =>
      window.removeEventListener(SIDEBAR_STATE_CHANGE_EVENT, onSidebarState);
  }, []);

  useEffect(() => cleanupTransport, [cleanupTransport]);

  return {
    state,
    active: state !== "idle",
    errorMessage: error,
    chatVisible,
    audioLevels,
    start,
    end,
    toggleChat,
  };
}

const RealtimeVoiceModeContext = createContext<RealtimeVoiceModeApi | null>(
  null,
);

export function RealtimeVoiceModeProvider({
  children,
  browserTabId,
}: RealtimeVoiceModeProviderProps) {
  const resolvedBrowserTabId = useMemo(
    () => browserTabId ?? getBrowserTabId(),
    [browserTabId],
  );
  const copy = useRealtimeVoiceModeCopy();
  const voice = useRealtimeVoiceModeController(resolvedBrowserTabId, copy);

  return (
    <RealtimeVoiceModeContext.Provider value={voice}>
      {children}
      {voice.active && typeof document !== "undefined"
        ? createPortal(
            <RealtimeVoiceModeDock
              state={voice.state === "idle" ? "ending" : voice.state}
              copy={copy}
              chatVisible={voice.chatVisible}
              audioLevels={voice.audioLevels}
              onToggleChat={voice.toggleChat}
              onEndVoiceMode={voice.end}
              onOpenMicrophoneSettings={openMicrophoneSettings}
              errorMessage={voice.errorMessage}
            />,
            document.body,
          )
        : null}
    </RealtimeVoiceModeContext.Provider>
  );
}

/**
 * Ensure standalone/full-page composers get realtime voice without nesting a
 * second session owner inside the persistent AgentSidebar provider.
 */
export function RealtimeVoiceModeBoundary({
  children,
  browserTabId,
}: RealtimeVoiceModeProviderProps) {
  const existing = useRealtimeVoiceModeOptional();
  if (existing) {
    return (
      <RealtimeVoiceModeComposerSurface>
        {children}
      </RealtimeVoiceModeComposerSurface>
    );
  }
  return (
    <RealtimeVoiceModeProvider browserTabId={browserTabId}>
      <RealtimeVoiceModeComposerSurface>
        {children}
      </RealtimeVoiceModeComposerSurface>
    </RealtimeVoiceModeProvider>
  );
}

/** Hide a composer while voice owns input; the dock can reveal it on demand. */
function RealtimeVoiceModeComposerSurface({
  children,
}: Pick<RealtimeVoiceModeProviderProps, "children">) {
  const voice = useRealtimeVoiceModeOptional();
  if (voice?.active && !voice.chatVisible) return null;
  return children;
}

export function useRealtimeVoiceMode(): RealtimeVoiceModeApi {
  const value = useContext(RealtimeVoiceModeContext);
  if (!value) {
    throw new Error(
      "useRealtimeVoiceMode must be used inside RealtimeVoiceModeProvider.",
    );
  }
  return value;
}

export function useRealtimeVoiceModeOptional(): RealtimeVoiceModeApi | null {
  return useContext(RealtimeVoiceModeContext);
}

export async function readRealtimeVoiceContext(): Promise<{
  navigation: unknown;
  url: unknown;
}> {
  const [navigation, url] = await Promise.all([
    readClientAppState("navigation").catch(() => null),
    readClientAppState("__url__").catch(() => null),
  ]);
  return { navigation, url };
}
