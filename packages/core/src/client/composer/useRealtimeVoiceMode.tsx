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
const REALTIME_VOICE_PREFERENCES_KEY = "realtime-voice-prefs";
const REALTIME_VOICE_REQUEST_SOURCE = "realtime-voice";
const REALTIME_VOICE_SESSION_PATH = "/_agent-native/realtime-voice/session";
const REALTIME_VOICE_TOOL_PATH = "/_agent-native/realtime-voice/tool";
const REALTIME_VOICE_CAPABILITY_HEADER = "X-Agent-Native-Realtime-Capability";
const REALTIME_VOICE_CONNECTION_TIMEOUT_MS = 15_000;
const REALTIME_VOICE_MAX_TOOLS = 32;
const REALTIME_VOICE_MAX_TOOL_SCHEMA_BYTES = 32_000;
const REALTIME_VOICE_MAX_SESSION_BYTES = 64_000;
const REALTIME_VOICE_TOOL_UPDATE_TIMEOUT_MS = 5_000;
const REALTIME_VOICE_PRIORITY_TOOL_NAMES = [
  "navigate",
  "set-url-path",
  "set-search-params",
  "view-screen",
  "tool-search",
] as const;
const REALTIME_VOICE_TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const REALTIME_VOICE_MICROPHONE_STORAGE_KEY =
  "agent-native:realtime-voice-microphone";

export const REALTIME_VOICE_LANGUAGES = [
  "auto",
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ja",
  "ko",
  "zh",
] as const;
export const REALTIME_VOICE_INTELLIGENCE_LEVELS = [
  "instant",
  "balanced",
  "deep",
] as const;
export const REALTIME_VOICES = [
  "marin",
  "cedar",
  "coral",
  "sage",
  "verse",
  "alloy",
  "ash",
  "ballad",
  "echo",
  "shimmer",
] as const;

export type RealtimeVoiceLanguage = (typeof REALTIME_VOICE_LANGUAGES)[number];
export type RealtimeVoiceIntelligence =
  (typeof REALTIME_VOICE_INTELLIGENCE_LEVELS)[number];
export type RealtimeVoice = (typeof REALTIME_VOICES)[number];

export interface RealtimeVoicePreferences {
  language: RealtimeVoiceLanguage;
  intelligence: RealtimeVoiceIntelligence;
  voice: RealtimeVoice;
}

export const DEFAULT_REALTIME_VOICE_PREFERENCES: RealtimeVoicePreferences = {
  language: "auto",
  intelligence: "instant",
  voice: "marin",
};

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
  expandedTools?: RealtimeVoiceFunctionTool[];
}

export interface RealtimeVoiceSessionAnswer {
  sdp: string;
  capability?: string;
}

export interface RealtimeVoiceFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface RealtimeVoiceModeApi {
  state: "idle" | RealtimeVoiceModeState;
  active: boolean;
  errorMessage: string | null;
  chatVisible: boolean;
  audioLevels: RealtimeVoiceAudioLevelStore;
  preferences: RealtimeVoicePreferences;
  microphones: readonly RealtimeVoiceMicrophone[];
  microphoneDeviceId: string;
  microphoneSwitching: boolean;
  microphoneError: string | null;
  voiceChangePending: boolean;
  setLanguage: (language: RealtimeVoiceLanguage) => void;
  setIntelligence: (intelligence: RealtimeVoiceIntelligence) => void;
  setVoice: (voice: RealtimeVoice) => void;
  setMicrophone: (deviceId: string) => Promise<void>;
  start: () => Promise<void>;
  end: () => void;
  toggleChat: () => void;
}

export interface RealtimeVoiceMicrophone {
  deviceId: string;
  label: string;
}

export function createRealtimeVoiceAudioConstraints(
  deviceId = "default",
  exact = false,
): MediaTrackConstraints {
  return {
    ...REALTIME_VOICE_AUDIO_CONSTRAINTS,
    deviceId:
      deviceId === "default"
        ? { ideal: "default" }
        : exact
          ? { exact: deviceId }
          : { ideal: deviceId },
  };
}

export async function replaceRealtimeVoiceMicrophone(options: {
  mediaDevices: Pick<MediaDevices, "getUserMedia">;
  peer: Pick<RTCPeerConnection, "getSenders">;
  currentStream: MediaStream | null;
  deviceId: string;
}): Promise<MediaStream> {
  const replacementStream = await options.mediaDevices.getUserMedia({
    audio: createRealtimeVoiceAudioConstraints(options.deviceId, true),
  });
  try {
    const replacementTrack = replacementStream.getAudioTracks()[0];
    const sender = options.peer
      .getSenders()
      .find((candidate) => candidate.track?.kind === "audio");
    if (!replacementTrack || !sender) {
      throw new Error("No active microphone track is available.");
    }

    await sender.replaceTrack(replacementTrack);
    for (const track of options.currentStream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    return replacementStream;
  } catch (error) {
    for (const track of replacementStream.getTracks()) track.stop();
    throw error;
  }
}

function readRealtimeVoiceMicrophoneId(): string {
  if (typeof window === "undefined") return "default";
  try {
    return (
      window.localStorage.getItem(REALTIME_VOICE_MICROPHONE_STORAGE_KEY) ||
      "default"
    );
  } catch {
    return "default";
  }
}

function writeRealtimeVoiceMicrophoneId(deviceId: string): void {
  try {
    window.localStorage.setItem(
      REALTIME_VOICE_MICROPHONE_STORAGE_KEY,
      deviceId,
    );
  } catch {
    // A remembered local device is optional and must never block voice mode.
  }
}

function isOneOf<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

export function normalizeRealtimeVoicePreferences(
  value: unknown,
): RealtimeVoicePreferences {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    language: isOneOf(REALTIME_VOICE_LANGUAGES, record.language)
      ? record.language
      : DEFAULT_REALTIME_VOICE_PREFERENCES.language,
    intelligence: isOneOf(
      REALTIME_VOICE_INTELLIGENCE_LEVELS,
      record.intelligence,
    )
      ? record.intelligence
      : DEFAULT_REALTIME_VOICE_PREFERENCES.intelligence,
    voice: isOneOf(REALTIME_VOICES, record.voice)
      ? record.voice
      : DEFAULT_REALTIME_VOICE_PREFERENCES.voice,
  };
}

export function resolveRealtimeVoiceLanguage(
  language: RealtimeVoiceLanguage,
  browserLanguages: readonly string[] = [],
): Exclude<RealtimeVoiceLanguage, "auto"> {
  if (language !== "auto") return language;
  for (const locale of browserLanguages) {
    const primary = locale.trim().split("-")[0]?.toLowerCase();
    if (isOneOf(REALTIME_VOICE_LANGUAGES, primary) && primary !== "auto") {
      return primary;
    }
  }
  return "en";
}

export function realtimeVoiceReasoningEffort(
  intelligence: RealtimeVoiceIntelligence,
): "minimal" | "low" | "medium" {
  if (intelligence === "balanced") return "low";
  if (intelligence === "deep") return "medium";
  return "minimal";
}

export function createRealtimeVoicePreferenceUpdate(
  preferences: RealtimeVoicePreferences,
  options: {
    browserLanguages?: readonly string[];
    includeVoice?: boolean;
  } = {},
): Record<string, unknown> {
  return {
    type: "session.update",
    session: {
      type: "realtime",
      reasoning: {
        effort: realtimeVoiceReasoningEffort(preferences.intelligence),
      },
      audio: {
        input: {
          transcription: {
            model: "gpt-4o-mini-transcribe",
            language: resolveRealtimeVoiceLanguage(
              preferences.language,
              options.browserLanguages,
            ),
          },
        },
        ...(options.includeVoice
          ? { output: { voice: preferences.voice } }
          : {}),
      },
    },
  };
}

export interface CompletedRealtimeVoiceTranscript {
  role: "user" | "assistant";
  text: string;
  providerId?: string;
}

export interface RealtimeVoiceTranscriptSequencer {
  handle: (event: RealtimeServerEvent) => void;
  reset: () => void;
}

interface SequencedRealtimeVoiceTranscript {
  status: "pending" | "completed" | "skipped";
  role?: CompletedRealtimeVoiceTranscript["role"];
  transcript?: CompletedRealtimeVoiceTranscript;
}

/**
 * Input transcription is produced by a separate ASR model and can finish after
 * the assistant response. Reserve each message's position when OpenAI adds it
 * to the conversation, then publish only the contiguous completed prefix.
 */
export function createRealtimeVoiceTranscriptSequencer(
  publish: (transcript: CompletedRealtimeVoiceTranscript) => void,
): RealtimeVoiceTranscriptSequencer {
  const order: string[] = [];
  const items = new Map<string, SequencedRealtimeVoiceTranscript>();
  const settledItemIds = new Set<string>();
  const receivedTranscriptIds = new Set<string>();

  const reserve = (
    id: string,
    role?: CompletedRealtimeVoiceTranscript["role"],
  ) => {
    if (settledItemIds.has(id)) return;
    const existing = items.get(id);
    if (existing) {
      existing.role ??= role;
      return;
    }
    order.push(id);
    items.set(id, { status: "pending", role });
  };

  const drain = () => {
    while (order.length > 0) {
      const id = order[0]!;
      const entry = items.get(id);
      if (!entry || entry.status === "pending") return;
      order.shift();
      items.delete(id);
      settledItemIds.add(id);
      if (entry.status === "completed" && entry.transcript) {
        publish(entry.transcript);
      }
    }
  };

  const skip = (id: unknown) => {
    if (typeof id !== "string" || !id) return;
    reserve(id);
    const entry = items.get(id)!;
    if (entry.status === "pending") entry.status = "skipped";
  };

  return {
    handle(event) {
      if (
        event.type === "conversation.item.added" ||
        event.type === "conversation.item.created"
      ) {
        const item = event.item;
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          if (
            record.type === "message" &&
            (record.role === "user" || record.role === "assistant") &&
            typeof record.id === "string"
          ) {
            reserve(record.id, record.role);
          }
        }
      }

      const transcript = extractCompletedRealtimeVoiceTranscript(event);
      if (transcript) {
        const transcriptId = transcript.providerId
          ? `${transcript.role}:${transcript.providerId}`
          : undefined;
        if (transcriptId && receivedTranscriptIds.has(transcriptId)) return;
        if (transcriptId) receivedTranscriptIds.add(transcriptId);
        const itemId =
          typeof event.item_id === "string" ? event.item_id : undefined;
        if (!itemId) {
          // Older providers may omit item_id. Match the first reserved slot for
          // that role so one incomplete legacy event cannot strand the queue.
          const reservedId = order.find((id) => {
            const entry = items.get(id);
            return (
              entry?.status === "pending" && entry.role === transcript.role
            );
          });
          if (reservedId) {
            items.set(reservedId, {
              status: "completed",
              role: transcript.role,
              transcript,
            });
          } else {
            publish(transcript);
          }
        } else {
          if (settledItemIds.has(itemId)) return;
          reserve(itemId, transcript.role);
          items.set(itemId, {
            status: "completed",
            role: transcript.role,
            transcript,
          });
        }
      } else if (
        event.type === "conversation.item.input_audio_transcription.failed" ||
        event.type === "conversation.item.deleted"
      ) {
        skip(event.item_id);
      } else if (event.type === "response.done") {
        const response = event.response;
        const output =
          response && typeof response === "object"
            ? (response as { output?: unknown }).output
            : undefined;
        if (Array.isArray(output)) {
          for (const item of output) {
            if (!item || typeof item !== "object") continue;
            const record = item as Record<string, unknown>;
            if (record.type === "message") skip(record.id);
          }
        }
      }
      drain();
    },
    reset() {
      order.length = 0;
      items.clear();
      settledItemIds.clear();
      receivedTranscriptIds.clear();
    },
  };
}

export function createRealtimeVoiceGreetingEvent(): Record<string, unknown> {
  return {
    type: "response.create",
    response: {
      output_modalities: ["audio"],
      instructions:
        'Say exactly: "How can I help you?" Do not add anything else.',
      // Do not set max_output_tokens here. Realtime counts assistant audio at
      // roughly one token per 50 ms, so a text-sized cap can cut speech off.
      // The exact-response instruction already keeps this greeting bounded.
    },
  };
}

export function createRealtimeVoiceGreetingStarter(
  send: (event: Record<string, unknown>) => void,
): { start: () => boolean; reset: () => void } {
  let started = false;
  return {
    start() {
      if (started) return false;
      started = true;
      send(createRealtimeVoiceGreetingEvent());
      return true;
    },
    reset() {
      started = false;
    },
  };
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

export function isRealtimeVoiceSetupRequiredError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as { status?: unknown }).status === 409,
  );
}

export function createRealtimeVoiceConnectionTimeout(
  onTimeout: () => void,
  timeoutMs = REALTIME_VOICE_CONNECTION_TIMEOUT_MS,
): () => void {
  const timeout = window.setTimeout(onTimeout, timeoutMs);
  return () => window.clearTimeout(timeout);
}

export function createRealtimeVoiceConnectionGate(
  onTimeout: () => void,
  timeoutMs = REALTIME_VOICE_CONNECTION_TIMEOUT_MS,
): {
  markTransportReady: () => void;
  markSessionCreated: () => void;
  cancel: () => void;
} {
  const cancel = createRealtimeVoiceConnectionTimeout(onTimeout, timeoutMs);
  return {
    // RTC connectivity alone is not enough: the session may never finish its
    // Realtime handshake. Keep the deadline armed until session.created.
    markTransportReady() {},
    markSessionCreated: cancel,
    cancel,
  };
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

interface RealtimeVoiceSessionOptions {
  browserTabId?: string;
  signal?: AbortSignal;
  preferences?: RealtimeVoicePreferences;
  browserLanguages?: readonly string[];
}

export async function createRealtimeVoiceSessionWithCapability(
  offerSdp: string,
  options: RealtimeVoiceSessionOptions = {},
): Promise<RealtimeVoiceSessionAnswer> {
  const preferences = options.preferences;
  const response = await fetch(agentNativePath(REALTIME_VOICE_SESSION_PATH), {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/sdp",
      ...(options.browserTabId
        ? { "X-Agent-Native-Browser-Tab": options.browserTabId }
        : {}),
      ...(preferences
        ? {
            "X-Agent-Native-Realtime-Language": resolveRealtimeVoiceLanguage(
              preferences.language,
              options.browserLanguages,
            ),
            "X-Agent-Native-Realtime-Intelligence": preferences.intelligence,
            "X-Agent-Native-Realtime-Voice": preferences.voice,
          }
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
  const sdp = await response.text();
  const capability = response.headers.get(REALTIME_VOICE_CAPABILITY_HEADER);
  return {
    sdp,
    ...(capability ? { capability } : {}),
  };
}

/** Backwards-compatible SDP-only session helper for existing client callers. */
export async function createRealtimeVoiceSession(
  offerSdp: string,
  options: RealtimeVoiceSessionOptions = {},
): Promise<string> {
  return (await createRealtimeVoiceSessionWithCapability(offerSdp, options))
    .sdp;
}

export async function executeRealtimeVoiceTool(input: {
  name: string;
  args: Record<string, unknown>;
  callId: string;
  sessionId?: string;
  browserTabId?: string;
  capability?: string;
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
      ...(input.capability
        ? { [REALTIME_VOICE_CAPABILITY_HEADER]: input.capability }
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

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizeRealtimeVoiceFunctionTool(
  value: unknown,
): RealtimeVoiceFunctionTool | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.type !== "function" ||
    typeof record.name !== "string" ||
    !REALTIME_VOICE_TOOL_NAME.test(record.name)
  ) {
    return null;
  }
  if (
    record.description !== undefined &&
    typeof record.description !== "string"
  ) {
    return null;
  }
  if (
    record.parameters !== undefined &&
    (!record.parameters ||
      typeof record.parameters !== "object" ||
      Array.isArray(record.parameters))
  ) {
    return null;
  }
  try {
    if (jsonByteLength(record) > REALTIME_VOICE_MAX_TOOL_SCHEMA_BYTES) {
      return null;
    }
    return JSON.parse(JSON.stringify(record)) as RealtimeVoiceFunctionTool;
  } catch {
    return null;
  }
}

export function extractRealtimeVoiceSessionTools(
  event: RealtimeServerEvent,
): RealtimeVoiceFunctionTool[] | null {
  if (event.type !== "session.created" && event.type !== "session.updated") {
    return null;
  }
  const session = event.session;
  if (!session || typeof session !== "object") return null;
  const tools = (session as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return null;
  return tools
    .map(normalizeRealtimeVoiceFunctionTool)
    .filter((tool): tool is RealtimeVoiceFunctionTool => Boolean(tool));
}

function createRealtimeVoiceToolManifestUpdate(
  tools: RealtimeVoiceFunctionTool[],
  eventId?: string,
): Record<string, unknown> {
  return {
    type: "session.update",
    ...(eventId ? { event_id: eventId } : {}),
    session: {
      type: "realtime",
      tools,
      tool_choice: "auto",
    },
  };
}

/**
 * Merge search-discovered schemas into the live manifest. Pinned navigation
 * and discovery tools stay available, then the newest discoveries take the
 * remaining slots ahead of lower-priority tools from the original manifest.
 */
export function mergeRealtimeVoiceToolManifest(
  currentTools: readonly RealtimeVoiceFunctionTool[],
  expandedTools: readonly RealtimeVoiceFunctionTool[],
): RealtimeVoiceFunctionTool[] {
  const current = new Map<string, RealtimeVoiceFunctionTool>();
  for (const value of currentTools) {
    const tool = normalizeRealtimeVoiceFunctionTool(value);
    if (tool) current.set(tool.name, tool);
  }
  const expanded = new Map<string, RealtimeVoiceFunctionTool>();
  for (const value of expandedTools) {
    const tool = normalizeRealtimeVoiceFunctionTool(value);
    if (tool) expanded.set(tool.name, tool);
  }

  const candidates: RealtimeVoiceFunctionTool[] = [];
  const seen = new Set<string>();
  const add = (tool: RealtimeVoiceFunctionTool | undefined) => {
    if (!tool || seen.has(tool.name)) return;
    seen.add(tool.name);
    candidates.push(tool);
  };
  for (const name of REALTIME_VOICE_PRIORITY_TOOL_NAMES) {
    add(expanded.get(name) ?? current.get(name));
  }
  for (const tool of expanded.values()) add(tool);
  for (const tool of current.values()) add(tool);

  const packed: RealtimeVoiceFunctionTool[] = [];
  for (const tool of candidates) {
    if (packed.length >= REALTIME_VOICE_MAX_TOOLS) break;
    const candidate = [...packed, tool];
    if (
      jsonByteLength(
        createRealtimeVoiceToolManifestUpdate(
          candidate,
          "realtime_tool_manifest_999999999",
        ),
      ) <= REALTIME_VOICE_MAX_SESSION_BYTES
    ) {
      packed.push(tool);
    }
  }
  return packed;
}

function createRealtimeVoiceToolResultEvent(
  result: RealtimeVoiceToolResult,
): Record<string, unknown> {
  const modelResult = {
    callId: result.callId,
    status: result.status,
    output: result.output,
    ...(result.approvalKey ? { approvalKey: result.approvalKey } : {}),
  };
  return {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: result.callId,
      output: JSON.stringify(modelResult),
    },
  };
}

export interface RealtimeVoiceToolManifestCoordinator {
  enqueue: (result: RealtimeVoiceToolResult) => void;
  setSessionTools: (tools: readonly RealtimeVoiceFunctionTool[]) => void;
  handleError: (eventId: string | undefined, message?: string) => boolean;
  reset: () => void;
  getTools: () => readonly RealtimeVoiceFunctionTool[];
}

/**
 * Realtime treats `session.update.tools` as a full replacement. Serialize
 * discovery updates and wait for a confirming `session.updated` manifest
 * before returning the search result and allowing the next model response.
 */
export function createRealtimeVoiceToolManifestCoordinator(
  send: (event: Record<string, unknown>) => void,
  timeoutMs = REALTIME_VOICE_TOOL_UPDATE_TIMEOUT_MS,
): RealtimeVoiceToolManifestCoordinator {
  let currentTools: RealtimeVoiceFunctionTool[] = [];
  const queue: RealtimeVoiceToolResult[] = [];
  let updateSequence = 0;
  let active:
    | {
        result: RealtimeVoiceToolResult;
        expectedNames: string[];
        eventId: string;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;

  const finish = (failureMessage?: string) => {
    if (!active) return;
    const { result, timer } = active;
    clearTimeout(timer);
    active = undefined;
    send(
      createRealtimeVoiceToolResultEvent(
        failureMessage
          ? {
              callId: result.callId,
              status: "failed",
              output: `${failureMessage} The discovered tools were not added to this voice session. Original tool result: ${result.output}`,
            }
          : result,
      ),
    );
    send({ type: "response.create" });
    drain();
  };

  const drain = () => {
    if (active) return;
    const result = queue.shift();
    if (!result) return;
    const expanded = Array.isArray(result.expandedTools)
      ? result.expandedTools
          .map(normalizeRealtimeVoiceFunctionTool)
          .filter((tool): tool is RealtimeVoiceFunctionTool => Boolean(tool))
      : [];
    if (result.status !== "completed" || expanded.length === 0) {
      send(createRealtimeVoiceToolResultEvent(result));
      send({ type: "response.create" });
      drain();
      return;
    }

    const merged = mergeRealtimeVoiceToolManifest(currentTools, expanded);
    const mergedNames = new Set(merged.map((tool) => tool.name));
    const expectedNames = expanded
      .map((tool) => tool.name)
      .filter((name) => mergedNames.has(name));
    if (expectedNames.length === 0) {
      send(createRealtimeVoiceToolResultEvent(result));
      send({ type: "response.create" });
      drain();
      return;
    }

    const eventId = `realtime_tool_manifest_${++updateSequence}`;
    active = {
      result,
      expectedNames,
      eventId,
      timer: setTimeout(
        () => finish("Timed out while installing the discovered tools."),
        timeoutMs,
      ),
    };
    send(createRealtimeVoiceToolManifestUpdate(merged, eventId));
  };

  return {
    enqueue(result) {
      queue.push(result);
      drain();
    },
    setSessionTools(tools) {
      currentTools = mergeRealtimeVoiceToolManifest([], tools);
      if (!active) return;
      const names = new Set(currentTools.map((tool) => tool.name));
      if (active.expectedNames.every((name) => names.has(name))) finish();
    },
    handleError(eventId, message) {
      if (!active || !eventId || active.eventId !== eventId) return false;
      finish(message || "The provider rejected the discovered tool update.");
      return true;
    },
    reset() {
      if (active) clearTimeout(active.timer);
      active = undefined;
      queue.length = 0;
      currentTools = [];
    },
    getTools() {
      return currentTools;
    },
  };
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

export function listenForRealtimeVoicePageHide(
  cleanup: () => void,
): () => void {
  window.addEventListener("pagehide", cleanup);
  return () => window.removeEventListener("pagehide", cleanup);
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
    voiceSettings: t("agentPanel.voiceMode.voiceSettings"),
    settings: {
      language: t("agentPanel.voiceMode.settings.language"),
      autoLanguage: t("agentPanel.voiceMode.settings.autoLanguage"),
      languages: {
        en: t("agentPanel.voiceMode.settings.languages.en"),
        es: t("agentPanel.voiceMode.settings.languages.es"),
        fr: t("agentPanel.voiceMode.settings.languages.fr"),
        de: t("agentPanel.voiceMode.settings.languages.de"),
        it: t("agentPanel.voiceMode.settings.languages.it"),
        pt: t("agentPanel.voiceMode.settings.languages.pt"),
        ja: t("agentPanel.voiceMode.settings.languages.ja"),
        ko: t("agentPanel.voiceMode.settings.languages.ko"),
        zh: t("agentPanel.voiceMode.settings.languages.zh"),
      },
      intelligence: t("agentPanel.voiceMode.settings.intelligence"),
      intelligenceLevels: {
        instant: t("agentPanel.voiceMode.settings.intelligenceLevels.instant"),
        balanced: t(
          "agentPanel.voiceMode.settings.intelligenceLevels.balanced",
        ),
        deep: t("agentPanel.voiceMode.settings.intelligenceLevels.deep"),
      },
      voiceStyle: t("agentPanel.voiceMode.settings.voiceStyle"),
      microphone: t("agentPanel.voiceMode.settings.microphone"),
      defaultMicrophone: t("agentPanel.voiceMode.settings.defaultMicrophone"),
      microphoneSwitchFailed: t(
        "agentPanel.voiceMode.settings.microphoneSwitchFailed",
      ),
      voiceChangePending: t("agentPanel.voiceMode.settings.voiceChangePending"),
      voiceDescriptions: {
        marin: t("agentPanel.voiceMode.settings.voiceDescriptions.marin"),
        cedar: t("agentPanel.voiceMode.settings.voiceDescriptions.cedar"),
        coral: t("agentPanel.voiceMode.settings.voiceDescriptions.coral"),
        sage: t("agentPanel.voiceMode.settings.voiceDescriptions.sage"),
        verse: t("agentPanel.voiceMode.settings.voiceDescriptions.verse"),
        alloy: t("agentPanel.voiceMode.settings.voiceDescriptions.alloy"),
        ash: t("agentPanel.voiceMode.settings.voiceDescriptions.ash"),
        ballad: t("agentPanel.voiceMode.settings.voiceDescriptions.ballad"),
        echo: t("agentPanel.voiceMode.settings.voiceDescriptions.echo"),
        shimmer: t("agentPanel.voiceMode.settings.voiceDescriptions.shimmer"),
      },
    },
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
      connectionTimedOut: t("agentPanel.voiceMode.errors.connectionTimedOut"),
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
  const [preferences, setPreferences] = useState(
    DEFAULT_REALTIME_VOICE_PREFERENCES,
  );
  const [voiceChangePending, setVoiceChangePending] = useState(false);
  const [microphones, setMicrophones] = useState<RealtimeVoiceMicrophone[]>([]);
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState(
    readRealtimeVoiceMicrophoneId,
  );
  const [microphoneSwitching, setMicrophoneSwitching] = useState(false);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const [audioLevels] = useState(createRealtimeVoiceAudioLevelStore);
  const stateRef = useRef(state);
  const preferencesRef = useRef(preferences);
  const hasOutputAudioRef = useRef(false);
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
  const connectionGateRef = useRef<ReturnType<
    typeof createRealtimeVoiceConnectionGate
  > | null>(null);
  const handledCallsRef = useRef(new Set<string>());
  const sessionIdRef = useRef<string | undefined>(undefined);
  const capabilityRef = useRef<string | undefined>(undefined);
  const transportGenerationRef = useRef(0);
  const startedAtRef = useRef<string | undefined>(undefined);
  const lastUserTextRef = useRef("");
  const lastAssistantTextRef = useRef("");
  const transcriptThreadIdRef = useRef<string | undefined>(undefined);
  const transcriptSequenceRef = useRef(0);
  const preferencesHydratedRef = useRef(false);
  const preferencesEditedRef = useRef(false);
  const preferenceWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const toolManifestCoordinator = useMemo(
    () =>
      createRealtimeVoiceToolManifestCoordinator((event) => {
        sendDataChannelEvent(channelRef.current, event);
      }),
    [],
  );
  const switchMicrophoneRef = useRef<
    (deviceId: string, force?: boolean) => Promise<void>
  >(async () => undefined);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  const hydratePreferences = useCallback(async () => {
    if (preferencesHydratedRef.current) return;
    try {
      const stored = await readClientAppState(REALTIME_VOICE_PREFERENCES_KEY);
      if (!preferencesEditedRef.current && stored != null) {
        const next = normalizeRealtimeVoicePreferences(stored);
        preferencesRef.current = next;
        setPreferences(next);
      }
    } catch {
      // Preferences are optional; keep safe defaults when storage is unavailable.
    } finally {
      preferencesHydratedRef.current = true;
    }
  }, []);

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
              preferences: preferencesRef.current,
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

  const savePreferences = useCallback((next: RealtimeVoicePreferences) => {
    preferencesEditedRef.current = true;
    preferencesHydratedRef.current = true;
    preferencesRef.current = next;
    setPreferences(next);
    preferenceWriteChainRef.current = preferenceWriteChainRef.current
      .catch(() => undefined)
      .then(async () => {
        await setClientAppState(REALTIME_VOICE_PREFERENCES_KEY, next, {
          requestSource: REALTIME_VOICE_REQUEST_SOURCE,
        });
      })
      .catch(() => undefined);
  }, []);

  const updateLivePreferences = useCallback(
    (next: RealtimeVoicePreferences, includeVoice = false) => {
      sendDataChannelEvent(
        channelRef.current,
        createRealtimeVoicePreferenceUpdate(next, {
          browserLanguages:
            typeof navigator === "undefined" ? [] : navigator.languages,
          includeVoice,
        }),
      );
    },
    [],
  );

  const setLanguage = useCallback(
    (language: RealtimeVoiceLanguage) => {
      const next = { ...preferencesRef.current, language };
      savePreferences(next);
      updateLivePreferences(next);
    },
    [savePreferences, updateLivePreferences],
  );

  const setIntelligence = useCallback(
    (intelligence: RealtimeVoiceIntelligence) => {
      const next = { ...preferencesRef.current, intelligence };
      savePreferences(next);
      updateLivePreferences(next);
    },
    [savePreferences, updateLivePreferences],
  );

  const setVoice = useCallback(
    (voice: RealtimeVoice) => {
      const next = { ...preferencesRef.current, voice };
      savePreferences(next);
      if (hasOutputAudioRef.current) {
        setVoiceChangePending(true);
        updateLivePreferences(next);
        return;
      }
      setVoiceChangePending(false);
      updateLivePreferences(next, true);
    },
    [savePreferences, updateLivePreferences],
  );

  const refreshMicrophones = useCallback(async (): Promise<
    RealtimeVoiceMicrophone[] | null
  > => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return null;
    try {
      const devices = await mediaDevices.enumerateDevices();
      const inputs = devices
        .filter(
          (device) =>
            device.kind === "audioinput" &&
            device.deviceId &&
            device.deviceId !== "default" &&
            device.deviceId !== "communications",
        )
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        }));
      setMicrophones(inputs);
      return inputs;
    } catch {
      // Enumeration is progressive enhancement; system default remains usable.
      return null;
    }
  }, []);

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

  const setMicrophone = useCallback(
    async (deviceId: string, force = false) => {
      if ((!force && deviceId === microphoneDeviceId) || microphoneSwitching) {
        return;
      }
      const mediaDevices = navigator.mediaDevices;
      const peer = peerRef.current;
      if (!mediaDevices?.getUserMedia || !peer) return;

      setMicrophoneSwitching(true);
      setMicrophoneError(null);
      try {
        const replacementStream = await replaceRealtimeVoiceMicrophone({
          mediaDevices,
          peer,
          currentStream: streamRef.current,
          deviceId,
        });
        const replacementTrack = replacementStream.getAudioTracks()[0];
        streamRef.current = replacementStream;
        if (replacementTrack) {
          replacementTrack.onended = () => {
            void switchMicrophoneRef.current("default", true);
          };
        }
        attachAudioMeter(streamRef.current, "input");
        writeRealtimeVoiceMicrophoneId(deviceId);
        setMicrophoneDeviceId(deviceId);
        await refreshMicrophones();
      } catch {
        setMicrophoneError(
          copy?.settings.microphoneSwitchFailed ??
            "Could not switch microphones. Your current microphone is still active.",
        );
      } finally {
        setMicrophoneSwitching(false);
      }
    },
    [
      attachAudioMeter,
      copy,
      microphoneDeviceId,
      microphoneSwitching,
      refreshMicrophones,
    ],
  );
  switchMicrophoneRef.current = setMicrophone;

  const cleanupTransport = useCallback(() => {
    connectionGateRef.current?.cancel();
    connectionGateRef.current = null;
    transportGenerationRef.current += 1;
    capabilityRef.current = undefined;
    abortRef.current?.abort();
    abortRef.current = null;
    channelRef.current?.close();
    channelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
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
    toolManifestCoordinator.reset();
  }, [audioLevels, toolManifestCoordinator]);

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
      const transportGeneration = transportGenerationRef.current;
      const transportChannel = channelRef.current;
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
          capability: capabilityRef.current,
          signal: abortRef.current?.signal,
        });
      } catch (toolError) {
        result = {
          callId: call.callId,
          status: "failed",
          output: errorMessage(toolError),
        };
      }
      if (
        transportGeneration !== transportGenerationRef.current ||
        channelRef.current !== transportChannel
      ) {
        return;
      }
      toolManifestCoordinator.enqueue(result);
    },
    [browserTabId, toolManifestCoordinator, transition],
  );

  const publishCompletedTranscript = useCallback(
    (transcript: CompletedRealtimeVoiceTranscript) => {
      const threadId = transcriptThreadIdRef.current;
      if (!threadId) return;
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

  const transcriptSequencer = useMemo(
    () => createRealtimeVoiceTranscriptSequencer(publishCompletedTranscript),
    [publishCompletedTranscript],
  );
  const greetingStarter = useMemo(
    () =>
      createRealtimeVoiceGreetingStarter((event) => {
        sendDataChannelEvent(channelRef.current, event);
      }),
    [],
  );

  const handleServerEvent = useCallback(
    (event: RealtimeServerEvent) => {
      transcriptSequencer.handle(event);
      const sessionTools = extractRealtimeVoiceSessionTools(event);
      if (sessionTools) toolManifestCoordinator.setSessionTools(sessionTools);
      if (event.type === "session.created") {
        connectionGateRef.current?.markSessionCreated();
        connectionGateRef.current = null;
        const session = event.session;
        if (session && typeof session === "object") {
          const id = (session as { id?: unknown }).id;
          if (typeof id === "string") sessionIdRef.current = id;
        }
        updateLivePreferences(preferencesRef.current, true);
        greetingStarter.start();
        transition("working");
      } else if (event.type === "input_audio_buffer.speech_started") {
        transition("listening");
      } else if (event.type === "input_audio_buffer.speech_stopped") {
        transition("working");
      } else if (event.type === "response.created") {
        // From this point onward the response is committed to audio output, so
        // changing voices risks violating Realtime's per-session voice lock.
        hasOutputAudioRef.current = true;
        lastAssistantTextRef.current = "";
        transition("working");
      } else if (event.type === "response.output_audio_transcript.delta") {
        hasOutputAudioRef.current = true;
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
        }
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
        const expansionEventId =
          detail && typeof detail === "object"
            ? ((detail as { event_id?: unknown }).event_id ?? event.event_id)
            : event.event_id;
        if (
          toolManifestCoordinator.handleError(
            typeof expansionEventId === "string" ? expansionEventId : undefined,
            message,
          )
        ) {
          return;
        }
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
      greetingStarter,
      handleFunctionCall,
      syncAppState,
      transcriptSequencer,
      transition,
      toolManifestCoordinator,
      updateLivePreferences,
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
    hasOutputAudioRef.current = false;
    greetingStarter.reset();
    setVoiceChangePending(false);
    transcriptThreadIdRef.current =
      realtimeVoiceTranscriptRegistry.activeThreadId();
    transcriptSequenceRef.current = 0;
    transcriptSequencer.reset();
    transition("connecting");
    setChatVisible(false);
    window.dispatchEvent(new Event("agent-panel:close"));

    await hydratePreferences();
    if ((stateRef.current as string) !== "connecting") return;

    const abortController = new AbortController();
    abortRef.current = abortController;
    const isCurrentAttempt = () =>
      abortRef.current === abortController && !abortController.signal.aborted;
    const connectionGate = createRealtimeVoiceConnectionGate(() => {
      if (!isCurrentAttempt()) return;
      fail(
        copy?.errors.connectionTimedOut ??
          "The realtime voice connection timed out.",
      );
    });
    connectionGateRef.current = connectionGate;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: createRealtimeVoiceAudioConstraints(
          readRealtimeVoiceMicrophoneId(),
        ),
      });
      if (!isCurrentAttempt()) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          void switchMicrophoneRef.current("default", true);
        };
      }
      attachAudioMeter(stream, "input");
      void refreshMicrophones().then((inputs) => {
        const selected = readRealtimeVoiceMicrophoneId();
        if (
          inputs &&
          selected !== "default" &&
          !inputs.some((device) => device.deviceId === selected)
        ) {
          // The persisted device was only an ideal preference, so getUserMedia
          // already selected a usable fallback for this new session.
          writeRealtimeVoiceMicrophoneId("default");
          setMicrophoneDeviceId("default");
        }
      });

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
      channel.onopen = connectionGate.markTransportReady;
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
        if (peer.connectionState === "connected") {
          connectionGate.markTransportReady();
        }
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
      const answer = await createRealtimeVoiceSessionWithCapability(offer.sdp, {
        browserTabId,
        signal: abortController.signal,
        preferences: preferencesRef.current,
        browserLanguages: navigator.languages,
      });
      if (!isCurrentAttempt()) return;
      capabilityRef.current = answer.capability;
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
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
      if (isRealtimeVoiceSetupRequiredError(startError)) {
        // Credentials can disappear after the entry-point status check. Treat
        // the authoritative setup response as a gate, not as an active voice
        // session failure: clean up the mic/RTC attempt, reopen chat, and
        // refresh both the chat and voice provider setup surfaces.
        cleanupTransport();
        setError(null);
        startedAtRef.current = undefined;
        sessionIdRef.current = undefined;
        transcriptThreadIdRef.current = undefined;
        transition("idle");
        setChatVisible(true);
        window.dispatchEvent(new Event("agent-panel:open"));
        window.dispatchEvent(new Event("agent-engine:configured-changed"));
        return;
      }
      const status = (startError as { status?: unknown })?.status;
      fail(errorMessage(startError), { openKeySettings: status === 400 });
    }
  }, [
    attachAudioMeter,
    browserTabId,
    cleanupTransport,
    copy,
    fail,
    greetingStarter,
    handleServerEvent,
    hydratePreferences,
    refreshMicrophones,
    transcriptSequencer,
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
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => {
      const selected = readRealtimeVoiceMicrophoneId();
      void refreshMicrophones().then((inputs) => {
        if (
          inputs &&
          selected !== "default" &&
          !inputs.some((device) => device.deviceId === selected)
        ) {
          void setMicrophone("default");
        }
      });
    };
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () =>
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshMicrophones, setMicrophone]);

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

  useEffect(() => {
    const stopListening = listenForRealtimeVoicePageHide(cleanupTransport);
    return () => {
      stopListening();
      cleanupTransport();
    };
  }, [cleanupTransport]);

  return {
    state,
    active: state !== "idle",
    errorMessage: error,
    chatVisible,
    audioLevels,
    preferences,
    microphones,
    microphoneDeviceId,
    microphoneSwitching,
    microphoneError,
    voiceChangePending,
    setLanguage,
    setIntelligence,
    setVoice,
    setMicrophone,
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
  const inlineSettings = useMemo(
    () => ({
      dialogLabel: copy.voiceSettings,
      ...(voice.voiceChangePending
        ? { appliesNextConversationNote: copy.settings.voiceChangePending }
        : {}),
      ...(voice.microphoneError
        ? { microphoneError: voice.microphoneError }
        : {}),
      microphone: {
        label: copy.settings.microphone,
        value: voice.microphoneDeviceId,
        disabled: voice.microphoneSwitching,
        options: [
          {
            value: "default",
            label: copy.settings.defaultMicrophone,
          },
          ...voice.microphones.map((microphone) => ({
            value: microphone.deviceId,
            label: microphone.label,
          })),
        ],
        onValueChange: (value: string) => {
          void voice.setMicrophone(value);
        },
      },
      language: {
        label: copy.settings.language,
        value: voice.preferences.language,
        options: REALTIME_VOICE_LANGUAGES.map((language) => ({
          value: language,
          label:
            language === "auto"
              ? copy.settings.autoLanguage
              : copy.settings.languages[language],
        })),
        onValueChange: (value: string) => {
          if (isOneOf(REALTIME_VOICE_LANGUAGES, value)) {
            voice.setLanguage(value);
          }
        },
      },
      intelligence: {
        label: copy.settings.intelligence,
        value: voice.preferences.intelligence,
        options: REALTIME_VOICE_INTELLIGENCE_LEVELS.map((intelligence) => ({
          value: intelligence,
          label: copy.settings.intelligenceLevels[intelligence],
        })),
        onValueChange: (value: string) => {
          if (isOneOf(REALTIME_VOICE_INTELLIGENCE_LEVELS, value)) {
            voice.setIntelligence(value);
          }
        },
      },
      voiceStyle: {
        label: copy.settings.voiceStyle,
        value: voice.preferences.voice,
        options: REALTIME_VOICES.map((voiceName) => ({
          value: voiceName,
          label: `${voiceName[0]!.toUpperCase()}${voiceName.slice(1)}`,
          description: copy.settings.voiceDescriptions[voiceName],
        })),
        onValueChange: (value: string) => {
          if (isOneOf(REALTIME_VOICES, value)) voice.setVoice(value);
        },
      },
    }),
    [copy, voice],
  );

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
              settings={inlineSettings}
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
