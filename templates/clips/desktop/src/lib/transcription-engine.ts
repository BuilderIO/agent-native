/**
 * Single frontend entry point for Rust-side transcription.
 *
 * Two engines live behind these helpers:
 *   - "whisper"      → `audio_transcription_*` (local whisper.cpp, mic + system)
 *   - "macos-native" → `native_speech_*` (SFSpeechRecognizer, mic only)
 *
 * Everything that starts/stops an engine or listens to a `voice:*` transcript
 * event should go through here so the engine choice, command names, and event
 * payload shapes are defined in exactly one place.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type TranscriptSource = "mic" | "system";
export type TranscriptionEngine = "whisper" | "macos-native";

/** A transcript segment as emitted per `voice:final-transcript` event (the
 *  event itself carries the source). */
export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/** An accumulated segment tagged with the stream it came from (mic/system).
 *  Shared by every consumer that stores or replays transcript segments. */
export interface SourcedTranscriptSegment extends TranscriptSegment {
  source: TranscriptSource;
}

export interface FinalTranscriptEvent {
  /** Raw text (not trimmed); callers decide whether to skip empties. */
  text: string;
  source: TranscriptSource;
  segments: TranscriptSegment[];
}

export interface PartialTranscriptEvent {
  /** Raw text; empty string is meaningful (clears the live display). */
  text: string;
  source: TranscriptSource;
}

export interface SpeechErrorEvent {
  error: string;
  source: TranscriptSource;
}

export interface AudioLevelEvent {
  /** 0..1 peak level. */
  level: number;
  source: TranscriptSource;
}

interface MicSelection {
  deviceId?: string | null;
  label?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Conversation-side label: system audio is the other party, mic is the user. */
export function speakerFor(
  source: TranscriptSource | undefined,
): "Me" | "Them" {
  return source === "system" ? "Them" : "Me";
}

/**
 * Fold a final-transcript event into a running transcript: appends a
 * speaker-labelled line and the event's (non-empty) segments tagged with the
 * event source. Mutates `lines`/`segments` in place. Returns true if anything
 * was appended (i.e. the event had non-empty text).
 */
export function appendFinalTranscript(
  event: FinalTranscriptEvent,
  lines: string[],
  segments: SourcedTranscriptSegment[],
): boolean {
  const text = event.text.trim();
  if (!text) return false;
  lines.push(`${speakerFor(event.source)}: ${text}`);
  for (const seg of event.segments) {
    const segText = seg.text?.trim();
    if (!segText) continue;
    segments.push({
      startMs: seg.startMs,
      endMs: seg.endMs,
      text: segText,
      source: event.source,
    });
  }
  return true;
}

function normalizeSource(source: unknown): TranscriptSource {
  return source === "system" ? "system" : "mic";
}

function browserLocale(): string {
  return navigator.language || "en-US";
}

export function recordingTranscriptionLanguage(): string | null {
  return null;
}

// ---------------------------------------------------------------------------
// Engine lifecycle
// ---------------------------------------------------------------------------

/** Start a specific engine. No fallback — throws if the command fails.
 *  `captureSystem` (whisper only) toggles the system-audio stream. */
export async function restartTranscriptionEngine(
  engine: TranscriptionEngine,
  mic?: MicSelection,
  captureSystem: boolean = true,
  voiceProcessing: boolean = false,
): Promise<void> {
  if (engine === "whisper") {
    await invoke("audio_transcription_start", {
      meetingId: null,
      locale: recordingTranscriptionLanguage(),
      micDeviceId: mic?.deviceId || null,
      micDeviceLabel: mic?.label || null,
      captureSystem,
      voiceProcessing,
      owner: "meeting",
    });
  } else {
    // This module is meetings-only (see file header) — always pass
    // owner: "meeting" so a Fn/dictation press can't silently evict a
    // meeting's native-speech fallback session (Rust-side priority rule
    // in native_speech.rs). Dictation's own caller (voice-dictation.ts)
    // omits `owner` and gets the "dictation" default.
    await invoke("native_speech_start", {
      locale: browserLocale(),
      micDeviceId: mic?.deviceId || null,
      micDeviceLabel: mic?.label || null,
      owner: "meeting",
    });
  }
}

export async function startTranscriptionEngine(opts: {
  mic?: MicSelection;
  /** Capture + transcribe system audio (whisper). Default true. */
  captureSystem?: boolean;
  /**
   * Enable Apple's voice-processing input mode for the Whisper mic tap.
   * Meeting and recording capture leave this off at the renderer boundary.
   * The native meeting runtime may allocate VoiceProcessingIO in bypass mode
   * only when combined ScreenCaptureKit capture is unavailable or fails.
   */
  voiceProcessing?: boolean;
}): Promise<TranscriptionEngine> {
  const captureSystem = opts.captureSystem ?? true;
  const voiceProcessing = opts.voiceProcessing ?? false;
  try {
    await restartTranscriptionEngine(
      "whisper",
      opts.mic,
      captureSystem,
      voiceProcessing,
    );
    return "whisper";
  } catch (err) {
    console.warn(
      "[transcription] whisper mic+system failed, falling back to mic-only:",
      err,
    );
    await restartTranscriptionEngine("macos-native", opts.mic);
    return "macos-native";
  }
}

/** Stop the given engine. */
export async function stopTranscriptionEngine(
  engine: TranscriptionEngine,
): Promise<void> {
  await invoke(
    engine === "whisper" ? "audio_transcription_stop" : "native_speech_stop",
  );
}

export async function resetTranscriptionTimeline(
  engine: TranscriptionEngine,
): Promise<void> {
  if (engine !== "whisper") return;
  await invoke("audio_transcription_reset_timeline");
}

// ---------------------------------------------------------------------------
// Event subscriptions
// ---------------------------------------------------------------------------

export function onFinalTranscript(
  cb: (event: FinalTranscriptEvent) => void,
): Promise<UnlistenFn> {
  return listen<{
    text?: string;
    source?: TranscriptSource;
    segments?: TranscriptSegment[];
  }>("voice:final-transcript", (event) => {
    cb({
      text: event.payload?.text ?? "",
      source: normalizeSource(event.payload?.source),
      segments: event.payload?.segments ?? [],
    });
  });
}

export function onPartialTranscript(
  cb: (event: PartialTranscriptEvent) => void,
): Promise<UnlistenFn> {
  return listen<{ text?: string; source?: TranscriptSource }>(
    "voice:partial-transcript",
    (event) => {
      cb({
        text: event.payload?.text ?? "",
        source: normalizeSource(event.payload?.source),
      });
    },
  );
}

export function onSpeechError(
  cb: (event: SpeechErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<{ error?: string; source?: TranscriptSource }>(
    "voice:speech-error",
    (event) => {
      cb({
        error: event.payload?.error ?? "",
        source: normalizeSource(event.payload?.source),
      });
    },
  );
}

export function onAudioLevel(
  cb: (event: AudioLevelEvent) => void,
): Promise<UnlistenFn> {
  return listen<{ level?: number; source?: TranscriptSource }>(
    "voice:audio-level",
    (event) => {
      cb({
        level: event.payload?.level ?? 0,
        source: normalizeSource(event.payload?.source),
      });
    },
  );
}
