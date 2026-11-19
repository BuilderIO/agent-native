import type { ProbedMediaInfo } from "./video-remux.js";

export interface RecordingMediaFacts {
  durationMs: number;
  width: number;
  height: number;
}

/** Whether an upload left out anything the file itself can answer. */
export function isMissingMediaFacts(given: RecordingMediaFacts): boolean {
  return !given.durationMs || !given.width || !given.height;
}

/**
 * Fills in what an upload left out from what ffmpeg read in the file. A number
 * the upload gave stays: a recorder's own clock is right even when the file it
 * made carries no length.
 */
export function fillMediaFacts(
  given: RecordingMediaFacts,
  probed: ProbedMediaInfo | null,
): RecordingMediaFacts {
  return {
    durationMs: given.durationMs || probed?.durationMs || 0,
    width: given.width || probed?.width || 0,
    height: given.height || probed?.height || 0,
  };
}
