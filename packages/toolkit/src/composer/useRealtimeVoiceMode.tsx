import { TranscriptGrouper, type TranscriptSegment } from "openai/helpers/live";
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

import {
  createRealtimeVoiceAudioLevelStore,
  normalizeRealtimeVoiceRms,
  smoothRealtimeVoiceLevel,
  type RealtimeVoiceAudioLevelStore,
} from "./realtime-voice-audio-level.js";
import {
  realtimeVoiceTranscriptRegistry,
  type RealtimeVoiceWorkCall,
} from "./realtime-voice-transcript.js";
import { createRealtimeVoiceTurnMetrics } from "./realtime-voice-turn-metrics.js";
import type {
  RealtimeVoiceModeCopy,
  RealtimeVoiceModeInlineSettings,
  RealtimeVoiceModeState,
} from "./RealtimeVoiceMode.js";
import {
  type ComposerTranslate,
  useComposerRuntimeAdapters,
} from "./runtime-adapters.js";
import {
  isMicrophoneAccessError,
  voiceDictationStartErrorMessage,
} from "./useVoiceDictation.js";

const REALTIME_VOICE_STATE_KEY = "realtime-voice-session";
export const REALTIME_VOICE_PREFERENCES_KEY = "realtime-voice-prefs";

const REALTIME_VOICE_SESSION_PATH = "/_agent-native/realtime-voice/session";
const REALTIME_VOICE_TOOL_PATH = "/_agent-native/realtime-voice/tool";
const REALTIME_VOICE_CAPABILITY_HEADER = "X-Agent-Native-Realtime-Capability";
const REALTIME_VOICE_PROTOCOL_HEADER = "X-Agent-Native-Realtime-Protocol";
const REALTIME_VOICE_MODEL_HEADER = "X-Agent-Native-Realtime-Model";
const REALTIME_VOICE_INTELLIGENCE_HEADER =
  "X-Agent-Native-Realtime-Intelligence";
const REALTIME_VOICE_PRIORITY_TOOLS_HEADER =
  "X-Agent-Native-Realtime-Priority-Tools";
const REALTIME_VOICE_CONNECTION_TIMEOUT_MS = 15_000;
const REALTIME_VOICE_MAX_TOOLS = 32;
const REALTIME_VOICE_MAX_TOOL_SCHEMA_BYTES = 32_000;
const REALTIME_VOICE_MAX_SESSION_BYTES = 64_000;
const REALTIME_VOICE_TOOL_UPDATE_TIMEOUT_MS = 5_000;
const REALTIME_VOICE_LIVE_CLOSE_DRAIN_TIMEOUT_MS = 2_000;
const REALTIME_VOICE_PRIORITY_TOOL_NAMES = [
  "navigate",
  "set-url-path",
  "set-search-params",
  "view-screen",
  "chat-history",
  "tool-search",
  "web-search",
  "web-request",
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
export type RealtimeVoiceProtocol = "live" | "realtime";

export interface RealtimeVoicePreferences {
  language: RealtimeVoiceLanguage;
  intelligence: RealtimeVoiceIntelligence;
  voice: RealtimeVoice;
  /**
   * False until the user picks a level; until then the app's default applies.
   * Omitted means `intelligence` was chosen.
   */
  intelligenceChosen?: boolean;
}

export const DEFAULT_REALTIME_VOICE_PREFERENCES: RealtimeVoicePreferences = {
  language: "auto",
  intelligence: "instant",
  voice: "marin",
  intelligenceChosen: false,
};

export const REALTIME_VOICE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  deviceId: { ideal: "default" },
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

type RealtimeServerEvent = Record<string, unknown> & { type?: string };

function normalizeRealtimeVoiceResponseEvent(
  event: RealtimeServerEvent,
): RealtimeServerEvent {
  const nestedEvent = event.event;
  return event.type === "response.event" &&
    nestedEvent &&
    typeof nestedEvent === "object" &&
    !Array.isArray(nestedEvent)
    ? (nestedEvent as RealtimeServerEvent)
    : event;
}

export interface RealtimeVoiceToolResult {
  callId: string;
  status: "completed" | "failed" | "approval_required";
  output: string;
  approvalKey?: string;
  approvalId?: string;
  expandedTools?: RealtimeVoiceFunctionTool[];
  capability?: string;
  readOnly?: boolean;
}

export interface RealtimeVoiceSessionAnswer {
  sdp: string;
  capability?: string;
  protocol?: RealtimeVoiceProtocol;
  model?: string;
  /** The level the session runs at, after the app's default. */
  intelligence?: RealtimeVoiceIntelligence;
  /** App edit tools the session loaded, kept through tool expansions. */
  priorityToolNames?: string[];
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
  audioLevels: RealtimeVoiceAudioLevelStore;
  /** Your microphone is sending silence. */
  inputMuted: boolean;
  /** The assistant's voice is not played back. */
  outputMuted: boolean;
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
  setInputMuted: (muted: boolean) => void;
  setOutputMuted: (muted: boolean) => void;
  start: (options?: RealtimeVoiceStartOptions) => Promise<void>;
  end: () => void;
  /** Clears a failed session so voice chat can start again. */
  dismissError: () => void;
  /** The tool running now, latest first started; null while none runs. */
  currentToolName: string | null;
  /** Tool calls waiting for the user to approve them, oldest first. */
  approvals: readonly RealtimeVoiceApproval[];
  /** Runs an approved call and tells the assistant how it went. */
  resolveApproval: (callId: string, approved: boolean) => Promise<void>;
}

export interface RealtimeVoiceApproval {
  /** The provider's id for the call that asked. */
  callId: string;
  toolName: string;
}

export interface RealtimeVoiceStartOptions {
  /**
   * The thread that receives the session's transcripts. Defaults to the
   * thread on screen at start; pass one when the session starts before its
   * thread is shown, such as from a page that hands off to the chat.
   */
  threadId?: string;
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

export function readRealtimeVoiceMicrophoneId(): string {
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

export function writeRealtimeVoiceMicrophoneId(deviceId: string): void {
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

/** The browser's audio inputs, or null when they cannot be listed. */
export async function listRealtimeVoiceMicrophones(
  t: ComposerTranslate,
): Promise<RealtimeVoiceMicrophone[] | null> {
  const mediaDevices =
    typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!mediaDevices?.enumerateDevices) return null;
  try {
    const devices = await mediaDevices.enumerateDevices();
    return devices
      .filter(
        (device) =>
          device.kind === "audioinput" &&
          device.deviceId &&
          device.deviceId !== "default" &&
          device.deviceId !== "communications",
      )
      .map((device, index) => ({
        deviceId: device.deviceId,
        label:
          device.label ||
          t("agentChat.voiceMode.settings.microphoneNumber", {
            number: index + 1,
            defaultValue: `Microphone ${index + 1}`,
          }),
      }));
  } catch {
    // coercion-ok: null tells the caller the list is unavailable; the system default stays usable.
    return null;
  }
}

export function normalizeRealtimeVoicePreferences(
  value: unknown,
): RealtimeVoicePreferences {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const storedIntelligence = isOneOf(
    REALTIME_VOICE_INTELLIGENCE_LEVELS,
    record.intelligence,
  )
    ? record.intelligence
    : undefined;
  // Saves from before `intelligenceChosen` stored "instant" for everyone, so
  // only a non-default level among them shows a pick.
  const chosenIntelligence =
    typeof record.intelligenceChosen === "boolean"
      ? record.intelligenceChosen
        ? storedIntelligence
        : undefined
      : storedIntelligence !== DEFAULT_REALTIME_VOICE_PREFERENCES.intelligence
        ? storedIntelligence
        : undefined;
  // A level saved as not chosen is the app default a session last reported.
  const appDefaultIntelligence =
    record.intelligenceChosen === false ? storedIntelligence : undefined;
  return {
    language: isOneOf(REALTIME_VOICE_LANGUAGES, record.language)
      ? record.language
      : DEFAULT_REALTIME_VOICE_PREFERENCES.language,
    intelligence:
      chosenIntelligence ??
      appDefaultIntelligence ??
      DEFAULT_REALTIME_VOICE_PREFERENCES.intelligence,
    voice: isOneOf(REALTIME_VOICES, record.voice)
      ? record.voice
      : DEFAULT_REALTIME_VOICE_PREFERENCES.voice,
    intelligenceChosen: chosenIntelligence !== undefined,
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
  protocol?: RealtimeVoiceProtocol,
): "minimal" | "low" | "medium" | "high" {
  // The delegated Live model rejects "minimal", so its levels start at "low".
  if (protocol === "live") {
    if (intelligence === "balanced") return "medium";
    if (intelligence === "deep") return "high";
    return "low";
  }
  if (intelligence === "balanced") return "low";
  if (intelligence === "deep") return "medium";
  return "minimal";
}

export function createRealtimeVoicePreferenceUpdate(
  preferences: RealtimeVoicePreferences,
  options: {
    browserLanguages?: readonly string[];
    includeVoice?: boolean;
    protocol?: RealtimeVoiceProtocol;
  } = {},
): Record<string, unknown> {
  if (options.protocol === "live") {
    return {
      type: "session.update",
      session: {
        delegation: {
          responses: {
            reasoning: {
              effort: realtimeVoiceReasoningEffort(
                preferences.intelligence,
                options.protocol,
              ),
            },
          },
        },
      },
    };
  }
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

export function createRealtimeVoiceLanguageUpdate(
  language: RealtimeVoiceLanguage,
  browserLanguages: readonly string[] = [],
): Record<string, unknown> {
  const resolvedLanguage = resolveRealtimeVoiceLanguage(
    language,
    browserLanguages,
  );
  return {
    type: "session.instructions.append",
    delegation_id: null,
    content: `Speak in ${resolvedLanguage} unless the user asks to switch languages.`,
  };
}

interface RealtimeVoiceWorkSegment {
  id: string;
  threadId: string;
  /** The GPT-Live delegation the calls ran under; one delegation is one request. */
  delegationId: string | undefined;
  calls: RealtimeVoiceWorkCall[];
  /** The reply is over; the segment ends once its last call does. */
  closing: boolean;
}

function publishRealtimeVoiceWorkSegment(
  segment: RealtimeVoiceWorkSegment,
  completedAt?: string,
): void {
  if (segment.calls.length === 0) return;
  realtimeVoiceTranscriptRegistry.publishWork({
    id: segment.id,
    threadId: segment.threadId,
    calls: segment.calls.map((call) => ({ ...call })),
    ...(completedAt ? { completedAt } : {}),
  });
}

/**
 * The reply's open work a new call joins, or new work; none without a thread.
 * A call from a different delegation is a new request.
 */
function openRealtimeVoiceWorkSegment(
  ref: { current: RealtimeVoiceWorkSegment | null },
  threadId: string | undefined,
  callId: string,
  delegationId: string | undefined,
): RealtimeVoiceWorkSegment | null {
  if (!threadId) return null;
  const current = ref.current;
  if (
    current?.threadId === threadId &&
    (!current.delegationId ||
      !delegationId ||
      current.delegationId === delegationId)
  ) {
    current.delegationId ??= delegationId;
    return current;
  }
  if (current) closeRealtimeVoiceWorkSegment(ref, current);
  const segment = {
    id: callId,
    threadId,
    delegationId,
    calls: [],
    closing: false,
  };
  ref.current = segment;
  return segment;
}

/**
 * Ends a reply's work. It ends at its last call's completion, so the reply
 * that follows the work reads below it.
 */
interface PendingApproval {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  /** The server's approval record; a decision names exactly this one. */
  approvalId: string;
  workCall: RealtimeVoiceWorkCall;
  workSegment: RealtimeVoiceWorkSegment | null;
}

/** Ends a call that waited for approval: `result` is null when it never ran. */
function finishPendingApproval(
  pending: PendingApproval,
  result: RealtimeVoiceToolResult | null,
): void {
  const { workCall, workSegment } = pending;
  workCall.status =
    !result || result.status === "approval_required"
      ? "cancelled"
      : result.status;
  if (result) workCall.output = result.output;
  workCall.completedAt = new Date().toISOString();
  if (!workSegment) return;
  if (workSegment.closing) {
    closeRealtimeVoiceWorkSegment({ current: null }, workSegment);
  } else {
    publishRealtimeVoiceWorkSegment(workSegment);
  }
}

function closeRealtimeVoiceWorkSegment(
  ref: { current: RealtimeVoiceWorkSegment | null },
  segment: RealtimeVoiceWorkSegment | null = ref.current,
): void {
  if (!segment) return;
  if (ref.current === segment) ref.current = null;
  segment.closing = true;
  if (segment.calls.some((call) => call.status === "running")) return;
  const completedAt = segment.calls
    .map((call) => call.completedAt ?? call.startedAt)
    .sort()
    .at(-1);
  publishRealtimeVoiceWorkSegment(segment, completedAt);
}

export interface CompletedRealtimeVoiceTranscript {
  role: "user" | "assistant";
  text: string;
  providerId?: string;
}

export interface RealtimeVoiceTranscriptSequencer {
  handle: (event: RealtimeServerEvent) => void;
  flush: () => void;
  reset: (options?: { preserveQueuedTranscripts?: boolean }) => void;
}

/**
 * A GPT-Live turn as the transcript grouper sees it. Declared here so the
 * toolkit's public types never pull in the OpenAI SDK's Node globals.
 */
export interface RealtimeVoiceLiveTurn {
  id: string;
  speaker: CompletedRealtimeVoiceTranscript["role"];
  text: string;
  startMs: number;
  endMs: number;
}

interface SequencedRealtimeVoiceTranscript {
  status: "pending" | "completed" | "skipped";
  role?: CompletedRealtimeVoiceTranscript["role"];
  transcript?: CompletedRealtimeVoiceTranscript;
}

/**
 * Orders provider transcripts into conversation order. `publish` receives each
 * final transcript; `stream`, when given, receives the growing text of a turn
 * under the same `providerId` its final transcript will carry. GPT-Live turns
 * come from the SDK's transcript grouper, which splits on speaker changes and
 * two-second silences and drops short backchannels heard over the reply.
 */
export function createRealtimeVoiceTranscriptSequencer(
  publish: (transcript: CompletedRealtimeVoiceTranscript) => void,
  stream?: (transcript: CompletedRealtimeVoiceTranscript) => void,
  /** Each GPT-Live turn as it grows, with its place on the session clock. */
  onLiveTurn?: (turn: RealtimeVoiceLiveTurn) => void,
): RealtimeVoiceTranscriptSequencer {
  const order: string[] = [];
  const items = new Map<string, SequencedRealtimeVoiceTranscript>();
  const settledItemIds = new Set<string>();
  const receivedTranscriptIds = new Set<string>();
  const streamingText = new Map<string, string>();
  const streamedText = new Map<string, string>();
  let liveGrouper: TranscriptGrouper | undefined;

  const liveTranscript = (segment: TranscriptSegment) => {
    const text = segment.text.trim();
    if (!text) return undefined;
    return stream
      ? { role: segment.speaker, text, providerId: segment.id }
      : { role: segment.speaker, text };
  };

  // Listeners check that their grouper is still current, so a discarded one
  // never publishes what it closes on the way out.
  const openLiveGrouper = () => {
    if (liveGrouper) return liveGrouper;
    const grouper = new TranscriptGrouper();
    grouper.on("segment.updated", (segment) => {
      if (grouper !== liveGrouper) return;
      onLiveTurn?.(segment);
      const transcript = liveTranscript(segment);
      if (stream && transcript) stream(transcript);
    });
    grouper.on("segment.closed", ({ segment }) => {
      const transcript = liveTranscript(segment);
      if (grouper === liveGrouper && transcript) publish(transcript);
    });
    liveGrouper = grouper;
    return grouper;
  };

  const closeLiveGrouper = (keepText: boolean) => {
    const grouper = liveGrouper;
    if (!grouper) return;
    if (!keepText) liveGrouper = undefined;
    grouper.close();
    liveGrouper = undefined;
  };

  // A turn appears once every earlier turn has appeared, so a fast reply
  // never streams in above the question it answers.
  const emitStreams = () => {
    if (!stream) return;
    for (const id of order) {
      const entry = items.get(id);
      if (!entry || entry.status === "skipped") continue;
      const text =
        entry.status === "completed"
          ? entry.transcript?.text
          : streamingText.get(id)?.trim();
      const role = entry.transcript?.role ?? entry.role;
      if (!text || !role) return;
      if (streamedText.get(id) === text) continue;
      streamedText.set(id, text);
      stream({
        role,
        text,
        providerId: entry.transcript?.providerId ?? id,
      });
    }
  };

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
      streamingText.delete(id);
      streamedText.delete(id);
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
        event.type === "session.input_transcript.delta" ||
        event.type === "session.output_transcript.delta"
      ) {
        const type =
          event.type === "session.input_transcript.delta"
            ? "session.input_transcript.delta"
            : "session.output_transcript.delta";
        const { event_id, delta, start_ms, end_ms } = event;
        if (
          typeof event_id !== "string" ||
          typeof delta !== "string" ||
          typeof start_ms !== "number" ||
          typeof end_ms !== "number"
        ) {
          throw new Error(
            "GPT-Live sent a transcript delta without an id, text, or timing.",
          );
        }
        openLiveGrouper().push({ type, event_id, delta, start_ms, end_ms });
        return;
      }
      if (
        event.type === "conversation.item.input_audio_transcription.delta" ||
        event.type === "response.output_audio_transcript.delta"
      ) {
        const itemId =
          typeof event.item_id === "string" ? event.item_id : undefined;
        if (!itemId || settledItemIds.has(itemId)) return;
        reserve(
          itemId,
          event.type === "response.output_audio_transcript.delta"
            ? "assistant"
            : "user",
        );
        if (typeof event.delta === "string") {
          streamingText.set(
            itemId,
            (streamingText.get(itemId) ?? "") + event.delta,
          );
        }
        emitStreams();
        return;
      }
      if (event.type === "session.closed") closeLiveGrouper(true);
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
              // Keep the id the turn streamed under, so it finalizes in place.
              transcript: stream
                ? { ...transcript, providerId: reservedId }
                : transcript,
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
      emitStreams();
    },
    flush() {
      closeLiveGrouper(true);
      if (!stream) return;
      // The session is over: a turn that streamed but never got its final
      // transcript keeps the text that was heard.
      for (const id of order.splice(0)) {
        const entry = items.get(id);
        items.delete(id);
        settledItemIds.add(id);
        const text =
          entry?.status === "completed"
            ? entry.transcript?.text
            : entry?.status === "pending"
              ? streamingText.get(id)?.trim()
              : undefined;
        const role = entry?.transcript?.role ?? entry?.role;
        streamingText.delete(id);
        streamedText.delete(id);
        if (text && role) {
          publish({
            role,
            text,
            providerId: entry?.transcript?.providerId ?? id,
          });
        }
      }
    },
    reset(options) {
      // A failed response leaves what was already heard; a new session
      // starts clean.
      if (options?.preserveQueuedTranscripts) return;
      closeLiveGrouper(false);
      order.length = 0;
      items.clear();
      settledItemIds.clear();
      receivedTranscriptIds.clear();
      streamingText.clear();
      streamedText.clear();
    },
  };
}

const REALTIME_VOICE_GREETING_INSTRUCTION_EVENT_ID =
  "realtime_voice_greeting_instructions";

export function createRealtimeVoiceGreetingEvent(
  protocol: RealtimeVoiceProtocol = "realtime",
): Record<string, unknown> {
  if (protocol === "live") {
    return {
      type: "session.instructions.append",
      event_id: REALTIME_VOICE_GREETING_INSTRUCTION_EVENT_ID,
      delegation_id: null,
      content:
        'Immediately say exactly: "How can I help you?" Then pause and listen.',
    };
  }
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
  initialProtocol: RealtimeVoiceProtocol = "realtime",
): {
  start: () => boolean;
  setProtocol: (protocol: RealtimeVoiceProtocol) => void;
  handleEvent: (event: RealtimeServerEvent) => void;
  reset: () => void;
} {
  let started = false;
  let commentarySent = false;
  let protocol = initialProtocol;
  return {
    start() {
      if (started) return false;
      started = true;
      send(createRealtimeVoiceGreetingEvent(protocol));
      return true;
    },
    setProtocol(nextProtocol) {
      protocol = nextProtocol;
    },
    handleEvent(event) {
      if (
        protocol !== "live" ||
        commentarySent ||
        event.type !== "session.instructions.appended"
      ) {
        return;
      }
      const clientEventId = [event.client_event_id, event.event_id].find(
        (value): value is string =>
          value === REALTIME_VOICE_GREETING_INSTRUCTION_EVENT_ID,
      );
      if (!clientEventId) return;
      commentarySent = true;
      send({
        type: "session.commentary.append",
        event_id: "realtime_voice_greeting_commentary",
        delegation_id: null,
        content:
          "Begin the conversation now, following the instructions provided.",
      });
    },
    reset() {
      started = false;
      commentarySent = false;
    },
  };
}

export interface RealtimeVoiceResponseCoordinator {
  request: (event?: Record<string, unknown>) => void;
  handleEvent: (event: RealtimeServerEvent) => void;
  handleError: (message?: string) => boolean;
  reset: () => void;
}

export function createRealtimeVoiceResponseCoordinator(
  send: (event: Record<string, unknown>) => void,
): RealtimeVoiceResponseCoordinator {
  let active = false;
  let requestInFlight = false;
  let pending: Record<string, unknown> | undefined;

  const flush = () => {
    if (active || requestInFlight || !pending) return;
    const event = pending;
    pending = undefined;
    requestInFlight = true;
    send(event);
  };

  return {
    request(event = { type: "response.create" }) {
      pending = event;
      flush();
    },
    handleEvent(event) {
      const responseEvent = normalizeRealtimeVoiceResponseEvent(event);
      if (responseEvent.type === "response.created") {
        active = true;
        requestInFlight = false;
        return;
      }
      if (
        responseEvent.type === "response.done" ||
        responseEvent.type === "response.completed" ||
        responseEvent.type === "response.cancelled" ||
        responseEvent.type === "response.failed"
      ) {
        active = false;
        requestInFlight = false;
        const response = responseEvent.response;
        const status =
          response && typeof response === "object"
            ? (response as { status?: unknown }).status
            : undefined;
        if (responseEvent.type === "response.failed" || status === "failed") {
          pending = undefined;
          return;
        }
        flush();
      }
    },
    handleError(message) {
      if (!message || !/active response.*in progress/i.test(message)) {
        return false;
      }
      pending ??= { type: "response.create" };
      requestInFlight = false;
      active = true;
      return true;
    },
    reset() {
      active = false;
      requestInFlight = false;
      pending = undefined;
    },
  };
}

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
    const detail = parsed.error ?? parsed.message;
    return typeof detail === "object" && detail !== null
      ? JSON.stringify(detail)
      : typeof detail === "string" || typeof detail === "number"
        ? String(detail)
        : raw;
  } catch {
    return raw.slice(0, 500);
  }
}

interface RealtimeVoiceSessionOptions {
  browserTabId?: string;
  signal?: AbortSignal;
  preferences?: RealtimeVoicePreferences;
  browserLanguages?: readonly string[];
  protocol?: RealtimeVoiceProtocol;
}

export async function createRealtimeVoiceSessionWithCapability(
  offerSdp: string,
  options: RealtimeVoiceSessionOptions = {},
): Promise<RealtimeVoiceSessionAnswer> {
  const preferences = options.preferences;
  const response = await fetch(REALTIME_VOICE_SESSION_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/sdp",
      ...(options.browserTabId
        ? { "X-Agent-Native-Browser-Tab": options.browserTabId }
        : {}),
      ...(options.protocol
        ? { [REALTIME_VOICE_PROTOCOL_HEADER]: options.protocol }
        : {}),
      ...(preferences
        ? {
            "X-Agent-Native-Realtime-Language": resolveRealtimeVoiceLanguage(
              preferences.language,
              options.browserLanguages,
            ),
            ...(preferences.intelligenceChosen !== false
              ? {
                  [REALTIME_VOICE_INTELLIGENCE_HEADER]:
                    preferences.intelligence,
                }
              : {}),
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
  const protocolHeader = response.headers.get(REALTIME_VOICE_PROTOCOL_HEADER);
  const protocol: RealtimeVoiceProtocol | undefined =
    protocolHeader === "live" || protocolHeader === "realtime"
      ? protocolHeader
      : undefined;
  const modelHeader = response.headers.get(REALTIME_VOICE_MODEL_HEADER);
  const model = modelHeader?.trim() || undefined;
  const intelligenceHeader = response.headers
    .get(REALTIME_VOICE_INTELLIGENCE_HEADER)
    ?.trim();
  const intelligence = isOneOf(
    REALTIME_VOICE_INTELLIGENCE_LEVELS,
    intelligenceHeader,
  )
    ? intelligenceHeader
    : undefined;
  const priorityToolNames = (
    response.headers.get(REALTIME_VOICE_PRIORITY_TOOLS_HEADER) ?? ""
  )
    .split(",")
    .map((name) => name.trim())
    .filter((name) => REALTIME_VOICE_TOOL_NAME.test(name))
    .slice(0, REALTIME_VOICE_MAX_TOOLS);
  return {
    sdp,
    ...(capability ? { capability } : {}),
    ...(protocol ? { protocol } : {}),
    ...(model ? { model } : {}),
    ...(intelligence ? { intelligence } : {}),
    ...(priorityToolNames.length > 0 ? { priorityToolNames } : {}),
  };
}

export async function createRealtimeVoiceSession(
  offerSdp: string,
  options: RealtimeVoiceSessionOptions = {},
): Promise<string> {
  return (
    await createRealtimeVoiceSessionWithCapability(offerSdp, {
      ...options,
      protocol: "realtime",
    })
  ).sdp;
}

export async function executeRealtimeVoiceTool(input: {
  name: string;
  args: Record<string, unknown>;
  callId: string;
  sessionId?: string | undefined;
  browserTabId?: string | undefined;
  capability?: string | undefined;
  signal?: AbortSignal | undefined;
  /** Runs the call this approval record was asked for, once. */
  approvalId?: string | undefined;
  /** Declines that approval record instead of running the call. */
  declinedApprovalId?: string | undefined;
}): Promise<RealtimeVoiceToolResult> {
  const response = await fetch(REALTIME_VOICE_TOOL_PATH, {
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
      ...(input.approvalId ? { approvalId: input.approvalId } : {}),
      ...(input.declinedApprovalId
        ? { declinedApprovalId: input.declinedApprovalId }
        : {}),
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
  if (
    event.type !== "session.started" &&
    event.type !== "session.created" &&
    event.type !== "session.updated"
  ) {
    return null;
  }
  const session = event.session;
  if (!session || typeof session !== "object") return null;
  const record = session as Record<string, unknown>;
  const delegation = record.delegation;
  const responses =
    delegation && typeof delegation === "object" && !Array.isArray(delegation)
      ? (delegation as { responses?: unknown }).responses
      : undefined;
  const tools =
    record.tools ??
    (responses && typeof responses === "object" && !Array.isArray(responses)
      ? (responses as { tools?: unknown }).tools
      : undefined);
  if (!Array.isArray(tools)) return null;
  return tools
    .map(normalizeRealtimeVoiceFunctionTool)
    .filter((tool): tool is RealtimeVoiceFunctionTool => Boolean(tool));
}

function createRealtimeVoiceToolManifestUpdate(
  tools: RealtimeVoiceFunctionTool[],
  eventId?: string,
  protocol: RealtimeVoiceProtocol = "realtime",
): Record<string, unknown> {
  return {
    type: "session.update",
    ...(eventId ? { event_id: eventId } : {}),
    session:
      protocol === "live"
        ? {
            delegation: {
              type: "responses",
              // Strict schemas make every optional parameter required.
              responses: {
                tools: tools.map((tool) => ({ ...tool, strict: false })),
                tool_choice: "auto",
              },
            },
          }
        : {
            type: "realtime",
            tools,
            tool_choice: "auto",
          },
  };
}

export function mergeRealtimeVoiceToolManifest(
  currentTools: readonly RealtimeVoiceFunctionTool[],
  expandedTools: readonly RealtimeVoiceFunctionTool[],
  protocol: RealtimeVoiceProtocol = "realtime",
  appPriorityToolNames: readonly string[] = [],
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
  for (const name of [
    ...REALTIME_VOICE_PRIORITY_TOOL_NAMES,
    ...appPriorityToolNames,
  ]) {
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
          protocol,
        ),
      ) <= REALTIME_VOICE_MAX_SESSION_BYTES
    ) {
      packed.push(tool);
    }
  }
  return packed;
}

/** Tells the assistant what the user decided about a call that asked. */
export function createRealtimeVoiceApprovalOutcomeEvent(
  toolName: string,
  result: RealtimeVoiceToolResult | null,
  protocol: RealtimeVoiceProtocol = "realtime",
): Record<string, unknown> {
  const text = !result
    ? `The user declined ${toolName}, so it did not run.`
    : result.status === "approval_required"
      ? `${toolName} asked for approval again, so it has not run. The user can approve it on screen.`
      : `The user approved ${toolName}. ${JSON.stringify({
          status: result.status,
          output: result.output,
        })}`;
  return {
    type:
      protocol === "live" ? "response.item.create" : "conversation.item.create",
    item: {
      type: "message",
      role: "system",
      content: [{ type: "input_text", text }],
    },
  };
}

function createRealtimeVoiceToolResultEvent(
  result: RealtimeVoiceToolResult,
  protocol: RealtimeVoiceProtocol = "realtime",
): Record<string, unknown> {
  const modelResult = {
    callId: result.callId,
    status: result.status,
    output: result.output,
    ...(result.approvalKey ? { approvalKey: result.approvalKey } : {}),
  };
  return {
    type:
      protocol === "live" ? "response.item.create" : "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: result.callId,
      output: JSON.stringify(modelResult),
    },
  };
}

export interface RealtimeVoiceToolManifestCoordinator {
  enqueue: (result: RealtimeVoiceToolResult) => void;
  setProtocol: (protocol: RealtimeVoiceProtocol) => void;
  setPriorityToolNames: (names: readonly string[]) => void;
  setSessionTools: (tools: readonly RealtimeVoiceFunctionTool[]) => void;
  handleError: (eventId: string | undefined, message?: string) => boolean;
  reset: (options?: { preserveSessionTools?: boolean }) => void;
  getTools: () => readonly RealtimeVoiceFunctionTool[];
}

export function createRealtimeVoiceToolManifestCoordinator(
  send: (event: Record<string, unknown>) => void,
  timeoutMs = REALTIME_VOICE_TOOL_UPDATE_TIMEOUT_MS,
): RealtimeVoiceToolManifestCoordinator {
  let currentTools: RealtimeVoiceFunctionTool[] = [];
  let protocol: RealtimeVoiceProtocol = "realtime";
  let priorityToolNames: readonly string[] = [];
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
        protocol,
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
      send(createRealtimeVoiceToolResultEvent(result, protocol));
      send({ type: "response.create" });
      drain();
      return;
    }

    const merged = mergeRealtimeVoiceToolManifest(
      currentTools,
      expanded,
      protocol,
      priorityToolNames,
    );
    const mergedNames = new Set(merged.map((tool) => tool.name));
    const expectedNames = expanded
      .map((tool) => tool.name)
      .filter((name) => mergedNames.has(name));
    if (expectedNames.length === 0) {
      send(createRealtimeVoiceToolResultEvent(result, protocol));
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
    send(createRealtimeVoiceToolManifestUpdate(merged, eventId, protocol));
  };

  return {
    enqueue(result) {
      queue.push(result);
      drain();
    },
    setProtocol(nextProtocol) {
      protocol = nextProtocol;
    },
    setPriorityToolNames(names) {
      priorityToolNames = [...names];
    },
    setSessionTools(tools) {
      currentTools = mergeRealtimeVoiceToolManifest(
        [],
        tools,
        protocol,
        priorityToolNames,
      );
      if (!active) return;
      const names = new Set(currentTools.map((tool) => tool.name));
      if (active.expectedNames.every((name) => names.has(name))) finish();
    },
    handleError(eventId, message) {
      if (!active || !eventId || active.eventId !== eventId) return false;
      finish(message || "The provider rejected the discovered tool update.");
      return true;
    },
    reset(options) {
      if (active) clearTimeout(active.timer);
      active = undefined;
      queue.length = 0;
      if (!options?.preserveSessionTools) {
        currentTools = [];
        priorityToolNames = [];
      }
      protocol = "realtime";
    },
    getTools() {
      return currentTools;
    },
  };
}

export function extractRealtimeVoiceFunctionCalls(
  event: RealtimeServerEvent,
): Array<{ name: string; callId: string; argumentsText: string }> {
  const nestedEvent = event.event;
  const isNestedLiveEvent =
    event.type === "response.event" &&
    nestedEvent &&
    typeof nestedEvent === "object" &&
    !Array.isArray(nestedEvent);
  const source = isNestedLiveEvent
    ? (nestedEvent as RealtimeServerEvent)
    : event;
  if (source.type === "response.function_call_arguments.done") {
    if (isNestedLiveEvent) return [];
    const name = typeof source.name === "string" ? source.name : "";
    const callId = typeof source.call_id === "string" ? source.call_id : "";
    if (!name || !callId) return [];
    return [
      {
        name,
        callId,
        argumentsText:
          typeof source.arguments === "string" ? source.arguments : "{}",
      },
    ];
  }
  if (source.type === "response.output_item.done") {
    const item = source.item;
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
  }
  if (source.type !== "response.done" && source.type !== "response.completed") {
    return [];
  }
  const response = source.response;
  if (!response || typeof response !== "object") return [];
  const status = (response as { status?: unknown }).status;
  if (status !== undefined && status !== "completed") return [];
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

export function createRealtimeVoiceModeCopy(
  t: ComposerTranslate,
): RealtimeVoiceModeCopy {
  return {
    startVoiceMode: t("agentChat.voiceMode.start", {
      defaultValue: "Start voice chat",
    }),
    endVoiceMode: t("agentChat.voiceMode.endVoiceChat", {
      defaultValue: "End voice chat",
    }),
    placeholder: t("agentChat.voiceMode.placeholder", {
      defaultValue: "Listening…",
    }),
    muteMicrophone: t("agentChat.voiceMode.muteMicrophone", {
      defaultValue: "Mute microphone",
    }),
    unmuteMicrophone: t("agentChat.voiceMode.unmuteMicrophone", {
      defaultValue: "Unmute microphone",
    }),
    muteSpeaker: t("agentChat.voiceMode.muteSpeaker", {
      defaultValue: "Mute speaker",
    }),
    unmuteSpeaker: t("agentChat.voiceMode.unmuteSpeaker", {
      defaultValue: "Unmute speaker",
    }),
    voiceSettings: t("agentChat.voiceMode.voiceSettings", {
      defaultValue: "Voice settings",
    }),
    thinking: t("agentChat.status.thinking", { defaultValue: "Thinking" }),
    approval: {
      question: (toolLabel) =>
        t("agentChat.approval.question", {
          tool: toolLabel,
          defaultValue: "Approve to run {{tool}}?",
        }),
      approve: t("agentChat.approval.approve", { defaultValue: "Approve" }),
      deny: t("agentChat.approval.deny", { defaultValue: "Deny" }),
    },
    settings: {
      language: t("agentChat.voiceMode.settings.language", {
        defaultValue: "Language",
      }),
      autoLanguage: t("agentChat.voiceMode.settings.autoLanguage", {
        defaultValue: "Auto",
      }),
      languages: {
        en: t("agentChat.voiceMode.settings.languages.en", {
          defaultValue: "English",
        }),
        es: t("agentChat.voiceMode.settings.languages.es", {
          defaultValue: "Spanish",
        }),
        fr: t("agentChat.voiceMode.settings.languages.fr", {
          defaultValue: "French",
        }),
        de: t("agentChat.voiceMode.settings.languages.de", {
          defaultValue: "German",
        }),
        it: t("agentChat.voiceMode.settings.languages.it", {
          defaultValue: "Italian",
        }),
        pt: t("agentChat.voiceMode.settings.languages.pt", {
          defaultValue: "Portuguese",
        }),
        ja: t("agentChat.voiceMode.settings.languages.ja", {
          defaultValue: "Japanese",
        }),
        ko: t("agentChat.voiceMode.settings.languages.ko", {
          defaultValue: "Korean",
        }),
        zh: t("agentChat.voiceMode.settings.languages.zh", {
          defaultValue: "Chinese",
        }),
      },
      intelligence: t("agentChat.voiceMode.settings.intelligence", {
        defaultValue: "Intelligence",
      }),
      intelligenceLevels: {
        instant: t("agentChat.voiceMode.settings.intelligenceLevels.instant", {
          defaultValue: "Instant",
        }),
        balanced: t(
          "agentChat.voiceMode.settings.intelligenceLevels.balanced",
          { defaultValue: "Balanced" },
        ),
        deep: t("agentChat.voiceMode.settings.intelligenceLevels.deep", {
          defaultValue: "Deep",
        }),
      },
      voiceStyle: t("agentChat.voiceMode.settings.voiceStyle", {
        defaultValue: "Voice style",
      }),
      microphone: t("agentChat.voiceMode.settings.microphone", {
        defaultValue: "Microphone",
      }),
      defaultMicrophone: t("agentChat.voiceMode.settings.defaultMicrophone", {
        defaultValue: "System default",
      }),
      microphoneSwitchFailed: t(
        "agentChat.voiceMode.settings.microphoneSwitchFailed",
        {
          defaultValue:
            "Could not switch microphones. Your current microphone is still active.",
        },
      ),
      voiceChangePending: t("agentChat.voiceMode.settings.voiceChangePending", {
        defaultValue:
          "Your new voice will apply next time you start voice mode.",
      }),
      voiceDescriptions: {
        marin: t("agentChat.voiceMode.settings.voiceDescriptions.marin", {
          defaultValue: "Warm and natural",
        }),
        cedar: t("agentChat.voiceMode.settings.voiceDescriptions.cedar", {
          defaultValue: "Clear and grounded",
        }),
        coral: t("agentChat.voiceMode.settings.voiceDescriptions.coral", {
          defaultValue: "Friendly and bright",
        }),
        sage: t("agentChat.voiceMode.settings.voiceDescriptions.sage", {
          defaultValue: "Calm and thoughtful",
        }),
        verse: t("agentChat.voiceMode.settings.voiceDescriptions.verse", {
          defaultValue: "Expressive and versatile",
        }),
        alloy: t("agentChat.voiceMode.settings.voiceDescriptions.alloy", {
          defaultValue: "Balanced and neutral",
        }),
        ash: t("agentChat.voiceMode.settings.voiceDescriptions.ash", {
          defaultValue: "Smooth and confident",
        }),
        ballad: t("agentChat.voiceMode.settings.voiceDescriptions.ballad", {
          defaultValue: "Warm and expressive",
        }),
        echo: t("agentChat.voiceMode.settings.voiceDescriptions.echo", {
          defaultValue: "Clear and direct",
        }),
        shimmer: t("agentChat.voiceMode.settings.voiceDescriptions.shimmer", {
          defaultValue: "Light and upbeat",
        }),
      },
    },
    status: {
      connecting: t("agentChat.voiceMode.status.connecting", {
        defaultValue: "Connecting",
      }),
      listening: t("agentChat.voiceMode.status.listening", {
        defaultValue: "Listening",
      }),
      speaking: t("agentChat.voiceMode.status.speaking", {
        defaultValue: "Speaking",
      }),
      working: t("agentChat.voiceMode.status.working", {
        defaultValue: "Working",
      }),
      error: t("agentChat.voiceMode.status.error", {
        defaultValue: "Voice mode needs attention",
      }),
      ending: t("agentChat.voiceMode.status.ending", {
        defaultValue: "Ending voice mode",
      }),
    },
    errors: {
      unsupported: t("agentChat.voiceMode.errors.unsupported", {
        defaultValue:
          "This browser does not support realtime voice conversations.",
      }),
      responseFailed: t("agentChat.voiceMode.errors.responseFailed", {
        defaultValue: "OpenAI could not complete the voice response.",
      }),
      sessionFailed: t("agentChat.voiceMode.errors.sessionFailed", {
        defaultValue: "The realtime voice session encountered an error.",
      }),
      channelDisconnected: t("agentChat.voiceMode.errors.channelDisconnected", {
        defaultValue: "The realtime voice control channel disconnected.",
      }),
      connectionTimedOut: t("agentChat.voiceMode.errors.connectionTimedOut", {
        defaultValue:
          "The realtime voice connection timed out. Try again after the app finishes loading.",
      }),
      connectionFailed: t("agentChat.voiceMode.errors.connectionFailed", {
        defaultValue: "The realtime voice connection failed.",
      }),
      offerFailed: t("agentChat.voiceMode.errors.offerFailed", {
        defaultValue: "The browser did not create an audio offer.",
      }),
    },
  };
}

export function useRealtimeVoiceModeCopy(): RealtimeVoiceModeCopy {
  const { translate: t } = useComposerRuntimeAdapters();
  return useMemo(() => createRealtimeVoiceModeCopy(t), [t]);
}

function useRealtimeVoiceModeController(
  browserTabId?: string,
  copy?: RealtimeVoiceModeCopy,
): RealtimeVoiceModeApi {
  const adapters = useComposerRuntimeAdapters();
  const t = adapters.translate!;
  const [state, setState] = useState<"idle" | RealtimeVoiceModeState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [inputMuted, setInputMutedState] = useState(false);
  const [outputMuted, setOutputMutedState] = useState(false);
  const inputMutedRef = useRef(false);
  const outputMutedRef = useRef(false);
  const flushTranscriptsRef = useRef<(() => void) | null>(null);
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
  const protocolRef = useRef<RealtimeVoiceProtocol>("live");
  const modelRef = useRef("gpt-live-1");
  const transportGenerationRef = useRef(0);
  const startedAtRef = useRef<string | undefined>(undefined);
  const lastUserTextRef = useRef("");
  const lastAssistantTextRef = useRef("");
  const transcriptThreadIdRef = useRef<string | undefined>(undefined);
  const requestedTranscriptThreadIdRef = useRef<string | undefined>(undefined);
  const liveCloseDrainTimerRef = useRef<number | null>(null);
  const liveCloseDrainFinishRef = useRef<(() => void) | null>(null);
  const toolAbortControllersRef = useRef(new Set<AbortController>());
  const pendingApprovalsRef = useRef(new Map<string, PendingApproval>());
  const runningToolsRef = useRef(new Map<string, string>());
  const [currentToolName, setCurrentToolName] = useState<string | null>(null);
  const trackRunningTool = useCallback(
    (callId: string, name: string | null) => {
      const running = runningToolsRef.current;
      if (name) running.set(callId, name);
      else running.delete(callId);
      setCurrentToolName([...running.values()].at(-1) ?? null);
    },
    [],
  );
  const [approvals, setApprovals] = useState<readonly RealtimeVoiceApproval[]>(
    [],
  );
  const syncApprovals = useCallback(() => {
    setApprovals(
      [...pendingApprovalsRef.current.values()].map(({ callId, name }) => ({
        callId,
        toolName: name,
      })),
    );
  }, []);
  const transcriptSequenceRef = useRef(0);
  const transcriptCreatedAtRef = useRef(new Map<string, string>());
  const workSegmentRef = useRef<RealtimeVoiceWorkSegment | null>(null);
  const responseCallCountsRef = useRef(new Map<string, number>());
  const preferencesHydratedRef = useRef(false);
  const preferencesEditedRef = useRef(false);
  const preferenceWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const responseCoordinator = useMemo(
    () =>
      createRealtimeVoiceResponseCoordinator((event) => {
        sendDataChannelEvent(channelRef.current, event);
      }),
    [],
  );
  // The metrics outlive adapter changes such as a locale switch: the
  // transport cleanup depends on them, and a new instance would end the call.
  const trackEventRef = useRef(adapters.voice.trackEvent);
  trackEventRef.current = adapters.voice.trackEvent;
  const turnMetrics = useMemo(
    () =>
      createRealtimeVoiceTurnMetrics((name, properties) =>
        trackEventRef.current(name, properties),
      ),
    [],
  );
  const toolManifestCoordinator = useMemo(
    () =>
      createRealtimeVoiceToolManifestCoordinator((event) => {
        if (event.type === "response.create") {
          responseCoordinator.request(event);
        } else {
          sendDataChannelEvent(channelRef.current, event);
        }
      }),
    [responseCoordinator],
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

  const abortActiveToolCalls = useCallback(() => {
    for (const controller of toolAbortControllersRef.current) {
      controller.abort();
    }
    toolAbortControllersRef.current.clear();
  }, []);

  const hydratePreferences = useCallback(async () => {
    if (preferencesHydratedRef.current) return;
    try {
      const stored = await adapters.voice!.readAppState!(
        REALTIME_VOICE_PREFERENCES_KEY,
      );
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
  }, [adapters]);

  const syncAppState = useCallback(
    (nextState: "idle" | RealtimeVoiceModeState) => {
      const value =
        nextState === "idle"
          ? null
          : {
              active: true,
              status: nextState,
              model: modelRef.current,
              protocol: protocolRef.current,
              startedAt: startedAtRef.current,
              sessionId: sessionIdRef.current,
              browserTabId,
              preferences: preferencesRef.current,
              lastUserText: lastUserTextRef.current || undefined,
              lastAssistantText: lastAssistantTextRef.current || undefined,
            };
      void Promise.resolve(
        adapters.voice!.setAppState!(REALTIME_VOICE_STATE_KEY, value),
      ).catch(() => undefined);
    },
    [adapters, browserTabId],
  );

  const transition = useCallback(
    (nextState: "idle" | RealtimeVoiceModeState) => {
      stateRef.current = nextState;
      setState(nextState);
      syncAppState(nextState);
    },
    [syncAppState],
  );

  const savePreferences = useCallback(
    (next: RealtimeVoicePreferences) => {
      preferencesEditedRef.current = true;
      preferencesHydratedRef.current = true;
      preferencesRef.current = next;
      setPreferences(next);
      preferenceWriteChainRef.current = preferenceWriteChainRef.current
        .catch(() => undefined)
        .then(async () => {
          await adapters.voice!.setAppState!(
            REALTIME_VOICE_PREFERENCES_KEY,
            next,
          );
        })
        .catch(() => undefined);
    },
    [adapters],
  );

  const updateLivePreferences = useCallback(
    (next: RealtimeVoicePreferences, includeVoice = false) => {
      turnMetrics.setContext({
        protocol: protocolRef.current,
        intelligence: next.intelligence,
        intelligenceSource: next.intelligenceChosen ? "user" : "default",
      });
      sendDataChannelEvent(
        channelRef.current,
        createRealtimeVoicePreferenceUpdate(next, {
          browserLanguages:
            typeof navigator === "undefined" ? [] : navigator.languages,
          includeVoice,
          protocol: protocolRef.current,
        }),
      );
    },
    [turnMetrics],
  );

  const setLanguage = useCallback(
    (language: RealtimeVoiceLanguage) => {
      const next = { ...preferencesRef.current, language };
      savePreferences(next);
      if (protocolRef.current === "live") {
        sendDataChannelEvent(
          channelRef.current,
          createRealtimeVoiceLanguageUpdate(language, navigator.languages),
        );
      }
      updateLivePreferences(next);
    },
    [savePreferences, updateLivePreferences],
  );

  const setIntelligence = useCallback(
    (intelligence: RealtimeVoiceIntelligence) => {
      const next = {
        ...preferencesRef.current,
        intelligence,
        intelligenceChosen: true,
      };
      savePreferences(next);
      updateLivePreferences(next);
    },
    [savePreferences, updateLivePreferences],
  );

  const setVoice = useCallback(
    (voice: RealtimeVoice) => {
      const next = { ...preferencesRef.current, voice };
      savePreferences(next);
      if (protocolRef.current === "live" || hasOutputAudioRef.current) {
        setVoiceChangePending(true);
        if (protocolRef.current !== "live") updateLivePreferences(next);
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
    const inputs = await listRealtimeVoiceMicrophones(t);
    if (inputs) setMicrophones(inputs);
    return inputs;
  }, [t]);

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
        const buffer = new Uint8Array(analyser.fftSize);
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
        const replacementTrack = replacementStream.getAudioTracks().at(0);
        streamRef.current = replacementStream;
        if (replacementTrack) replacementTrack.enabled = !inputMutedRef.current;
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
            t("agentChat.voiceMode.settings.microphoneSwitchFailed", {
              defaultValue:
                "Could not switch microphones. Your current microphone is still active.",
            }),
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
      t,
    ],
  );
  switchMicrophoneRef.current = setMicrophone;

  const cleanupTransport = useCallback(() => {
    // Teardown keeps what was heard now, so no grouper timer publishes into
    // the chat after the session is gone.
    flushTranscriptsRef.current?.();
    turnMetrics.sessionEnded();
    for (const pending of pendingApprovalsRef.current.values()) {
      finishPendingApproval(pending, null);
    }
    pendingApprovalsRef.current.clear();
    syncApprovals();
    runningToolsRef.current.clear();
    setCurrentToolName(null);
    closeRealtimeVoiceWorkSegment(workSegmentRef);
    responseCallCountsRef.current.clear();
    if (liveCloseDrainTimerRef.current !== null) {
      window.clearTimeout(liveCloseDrainTimerRef.current);
      liveCloseDrainTimerRef.current = null;
    }
    liveCloseDrainFinishRef.current = null;
    connectionGateRef.current?.cancel();
    connectionGateRef.current = null;
    transportGenerationRef.current += 1;
    capabilityRef.current = undefined;
    abortActiveToolCalls();
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
    responseCoordinator.reset();
    toolManifestCoordinator.reset();
  }, [
    abortActiveToolCalls,
    audioLevels,
    responseCoordinator,
    syncApprovals,
    toolManifestCoordinator,
    turnMetrics,
  ]);

  const fail = useCallback(
    (message: string, options?: { openKeySettings?: boolean }) => {
      flushTranscriptsRef.current?.();
      cleanupTransport();
      setError(message);
      transition("error");
      if (options?.openKeySettings) openOpenAiKeySettings();
    },
    [cleanupTransport, transition],
  );

  const publishTranscript = useCallback(
    (
      transcript: CompletedRealtimeVoiceTranscript,
      status: "streaming" | "complete",
    ) => {
      const threadId = transcriptThreadIdRef.current;
      if (!threadId) return;
      // The session id arrives after the first events; the start time keeps
      // every update of one turn under the same message id.
      const sessionIdentity = startedAtRef.current ?? "pending";
      const providerIdentity =
        transcript.providerId ?? `sequence-${++transcriptSequenceRef.current}`;
      const id = `realtime-voice:${sessionIdentity}:${transcript.role}:${providerIdentity}`;
      // Work rows sit before the first message created after their call, so a
      // turn keeps the time it started however late its final text arrives.
      let createdAt = transcriptCreatedAtRef.current.get(id);
      if (!createdAt) {
        createdAt = new Date().toISOString();
        transcriptCreatedAtRef.current.set(id, createdAt);
      }
      realtimeVoiceTranscriptRegistry.publish({
        id,
        threadId,
        role: transcript.role,
        text: transcript.text,
        createdAt,
        status,
      });
    },
    [],
  );

  const transcriptSequencer = useMemo(
    () =>
      createRealtimeVoiceTranscriptSequencer(
        (transcript) => publishTranscript(transcript, "complete"),
        (transcript) => publishTranscript(transcript, "streaming"),
        (turn) => {
          if (turn.speaker !== "user") return;
          turnMetrics.userTurnUpdated(performance.now(), turn.id, turn.endMs);
        },
      ),
    [publishTranscript, turnMetrics],
  );
  flushTranscriptsRef.current = transcriptSequencer.flush;
  const greetingStarter = useMemo(
    () =>
      createRealtimeVoiceGreetingStarter((event) => {
        if (event.type === "response.create") {
          responseCoordinator.request(event);
        } else {
          sendDataChannelEvent(channelRef.current, event);
        }
      }),
    [responseCoordinator],
  );

  const handleFunctionCall = useCallback(
    async (
      call: { name: string; callId: string; argumentsText: string },
      delegationId: string | undefined,
    ) => {
      if (handledCallsRef.current.has(call.callId)) return;
      handledCallsRef.current.add(call.callId);
      const transportGeneration = transportGenerationRef.current;
      const transportChannel = channelRef.current;
      const toolAbortController = new AbortController();
      toolAbortControllersRef.current.add(toolAbortController);
      transition("working");
      trackRunningTool(call.callId, call.name);
      const finishTurnToolCall = turnMetrics.toolCallStarted();
      const workCall: RealtimeVoiceWorkCall = {
        id: call.callId,
        name: call.name,
        status: "running",
        startedAt: new Date().toISOString(),
      };
      const workSegment = openRealtimeVoiceWorkSegment(
        workSegmentRef,
        transcriptThreadIdRef.current,
        call.callId,
        delegationId,
      );
      let result: RealtimeVoiceToolResult;
      try {
        const args = parseFunctionArguments(call.argumentsText);
        workCall.input = args;
        if (workSegment) {
          workSegment.calls.push(workCall);
          publishRealtimeVoiceWorkSegment(workSegment);
        }
        result = await executeRealtimeVoiceTool({
          name: call.name,
          args,
          callId: call.callId,
          sessionId: sessionIdRef.current,
          browserTabId,
          capability: capabilityRef.current,
          signal: toolAbortController.signal,
        });
      } catch (toolError) {
        result = {
          callId: call.callId,
          status: "failed",
          output: errorMessage(toolError),
        };
      } finally {
        toolAbortControllersRef.current.delete(toolAbortController);
        trackRunningTool(call.callId, null);
      }
      // Session teardown aborted the call, so it did not fail. A call that
      // asks for approval stays running until the user decides.
      const approvalId =
        !toolAbortController.signal.aborted &&
        result.status === "approval_required" &&
        workCall.input &&
        transportGeneration === transportGenerationRef.current
          ? result.approvalId
          : undefined;
      const awaitingApproval = Boolean(approvalId);
      if (!awaitingApproval) {
        workCall.status =
          toolAbortController.signal.aborted ||
          result.status === "approval_required"
            ? "cancelled"
            : result.status;
        workCall.output = result.output;
        workCall.completedAt = new Date().toISOString();
      }
      if (workSegment) {
        if (!workSegment.calls.includes(workCall)) {
          workSegment.calls.push(workCall);
        }
        if (workSegment.closing) {
          closeRealtimeVoiceWorkSegment(workSegmentRef, workSegment);
        } else {
          publishRealtimeVoiceWorkSegment(workSegment);
        }
      }
      finishTurnToolCall(
        performance.now(),
        toolAbortController.signal.aborted ? { status: "cancelled" } : result,
      );
      if (
        transportGeneration !== transportGenerationRef.current ||
        channelRef.current !== transportChannel
      ) {
        return;
      }
      if (result.capability) capabilityRef.current = result.capability;
      if (approvalId && workCall.input) {
        pendingApprovalsRef.current.set(call.callId, {
          callId: call.callId,
          name: call.name,
          args: workCall.input,
          approvalId,
          workCall,
          workSegment,
        });
        syncApprovals();
      }
      toolManifestCoordinator.enqueue(result);
    },
    [
      browserTabId,
      syncApprovals,
      toolManifestCoordinator,
      trackRunningTool,
      transition,
      turnMetrics,
    ],
  );

  const resolveApproval = useCallback(
    async (callId: string, approved: boolean) => {
      const pending = pendingApprovalsRef.current.get(callId);
      if (!pending) return;
      pendingApprovalsRef.current.delete(callId);
      syncApprovals();
      const transportGeneration = transportGenerationRef.current;
      const transportChannel = channelRef.current;
      let result: RealtimeVoiceToolResult | null = null;
      let aborted = false;
      if (approved) {
        transition("working");
        trackRunningTool(callId, pending.name);
        const toolAbortController = new AbortController();
        toolAbortControllersRef.current.add(toolAbortController);
        try {
          result = await executeRealtimeVoiceTool({
            name: pending.name,
            args: pending.args,
            callId: `${callId}_approved`,
            sessionId: sessionIdRef.current,
            browserTabId,
            capability: capabilityRef.current,
            signal: toolAbortController.signal,
            approvalId: pending.approvalId,
          });
        } catch (toolError) {
          result = {
            callId,
            status: "failed",
            output: errorMessage(toolError),
          };
        } finally {
          toolAbortControllersRef.current.delete(toolAbortController);
          trackRunningTool(callId, null);
        }
        aborted = toolAbortController.signal.aborted;
      } else {
        // A declined record left pending would make a later identical
        // request's approval ambiguous on the server.
        await executeRealtimeVoiceTool({
          name: pending.name,
          args: pending.args,
          callId: `${callId}_declined`,
          sessionId: sessionIdRef.current,
          browserTabId,
          capability: capabilityRef.current,
          declinedApprovalId: pending.approvalId,
        }).catch((declineError: unknown) => {
          console.warn(
            "Could not record the declined voice approval.",
            declineError,
          );
        });
      }
      const transportChanged =
        transportGeneration !== transportGenerationRef.current ||
        channelRef.current !== transportChannel;
      // An approval that expired or no longer applies asks again; the call
      // stays running and the user sees the new request.
      const renewedApprovalId =
        !aborted && !transportChanged && result?.status === "approval_required"
          ? result.approvalId
          : undefined;
      if (renewedApprovalId) {
        pendingApprovalsRef.current.set(callId, {
          ...pending,
          approvalId: renewedApprovalId,
        });
        syncApprovals();
      } else {
        finishPendingApproval(pending, aborted || !result ? null : result);
      }
      if (aborted || transportChanged) return;
      if (result?.capability) capabilityRef.current = result.capability;
      sendDataChannelEvent(
        channelRef.current,
        createRealtimeVoiceApprovalOutcomeEvent(
          pending.name,
          result,
          protocolRef.current,
        ),
      );
      sendDataChannelEvent(channelRef.current, { type: "response.create" });
    },
    [browserTabId, syncApprovals, trackRunningTool, transition],
  );

  const handleServerEvent = useCallback(
    (event: RealtimeServerEvent, draining = false) => {
      if (draining) {
        transcriptSequencer.handle(event);
        if (event.type === "session.closed") {
          transcriptSequencer.flush();
          liveCloseDrainFinishRef.current?.();
        }
        return;
      }
      responseCoordinator.handleEvent(event);
      transcriptSequencer.handle(event);
      greetingStarter.handleEvent(event);
      const responseEvent = normalizeRealtimeVoiceResponseEvent(event);
      const responseBoundary =
        responseEvent.type === "response.done" ||
        responseEvent.type === "response.completed";
      const sessionLifecycle =
        event.type === "session.started" || event.type === "session.created";
      if (sessionLifecycle) {
        toolManifestCoordinator.setProtocol(protocolRef.current);
      }
      const sessionTools = extractRealtimeVoiceSessionTools(event);
      if (sessionTools) toolManifestCoordinator.setSessionTools(sessionTools);
      if (sessionLifecycle) {
        connectionGateRef.current?.markSessionCreated();
        connectionGateRef.current = null;
        const session = event.session;
        if (session && typeof session === "object") {
          const id = (session as { id?: unknown }).id;
          if (typeof id === "string") sessionIdRef.current = id;
        }
        greetingStarter.setProtocol(protocolRef.current);
        if (protocolRef.current === "realtime") {
          updateLivePreferences(preferencesRef.current, true);
        }
        greetingStarter.start();
        transition("working");
      } else if (event.type === "input_audio_buffer.speech_started") {
        closeRealtimeVoiceWorkSegment(workSegmentRef);
        turnMetrics.userSpeechStarted(performance.now());
        transition("listening");
      } else if (event.type === "input_audio_buffer.speech_stopped") {
        turnMetrics.userSpeechEnded(performance.now());
        transition("working");
        if (protocolRef.current === "realtime") responseCoordinator.request();
      } else if (event.type === "response.created") {
        hasOutputAudioRef.current = true;
        lastAssistantTextRef.current = "";
        transition("working");
      } else if (event.type === "output_audio_buffer.started") {
        turnMetrics.assistantAudioStarted(performance.now());
      } else if (event.type === "response.output_audio_transcript.delta") {
        turnMetrics.assistantResponded();
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
      } else if (event.type === "session.input_transcript.delta") {
        if (typeof event.delta === "string") {
          lastUserTextRef.current += event.delta;
        }
        transition("listening");
      } else if (event.type === "session.output_transcript.delta") {
        turnMetrics.assistantAudioStarted(
          performance.now(),
          typeof event.start_ms === "number" ? event.start_ms : undefined,
        );
        hasOutputAudioRef.current = true;
        if (typeof event.delta === "string") {
          lastAssistantTextRef.current += event.delta;
        }
        transition("speaking");
      } else if (event.type === "session.closed") {
        transcriptSequencer.flush();
      } else if (
        responseEvent.type === "response.done" ||
        responseEvent.type === "response.completed" ||
        responseEvent.type === "response.failed"
      ) {
        const response = responseEvent.response;
        const status =
          response && typeof response === "object"
            ? (response as { status?: unknown }).status
            : undefined;
        if (responseEvent.type === "response.failed" || status === "failed") {
          closeRealtimeVoiceWorkSegment(workSegmentRef);
          transportGenerationRef.current += 1;
          handledCallsRef.current.clear();
          abortActiveToolCalls();
          responseCoordinator.reset();
          toolManifestCoordinator.reset({ preserveSessionTools: true });
          toolManifestCoordinator.setProtocol(protocolRef.current);
          transcriptSequencer.reset({ preserveQueuedTranscripts: true });
          lastUserTextRef.current = "";
          lastAssistantTextRef.current = "";
          transition("listening");
          return;
        }
      } else if (event.type === "error") {
        const detail = event.error;
        const message =
          detail && typeof detail === "object"
            ? typeof (detail as { message?: unknown }).message === "object"
              ? JSON.stringify((detail as { message?: unknown }).message)
              : typeof (detail as { message?: unknown }).message === "string" ||
                  typeof (detail as { message?: unknown }).message === "number"
                ? String((detail as { message?: unknown }).message)
                : ""
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
        if (responseCoordinator.handleError(message)) {
          transition("working");
          return;
        }
        fail(
          message ||
            copy?.errors.sessionFailed ||
            t("agentChat.voiceMode.errors.sessionFailed", {
              defaultValue: "The realtime voice session encountered an error.",
            }),
        );
        return;
      }

      const delegationId =
        typeof event.delegation_id === "string" ? event.delegation_id : "";
      const calls = extractRealtimeVoiceFunctionCalls(event);
      for (const call of calls) {
        void handleFunctionCall(call, delegationId || undefined);
      }
      // GPT-Live's response snapshots carry no output, so whether a response
      // called a tool is counted from its streamed items, per delegation.
      const responseCalls = responseCallCountsRef.current;
      if (responseEvent.type === "response.created") {
        responseCalls.set(delegationId, 0);
      }
      if (calls.length > 0) {
        responseCalls.set(
          delegationId,
          (responseCalls.get(delegationId) ?? 0) + calls.length,
        );
      }
      if (responseBoundary && !responseCalls.get(delegationId)) {
        // Only the segment's own delegation ends it; an uncorrelated
        // boundary would split one request's work into several rows.
        if ((workSegmentRef.current?.delegationId ?? "") === delegationId) {
          closeRealtimeVoiceWorkSegment(workSegmentRef);
        }
        transition("listening");
      }
      if (responseBoundary) responseCalls.delete(delegationId);
      if (responseBoundary) {
        lastUserTextRef.current = "";
        lastAssistantTextRef.current = "";
      }
    },
    [
      copy,
      fail,
      greetingStarter,
      handleFunctionCall,
      abortActiveToolCalls,
      syncAppState,
      t,
      transcriptSequencer,
      transition,
      responseCoordinator,
      toolManifestCoordinator,
      turnMetrics,
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
          t("agentChat.voiceMode.errors.unsupported", {
            defaultValue:
              "This browser does not support realtime voice conversations.",
          }),
      );
      return;
    }
    setError(null);
    protocolRef.current = "live";
    modelRef.current = "gpt-live-1";
    startedAtRef.current = new Date().toISOString();
    lastUserTextRef.current = "";
    lastAssistantTextRef.current = "";
    sessionIdRef.current = undefined;
    hasOutputAudioRef.current = false;
    greetingStarter.reset();
    setVoiceChangePending(false);
    transcriptThreadIdRef.current =
      requestedTranscriptThreadIdRef.current ??
      realtimeVoiceTranscriptRegistry.activeThreadId();
    transcriptSequenceRef.current = 0;
    transcriptCreatedAtRef.current.clear();
    transcriptSequencer.reset();
    inputMutedRef.current = false;
    outputMutedRef.current = false;
    setInputMutedState(false);
    setOutputMutedState(false);
    transition("connecting");

    // Settings can change the saved choices between sessions.
    preferencesHydratedRef.current = false;
    preferencesEditedRef.current = false;
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
          t("agentChat.voiceMode.errors.connectionTimedOut", {
            defaultValue: "The realtime voice connection timed out.",
          }),
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
          writeRealtimeVoiceMicrophoneId("default");
          setMicrophoneDeviceId("default");
        }
      });

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.muted = outputMutedRef.current;
      audio.setAttribute("playsinline", "");
      audioRef.current = audio;
      peer.ontrack = (trackEvent) => {
        const remoteStream =
          trackEvent.streams[0] ?? new MediaStream([trackEvent.track]);
        audio.srcObject = remoteStream;
        attachAudioMeter(remoteStream, "output");
        void audio.play().catch(() => undefined);
      };

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.onopen = connectionGate.markTransportReady;
      channel.onmessage = (messageEvent) => {
        if (!isCurrentAttempt()) return;
        try {
          handleServerEvent(
            JSON.parse(String(messageEvent.data)),
            stateRef.current === "ending",
          );
        } catch (eventError) {
          // A malformed provider event must not end a healthy call, but the
          // text it carried is lost, so say so.
          console.warn(
            "Ignored a realtime voice event that could not be handled.",
            eventError,
          );
        }
      };
      channel.onerror = () => {
        if (!isCurrentAttempt() || stateRef.current === "ending") return;
        fail(
          copy?.errors.channelDisconnected ??
            t("agentChat.voiceMode.errors.channelDisconnected", {
              defaultValue: "The realtime voice control channel disconnected.",
            }),
        );
      };
      peer.onconnectionstatechange = () => {
        if (!isCurrentAttempt() || stateRef.current === "ending") return;
        if (peer.connectionState === "connected") {
          connectionGate.markTransportReady();
        }
        if (peer.connectionState === "failed") {
          fail(
            copy?.errors.connectionFailed ??
              t("agentChat.voiceMode.errors.connectionFailed", {
                defaultValue: "The realtime voice connection failed.",
              }),
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
            t("agentChat.voiceMode.errors.offerFailed", {
              defaultValue: "The browser did not create an audio offer.",
            }),
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
      protocolRef.current = answer.protocol ?? "realtime";
      modelRef.current =
        answer.model ??
        (protocolRef.current === "live" ? "gpt-live-1" : "gpt-realtime-2.1");
      toolManifestCoordinator.setProtocol(protocolRef.current);
      toolManifestCoordinator.setPriorityToolNames(
        answer.priorityToolNames ?? [],
      );
      greetingStarter.setProtocol(protocolRef.current);
      const chosen = preferencesRef.current.intelligenceChosen === true;
      if (
        !chosen &&
        answer.intelligence &&
        answer.intelligence !== preferencesRef.current.intelligence
      ) {
        // Saved as not chosen, so Settings shows the app's default after a
        // reload and the app can still change it.
        savePreferences({
          ...preferencesRef.current,
          intelligence: answer.intelligence,
          intelligenceChosen: false,
        });
      }
      turnMetrics.setContext({
        protocol: protocolRef.current,
        intelligence: preferencesRef.current.intelligence,
        intelligenceSource: chosen ? "user" : "default",
      });
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    } catch (startError) {
      if (
        isRealtimeVoiceAbortError(startError) ||
        abortController.signal.aborted ||
        abortRef.current !== abortController
      ) {
        return;
      }
      if (isRealtimeVoiceSetupRequiredError(startError)) {
        cleanupTransport();
        setError(null);
        startedAtRef.current = undefined;
        sessionIdRef.current = undefined;
        transcriptThreadIdRef.current = undefined;
        transition("idle");
        window.dispatchEvent(new Event("agent-panel:open"));
        window.dispatchEvent(new Event("agent-engine:configured-changed"));
        return;
      }
      const status = (startError as { status?: unknown })?.status;
      fail(
        isMicrophoneAccessError(startError)
          ? voiceDictationStartErrorMessage(startError, t)
          : errorMessage(startError),
        { openKeySettings: status === 400 },
      );
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
    savePreferences,
    t,
    transcriptSequencer,
    transition,
    turnMetrics,
  ]);

  const startForThread = useCallback(
    (options?: RealtimeVoiceStartOptions) => {
      requestedTranscriptThreadIdRef.current = options?.threadId;
      return start();
    },
    [start],
  );

  const end = useCallback(() => {
    if (stateRef.current === "idle" || stateRef.current === "ending") return;
    const transcriptThreadId = transcriptThreadIdRef.current;
    const activeThreadId = realtimeVoiceTranscriptRegistry.activeThreadId();
    const protocol = protocolRef.current;
    transition("ending");
    abortActiveToolCalls();
    const finish = () => {
      if (liveCloseDrainTimerRef.current !== null) {
        window.clearTimeout(liveCloseDrainTimerRef.current);
        liveCloseDrainTimerRef.current = null;
      }
      // An unconfirmed close still keeps what was heard; those turns have
      // already streamed into the chat.
      transcriptSequencer.flush();
      liveCloseDrainFinishRef.current = null;
      cleanupTransport();
      setError(null);
      sessionIdRef.current = undefined;
      startedAtRef.current = undefined;
      transcriptThreadIdRef.current = undefined;
      if (
        shouldRestoreRealtimeVoiceTranscriptThread(
          transcriptThreadId,
          activeThreadId,
        )
      ) {
        adapters.agentChat!.requestThreadOpen!({
          threadId: transcriptThreadId,
          onlyIfActiveThreadId: transcriptThreadId,
        });
      } else {
        window.dispatchEvent(new Event("agent-panel:open"));
      }
      transition("idle");
    };
    if (protocol === "live") {
      transportGenerationRef.current += 1;
      liveCloseDrainFinishRef.current = finish;
      sendDataChannelEvent(channelRef.current, {
        type: "session.close",
        event_id: "realtime_voice_session_close",
      });
      liveCloseDrainTimerRef.current = window.setTimeout(
        () => finish(),
        REALTIME_VOICE_LIVE_CLOSE_DRAIN_TIMEOUT_MS,
      );
      return;
    }
    finish();
  }, [
    abortActiveToolCalls,
    adapters,
    cleanupTransport,
    transcriptSequencer,
    transition,
  ]);

  const setInputMuted = useCallback((muted: boolean) => {
    inputMutedRef.current = muted;
    setInputMutedState(muted);
    for (const track of streamRef.current?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
  }, []);

  const setOutputMuted = useCallback((muted: boolean) => {
    outputMutedRef.current = muted;
    setOutputMutedState(muted);
    if (audioRef.current) audioRef.current.muted = muted;
  }, []);

  const dismissError = useCallback(() => {
    if (stateRef.current !== "error") return;
    setError(null);
    transition("idle");
  }, [transition]);

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
    audioLevels,
    inputMuted,
    outputMuted,
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
    setInputMuted,
    setOutputMuted,
    start: startForThread,
    end,
    dismissError,
    currentToolName,
    approvals,
    resolveApproval,
  };
}

const RealtimeVoiceModeContext = createContext<RealtimeVoiceModeApi | null>(
  null,
);

export function RealtimeVoiceModeProvider({
  children,
  browserTabId,
}: RealtimeVoiceModeProviderProps) {
  const adapters = useComposerRuntimeAdapters();
  const resolvedBrowserTabId = useMemo(
    () => browserTabId ?? adapters.voice!.getBrowserTabId!(),
    [adapters, browserTabId],
  );
  const copy = useRealtimeVoiceModeCopy();
  const voice = useRealtimeVoiceModeController(resolvedBrowserTabId, copy);
  return (
    <RealtimeVoiceModeContext.Provider value={voice}>
      {children}
    </RealtimeVoiceModeContext.Provider>
  );
}

/** Ensures a voice chat provider above `children`, reusing an existing one. */
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

/**
 * The microphone, language, intelligence, and voice pickers, read from the
 * same preferences a session uses. Settings renders these rows.
 */
export function buildRealtimeVoiceSettings({
  copy,
  preferences,
  microphones,
  microphoneDeviceId,
  onMicrophoneChange,
  onPreferencesChange,
}: {
  copy: RealtimeVoiceModeCopy;
  preferences: RealtimeVoicePreferences;
  microphones: readonly RealtimeVoiceMicrophone[];
  microphoneDeviceId: string;
  onMicrophoneChange: (deviceId: string) => void;
  onPreferencesChange: (next: RealtimeVoicePreferences) => void;
}): RealtimeVoiceModeInlineSettings {
  return {
    dialogLabel: copy.voiceSettings,
    microphone: {
      label: copy.settings.microphone,
      value: microphoneDeviceId,
      options: [
        { value: "default", label: copy.settings.defaultMicrophone },
        ...microphones.map((microphone) => ({
          value: microphone.deviceId,
          label: microphone.label,
        })),
      ],
      onValueChange: onMicrophoneChange,
    },
    language: {
      label: copy.settings.language,
      value: preferences.language,
      options: REALTIME_VOICE_LANGUAGES.map((language) => ({
        value: language,
        label:
          language === "auto"
            ? copy.settings.autoLanguage
            : copy.settings.languages[language],
      })),
      onValueChange: (value: string) => {
        if (isOneOf(REALTIME_VOICE_LANGUAGES, value)) {
          onPreferencesChange({ ...preferences, language: value });
        }
      },
    },
    intelligence: {
      label: copy.settings.intelligence,
      value: preferences.intelligence,
      options: REALTIME_VOICE_INTELLIGENCE_LEVELS.map((intelligence) => ({
        value: intelligence,
        label: copy.settings.intelligenceLevels[intelligence],
      })),
      onValueChange: (value: string) => {
        if (isOneOf(REALTIME_VOICE_INTELLIGENCE_LEVELS, value)) {
          onPreferencesChange({
            ...preferences,
            intelligence: value,
            intelligenceChosen: true,
          });
        }
      },
    },
    voiceStyle: {
      label: copy.settings.voiceStyle,
      value: preferences.voice,
      options: REALTIME_VOICES.map((voiceName) => ({
        value: voiceName,
        label: `${voiceName.charAt(0).toUpperCase()}${voiceName.slice(1)}`,
        description: copy.settings.voiceDescriptions[voiceName],
      })),
      onValueChange: (value: string) => {
        if (isOneOf(REALTIME_VOICES, value)) {
          onPreferencesChange({ ...preferences, voice: value });
        }
      },
    },
  };
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
  return readRealtimeVoiceContextWith({});
}

export async function readRealtimeVoiceContextWith(options: {
  readAppState?: (key: string) => unknown;
  resolvePath?: (path: string) => string;
}): Promise<{ navigation: unknown; url: unknown }> {
  if (options.readAppState) {
    const [navigation, url] = await Promise.all([
      Promise.resolve(options.readAppState("navigation")).catch(() => null),
      Promise.resolve(options.readAppState("__url__")).catch(() => null),
    ]);
    return { navigation, url };
  }
  const resolvePath = options.resolvePath ?? ((path: string) => path);
  const read = async (key: string) => {
    const response = await fetch(
      resolvePath(
        `/_agent-native/application-state/${encodeURIComponent(key)}`,
      ),
    );
    if (!response.ok) return null;
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" && "value" in body
      ? ((body as { value?: unknown }).value ?? null)
      : body;
  };
  const [navigation, url] = await Promise.all([
    read("navigation").catch(() => null),
    read("__url__").catch(() => null),
  ]);
  return { navigation, url };
}
