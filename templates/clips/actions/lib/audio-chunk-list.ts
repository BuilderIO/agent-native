export interface AudioChunkListEntry {
  file: string;
  startMs: number;
  durationMs: number;
}

// Parses ffmpeg's `-segment_list_type csv` output: `file,start,end` per line,
// times in seconds.
export function parseAudioChunkList(csv: string): AudioChunkListEntry[] {
  return csv
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const [file, start, end] = line.split(",");
      const startMs = Math.round(Number(start) * 1000);
      const endMs = Math.round(Number(end) * 1000);
      if (!file || !Number.isFinite(startMs) || !(endMs > startMs)) {
        // guard:allow-bare-error — invariant: malformed ffmpeg output; the caller rethrows it as EXTRACTION_FAILED.
        throw new Error(`Unreadable audio chunk list entry: "${line}"`);
      }
      return { file, startMs, durationMs: endMs - startMs };
    });
}
