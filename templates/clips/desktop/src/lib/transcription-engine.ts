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

// ---------------------------------------------------------------------------
// Echo de-duplication
// ---------------------------------------------------------------------------
//
// Without headphones the microphone re-records whatever the speakers play, so
// the remote side can reach the transcript twice: cleanly on the system stream
// and, whenever the acoustic guard in `echo_guard.rs` was not confident enough
// to drop it, again on the mic. The leak only ever runs one way, because a call
// app never plays the local user back. So when both streams carry the same
// words at the same time, the system copy is the real one and the mic copy is
// echo — no matter which stream happened to finalize first.

/** Share of the *longer* of the two word lists that has to match. Scoring the
 *  longer side is what keeps a brief interjection ("yeah, I think so") alive
 *  next to a long remote passage that happens to contain those words in order:
 *  echo repeats a whole utterance, it does not sprinkle a few words into one. */
const ECHO_MATCH_RATIO = 0.65;
/** Fewer matched words than this is coincidence, not evidence. */
const ECHO_MIN_WORDS = 4;
/** Words that have to agree before a long in-order run counts as echo on its
 *  own. Two people do not independently say eight of the same words, in the
 *  same order, at the same moment. */
const ECHO_LONG_MATCH_WORDS = 8;
/** How many recently appended lines count as "at the same time".
 *
 *  Arrival order, not timestamps: each stream's Whisper timestamps are
 *  estimates against its own rolling buffer, and the two streams cut those
 *  buffers at their own silences, so the same words routinely carry stamps
 *  seconds apart. Both finals still *arrive* within a second or two of each
 *  other, because they are transcribed from the same sound. Finalized lines also
 *  get a loose timestamp bound below to reject much later deliberate repeats. */
const ECHO_RECENT_LINES = 6;
/** Cross-stream timestamps are approximate, but echo finals should still begin
 *  within this loose bound of each other. */
const ECHO_MAX_START_DELTA_MS = 15_000;

/** Length of the longest common subsequence of two word lists. Subsequence
 *  rather than set intersection because echo repeats the words *in order*,
 *  while two people using the same vocabulary do not — and rather than exact
 *  equality because Whisper mangles echo with dropped and substituted words. */
function commonWordRun(left: string[], right: string[]): number {
  let previous = new Array<number>(right.length + 1).fill(0);
  let current = new Array<number>(right.length + 1).fill(0);
  for (const word of left) {
    for (let index = 0; index < right.length; index++) {
      current[index + 1] =
        word === right[index]
          ? previous[index] + 1
          : Math.max(current[index], previous[index + 1]);
    }
    [previous, current] = [current, previous];
  }
  return previous[right.length];
}

/** Whether `text` heard on the mic is the speakers bleeding back into it.
 *
 *  Exported because the live overlay has to make the same call on in-flight
 *  partials, which never reach `appendFinalTranscript`.
 *
 *  Scored against every contiguous run of the recent system lines, not against
 *  all of them glued together: the two streams cut speech at different points,
 *  so one mic line can echo a single system line or straddle two, and gluing an
 *  unrelated third one in would bury the match. */
export function isMicEcho(
  text: string,
  lines: TranscriptLine[],
  startMs: number | null = null,
): boolean {
  const words = transcriptWords(text);
  if (words.length < ECHO_MIN_WORDS) return false;

  const nearby = lines
    .slice(-ECHO_RECENT_LINES)
    .filter(
      (line) =>
        line.source === "system" &&
        !line.historical &&
        (startMs === null ||
          line.startMs === null ||
          Math.abs(startMs - line.startMs) <= ECHO_MAX_START_DELTA_MS),
    )
    .map((line) => transcriptWords(line.text));

  for (let start = 0; start < nearby.length; start++) {
    const run: string[] = [];
    for (let end = start; end < nearby.length; end++) {
      run.push(...nearby[end]);
      const matched = commonWordRun(words, run);
      if (matched < ECHO_MIN_WORDS) continue;
      // Either the two are the same length and mostly agree, or they agree on
      // a stretch long enough that nothing but echo explains it.
      const sameUtterance =
        matched / Math.max(words.length, run.length) >= ECHO_MATCH_RATIO;
      const longRun =
        matched >= ECHO_LONG_MATCH_WORDS &&
        matched / words.length >= ECHO_MATCH_RATIO;
      if (sameUtterance || longRun) return true;
    }
  }
  return false;
}

/** Drop the recent mic lines that a just-appended system line exposes as echo. */
function retractMicEcho(lines: TranscriptLine[]): void {
  const snapshot = [...lines];
  const oldest = Math.max(0, snapshot.length - ECHO_RECENT_LINES);
  const removals: number[] = [];
  for (let index = snapshot.length - 1; index >= oldest; index--) {
    const line = snapshot[index];
    if (line.source !== "mic" || line.historical) continue;
    const evidence = snapshot.slice(index, index + ECHO_RECENT_LINES);
    if (isMicEcho(line.text, evidence, line.startMs)) removals.push(index);
  }
  for (const index of removals) lines.splice(index, 1);
}

// ---------------------------------------------------------------------------
// Transcript lines
// ---------------------------------------------------------------------------

/** One speaker-labelled transcript line. `segments` carries the verbatim
 *  Whisper timings behind the line and is empty for the mic-only fallback
 *  engines, which report no timestamps. */
export interface TranscriptLine {
  source: TranscriptSource;
  /** Preloaded lines are display/persistence data, not live echo evidence. */
  historical?: boolean;
  /** Meeting-timeline position, or null from an engine that reports none.
   *  Not 0 — the overlay renders a timestamp for every line that has one, and
   *  "start of the meeting" is a different claim from "unknown". */
  startMs: number | null;
  text: string;
  segments: SourcedTranscriptSegment[];
}

function lineFromSegments(
  segments: SourcedTranscriptSegment[],
): TranscriptLine {
  return {
    source: segments[0].source,
    startMs: segments[0].startMs,
    text: segments.map((segment) => segment.text).join(" "),
    segments,
  };
}

/** Rebuild a line from a stored segment, for preloaded transcript history. */
export function transcriptLineFromSegment(
  segment: SourcedTranscriptSegment,
): TranscriptLine {
  return { ...lineFromSegments([segment]), historical: true };
}

/** Speaker-labelled text, as persisted by `save-browser-transcript`. */
export function transcriptFullText(lines: TranscriptLine[]): string {
  return lines
    .map((line) => `${speakerFor(line.source)}: ${line.text}`)
    .join("\n\n")
    .trim();
}

/** Flattened verbatim segments, as persisted alongside the text. */
export function transcriptSegments(
  lines: TranscriptLine[],
): SourcedTranscriptSegment[] {
  return lines.flatMap((line) => line.segments);
}

/**
 * Fold a final-transcript event into a running transcript, dropping mic speech
 * that only echoes the system audio and retracting mic lines that a later
 * system line exposes as echo. Mutates `lines` in place; returns whether the
 * transcript changed.
 */
export function appendFinalTranscript(
  event: FinalTranscriptEvent,
  lines: TranscriptLine[],
): boolean {
  const text = event.text.trim();
  if (!text) return false;

  const segments: SourcedTranscriptSegment[] = event.segments
    .map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text?.trim() ?? "",
      source: event.source,
    }))
    .filter((segment) => segment.text.length > 0);

  // One event is one stream's take on one utterance, so the whole line is the
  // unit that is or is not echo. Engines without timestamps still produce a
  // line, just one carrying no segments behind it.
  const line: TranscriptLine = segments.length
    ? lineFromSegments(segments)
    : { source: event.source, startMs: null, text, segments: [] };

  if (line.source === "mic") {
    if (isMicEcho(line.text, lines, line.startMs)) return false;
    lines.push(line);
    return true;
  }

  lines.push(line);
  retractMicEcho(lines);
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

function transcriptionStartError(
  error: unknown,
  selectedMicrophoneUnavailable: boolean,
): Error {
  if (selectedMicrophoneUnavailable) {
    return new Error(
      "Your selected microphone is no longer available. Clips tried your Mac's default microphone, but notes still could not start. Choose an available microphone in Clips settings, then try again.",
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  if (
    /screencapturekit|voiceprocessingi|microphone|audio capture|local .*capture/i.test(
      message,
    )
  ) {
    return new Error(
      "Clips could not start local audio capture. Check that Clips has Microphone and Screen Recording access in System Settings, then try again.",
    );
  }

  return new Error("Clips could not start local transcription. Try again.");
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
    const selectedMicrophoneUnavailable =
      Boolean(opts.mic) && isUnavailableSelectedMicrophoneError(err);
    console.warn(
      "[transcription] whisper mic+system failed, falling back to mic-only:",
      err,
    );
    if (selectedMicrophoneUnavailable) {
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
    try {
      await restartTranscriptionEngine("macos-native", fallbackMic);
      return "macos-native";
    } catch (fallbackErr) {
      throw transcriptionStartError(
        fallbackErr,
        selectedMicrophoneUnavailable ||
          (Boolean(opts.mic) &&
            isUnavailableSelectedMicrophoneError(fallbackErr)),
      );
    }
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
