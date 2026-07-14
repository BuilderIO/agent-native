import { appendFile } from "node:fs/promises";

/**
 * Local diagnostics for "why did finishing this recording take minutes":
 * one JSON line per phase in data/upload-timings.log. Cheap append,
 * failures ignored — never let diagnostics break an upload.
 */
export function logUploadTiming(entry: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  appendFile("data/upload-timings.log", `${line}\n`).catch(() => {});
}
