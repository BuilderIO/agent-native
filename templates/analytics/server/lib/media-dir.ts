import { accessSync, constants, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function writableDir(candidate: string): string | null {
  try {
    mkdirSync(candidate, { recursive: true });
    accessSync(candidate, constants.R_OK | constants.W_OK);
    return candidate;
  } catch {
    return null;
  }
}

export function getAnalyticsMediaDir(): string {
  const candidates = [
    process.env.AGENT_NATIVE_MEDIA_DIR,
    import.meta.dirname
      ? path.resolve(import.meta.dirname, "..", "..", "media")
      : undefined,
    path.resolve(process.cwd(), "media"),
    path.join(os.tmpdir(), "agent-native-analytics-media"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const dir = writableDir(candidate);
    if (dir) return dir;
  }

  throw new Error("No writable media directory is available");
}
