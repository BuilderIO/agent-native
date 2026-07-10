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

import {
  SIDEBAR_STATE_CHANGE_EVENT,
  type AgentSidebarStateChangeDetail,
} from "../agent-sidebar-state.js";
import { agentNativePath } from "../api-path.js";
import { readClientAppState, setClientAppState } from "../application-state.js";
import { getBrowserTabId } from "../browser-tab-id.js";
import { useT } from "../i18n.js";
import {
  RealtimeVoiceModeDock,
  type RealtimeVoiceModeCopy,
  type RealtimeVoiceModeState,
} from "./RealtimeVoiceMode.js";

const REALTIME_VOICE_STATE_KEY = "realtime-voice-session";
const REALTIME_VOICE_REQUEST_SOURCE = "realtime-voice";
const REALTIME_VOICE_SESSION_PATH = "/_agent-native/realtime-voice/session";
const REALTIME_VOICE_TOOL_PATH = "/_agent-native/realtime-voice/tool";

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
  start: () => Promise<void>;
  end: () => void;
  toggleChat: () => void;
}

export interface RealtimeVoiceModeProviderProps {
  children: ReactNode;
  browserTabId?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function voiceCopy(t: ReturnType<typeof useT>): RealtimeVoiceModeCopy {
  return {
    entryButtonLabel: t("agentPanel.voiceMode.entryButtonLabel"),
    promptTitle: t("agentPanel.voiceMode.promptTitle"),
    promptDescription: t("agentPanel.voiceMode.promptDescription"),
    startVoiceMode: t("agentPanel.voiceMode.start"),
    keepDictating: t("agentPanel.voiceMode.keepDictating"),
    showChat: t("agentPanel.voiceMode.showChat"),
    hideChat: t("agentPanel.voiceMode.hideChat"),
    endVoiceMode: t("agentPanel.voiceMode.end"),
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
  const stateRef = useRef(state);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handledCallsRef = useRef(new Set<string>());
  const sessionIdRef = useRef<string | undefined>(undefined);
  const startedAtRef = useRef<string | undefined>(undefined);
  const lastUserTextRef = useRef("");
  const lastAssistantTextRef = useRef("");

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

  const cleanupTransport = useCallback(() => {
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
    handledCallsRef.current.clear();
  }, []);

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
        syncAppState("speaking");
      } else if (
        event.type === "conversation.item.input_audio_transcription.completed"
      ) {
        if (typeof event.transcript === "string") {
          lastUserTextRef.current = event.transcript;
          syncAppState("working");
        }
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
    [copy, fail, handleFunctionCall, syncAppState, transition],
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
    transition("connecting");
    window.dispatchEvent(new Event("agent-panel:close"));

    const abortController = new AbortController();
    abortRef.current = abortController;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      audioRef.current = audio;
      peer.ontrack = (trackEvent) => {
        audio.srcObject = trackEvent.streams[0] ?? null;
        void audio.play().catch(() => undefined);
      };

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.onopen = () => transition("listening");
      channel.onmessage = (messageEvent) => {
        try {
          handleServerEvent(JSON.parse(String(messageEvent.data)));
        } catch {
          // Ignore malformed provider events without ending a healthy call.
        }
      };
      channel.onerror = () =>
        fail(
          copy?.errors.channelDisconnected ??
            "The realtime voice control channel disconnected.",
        );
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") transition("listening");
        if (peer.connectionState === "failed") {
          fail(
            copy?.errors.connectionFailed ??
              "The realtime voice connection failed.",
          );
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
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
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (startError) {
      const status = (startError as { status?: unknown })?.status;
      fail(errorMessage(startError), { openKeySettings: status === 400 });
    }
  }, [browserTabId, copy, fail, handleServerEvent, transition]);

  const end = useCallback(() => {
    if (stateRef.current === "idle" || stateRef.current === "ending") return;
    transition("ending");
    cleanupTransport();
    setError(null);
    sessionIdRef.current = undefined;
    startedAtRef.current = undefined;
    transition("idle");
  }, [cleanupTransport, transition]);

  const toggleChat = useCallback(() => {
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
              onToggleChat={voice.toggleChat}
              onEndVoiceMode={voice.end}
              errorMessage={voice.errorMessage}
              className="z-[270]"
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
  if (existing) return children;
  return (
    <RealtimeVoiceModeProvider browserTabId={browserTabId}>
      {children}
    </RealtimeVoiceModeProvider>
  );
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
