/**
 * Live transcription for recordings.
 *
 * Thin wrapper over the shared transcription engine (`transcription-engine.ts`),
 * which runs a local whisper.cpp context over BOTH the microphone and system
 * audio in parallel. Whisper does not end per-utterance, so the workers run
 * continuously until stop, which flushes any trailing speech.
 *
 * The handle exposes `stop()` (returns the full speaker-labelled transcript,
 * after a short grace for trailing finals) and `cancel()` (stops + discards).
 */

import type { UnlistenFn } from "@tauri-apps/api/event";

import {
  appendFinalTranscript,
  onFinalTranscript,
  startTranscriptionEngine,
  stopTranscriptionEngine,
  TranscriptionEngine,
  type SourcedTranscriptSegment,
} from "./transcription-engine";

/** Grace period after stop for whisper to emit any flushed trailing finals. */
const WHISPER_STOP_SETTLE_MS = 1500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export interface CapturedTranscript {
  /** Speaker-labelled text, lines joined by blank lines. */
  text: string;
  /** Real whisper segments with verbatim timestamps. */
  segments: SourcedTranscriptSegment[];
}

export interface TranscriptionCapture {
  stop(): Promise<CapturedTranscript>;
  cancel(): Promise<void>;
}

export async function startTranscriptionCapture(
  mic?: {
    deviceId?: string | null;
    label?: string | null;
  },
  captureSystem: boolean = true,
): Promise<TranscriptionCapture | null> {
  const lines: string[] = [];
  const segments: SourcedTranscriptSegment[] = [];
  let disposed = false;
  const unlistens: UnlistenFn[] = [];

  const cleanup = () => {
    disposed = true;
    unlistens.splice(0).forEach((unlisten) => {
      try {
        unlisten();
      } catch {
        // ignore
      }
    });
  };

  const captured = (): CapturedTranscript => ({
    text: lines.join("\n\n").trim(),
    segments,
  });

  let engine: TranscriptionEngine;
  try {
    unlistens.push(
      await onFinalTranscript((event) => {
        if (disposed) return;
        appendFinalTranscript(event, lines, segments);
      }),
    );

    engine = await startTranscriptionEngine({ mic, captureSystem });
    console.log(
      `[clips-recorder] transcription started (${engine} mic${captureSystem ? "+system" : ""})`,
    );
  } catch (err) {
    cleanup();
    console.warn("[clips-recorder] whisper transcript unavailable:", err);
    return null;
  }

  return {
    async stop() {
      try {
        await stopTranscriptionEngine(engine);
      } catch (err) {
        console.warn("[clips-recorder] transcription stop failed:", err);
        cleanup();
        return captured();
      }
      // Whisper flushes trailing speech on stop; give the finals time to land.
      await wait(WHISPER_STOP_SETTLE_MS);
      cleanup();
      return captured();
    },
    async cancel() {
      try {
        await stopTranscriptionEngine(engine);
      } catch {
        // ignore
      }
      cleanup();
    },
  };
}
