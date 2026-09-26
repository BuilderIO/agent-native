
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type TranscriptSource = "mic" | "system";
export type TranscriptionEngine = "whisper" | "macos-native";

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SourcedTranscriptSegment extends TranscriptSegment {
  source: TranscriptSource;
}

export interface FinalTranscriptEvent {
  text: string;
  source: TranscriptSource;
  segments: TranscriptSegment[];
}

export interface PartialTranscriptEvent {
  text: string;
  source: TranscriptSource;
}

export interface SpeechErrorEvent {
  error: string;
  source: TranscriptSource;
}

export interface AudioLevelEvent {
  level: number;
  source: TranscriptSource;
  synthetic?: boolean;
}

interface MicSelection {
  deviceId?: string | null;
  label?: string | null;
}


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


const ECHO_MATCH_RATIO = 0.65;
const ECHO_MIN_WORDS = 4;
const ECHO_LONG_MATCH_WORDS = 8;
const ECHO_RECENT_LINES = 6;
const ECHO_MAX_START_DELTA_MS = 15_000;

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


export interface TranscriptLine {
  source: TranscriptSource;
  historical?: boolean;
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

export function transcriptLineFromSegment(
  segment: SourcedTranscriptSegment,
): TranscriptLine {
  return { ...lineFromSegments([segment]), historical: true };
}

export function transcriptFullText(lines: TranscriptLine[]): string {
  return lines
    .map((line) => `${speakerFor(line.source)}: ${line.text}`)
    .join("\n\n")
    .trim();
}

function estimatedLineDurationMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length || 1;
  return Math.max(900, words * 420);
}

export function transcriptSegments(
  lines: TranscriptLine[],
): SourcedTranscriptSegment[] {
  const segments: SourcedTranscriptSegment[] = [];
  let cursorMs = 0;
  for (const line of lines) {
    if (line.segments.length) {
      segments.push(...line.segments);
      cursorMs = line.segments.reduce(
        (latest, segment) => Math.max(latest, segment.endMs),
        cursorMs,
      );
      continue;
    }
    const startMs = Math.max(line.startMs ?? cursorMs, cursorMs);
    const endMs = startMs + estimatedLineDurationMs(line.text);
    segments.push({ startMs, endMs, text: line.text, source: line.source });
    cursorMs = endMs;
  }
  return segments;
}

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
  captureSystem?: boolean;
  voiceProcessing?: boolean;
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

export async function stopTranscriptionEngine(
  engine: TranscriptionEngine,
): Promise<void> {
  await invoke(
    engine === "whisper" ? "audio_transcription_stop" : "native_speech_stop",
  );
}

export async function resetTranscriptionTimeline(
  engine: TranscriptionEngine,
  offsetMs: number = 0,
): Promise<void> {
  if (engine !== "whisper") return;
  await invoke("audio_transcription_reset_timeline", {
    offsetMs: Math.max(0, Math.round(offsetMs)),
  });
}


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
  return listen<{
    level?: number;
    source?: TranscriptSource;
    synthetic?: boolean;
  }>("voice:audio-level", (event) => {
    cb({
      level: event.payload?.level ?? 0,
      source: normalizeSource(event.payload?.source),
      synthetic: event.payload?.synthetic === true,
    });
  });
}
