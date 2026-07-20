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

const DUPLICATE_TOKEN_OVERLAP = 0.72;
const DUPLICATE_TIME_OVERLAP = 0.35;

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

function normalizedTranscriptText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function transcriptWords(text: string): string[] {
  const normalized = normalizedTranscriptText(text);
  return normalized ? normalized.split(/\s+/) : [];
}

function tokenOverlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;

  const rightWords = new Set(right);
  const sharedWords = new Set(left.filter((word) => rightWords.has(word)));
  return sharedWords.size / Math.min(new Set(left).size, new Set(right).size);
}

function timeOverlapRatio(
  left: SourcedTranscriptSegment,
  right: SourcedTranscriptSegment,
): number {
  const overlapStart = Math.max(left.startMs, right.startMs);
  const overlapEnd = Math.min(left.endMs, right.endMs);
  const overlapMs = Math.max(0, overlapEnd - overlapStart);
  const shorterDuration = Math.max(
    1,
    Math.min(left.endMs - left.startMs, right.endMs - right.startMs),
  );

  return overlapMs / shorterDuration;
}

function isDuplicateTranscriptSegment(
  existing: SourcedTranscriptSegment,
  incoming: SourcedTranscriptSegment,
): boolean {
  if (existing.source === incoming.source) return false;

  const existingText = normalizedTranscriptText(existing.text);
  const incomingText = normalizedTranscriptText(incoming.text);
  const existingWords = transcriptWords(existing.text);
  const incomingWords = transcriptWords(incoming.text);

  if (
    !existingText ||
    !incomingText ||
    existingWords.length < 3 ||
    incomingWords.length < 3
  ) {
    return false;
  }

  if (timeOverlapRatio(existing, incoming) < DUPLICATE_TIME_OVERLAP) {
    return false;
  }

  return (
    existingText === incomingText ||
    tokenOverlap(existingWords, incomingWords) >= DUPLICATE_TOKEN_OVERLAP
  );
}

function isDuplicateTranscriptLine(
  lines: string[],
  source: TranscriptSource,
  text: string,
): boolean {
  const words = transcriptWords(text);
  if (words.length < 4) return false;

  const speaker = speakerFor(source);
  return lines.some((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1 || line.slice(0, separatorIndex) === speaker) {
      return false;
    }

    const existingText = line.slice(separatorIndex + 1);
    const existingWords = transcriptWords(existingText);
    return (
      normalizedTranscriptText(existingText) ===
        normalizedTranscriptText(text) ||
      tokenOverlap(existingWords, words) >= DUPLICATE_TOKEN_OVERLAP
    );
  });
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

  if (event.segments.length === 0) {
    if (isDuplicateTranscriptLine(lines, event.source, text)) return false;

    lines.push(`${speakerFor(event.source)}: ${text}`);
    return true;
  }

  const uniqueSegments = event.segments.filter((segment) => {
    const segText = segment.text?.trim();
    if (!segText) return false;

    return !segments.some((existing) =>
      isDuplicateTranscriptSegment(existing, {
        ...segment,
        text: segText,
        source: event.source,
      }),
    );
  });

  if (uniqueSegments.length === 0) return false;

  lines.push(
    `${speakerFor(event.source)}: ${uniqueSegments
      .map((segment) => segment.text.trim())
      .join(" ")}`,
  );
  for (const seg of uniqueSegments) {
    segments.push({
      startMs: seg.startMs,
      endMs: seg.endMs,
      text: seg.text.trim(),
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

function isUnavailableSelectedMicrophoneError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /selected microphone .+ is not available/i.test(message);
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
  emitPartials: boolean = true,
): Promise<void> {
  if (engine === "whisper") {
    await invoke("audio_transcription_start", {
      meetingId: null,
      locale: recordingTranscriptionLanguage(),
      micDeviceId: mic?.deviceId || null,
      micDeviceLabel: mic?.label || null,
      captureSystem,
      voiceProcessing,
      emitPartials,
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
  /**
   * Emit recurring live partial transcripts while speech is in progress.
   * Meetings render these updates; recordings only persist final segments and
   * disable them to avoid repeatedly transcribing the same growing buffer.
   */
  emitPartials?: boolean;
}): Promise<TranscriptionEngine> {
  const captureSystem = opts.captureSystem ?? true;
  const voiceProcessing = opts.voiceProcessing ?? false;
  const emitPartials = opts.emitPartials ?? true;
  try {
    await restartTranscriptionEngine(
      "whisper",
      opts.mic,
      captureSystem,
      voiceProcessing,
      emitPartials,
    );
    return "whisper";
  } catch (err) {
    let fallbackMic = opts.mic;
    console.warn(
      "[transcription] whisper mic+system failed, falling back to mic-only:",
      err,
    );
    if (opts.mic && isUnavailableSelectedMicrophoneError(err)) {
      console.warn(
        "[transcription] selected microphone is unavailable; retrying with the macOS default input:",
        err,
      );
      try {
        await restartTranscriptionEngine(
          "whisper",
          undefined,
          captureSystem,
          voiceProcessing,
          emitPartials,
        );
        return "whisper";
      } catch (defaultMicErr) {
        console.warn(
          "[transcription] default mic+system capture failed, falling back to default mic-only:",
          defaultMicErr,
        );
        fallbackMic = undefined;
      }
    }
    await restartTranscriptionEngine("macos-native", fallbackMic);
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
