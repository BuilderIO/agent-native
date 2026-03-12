import fs from "fs";
import path from "path";
import { minimatch } from "minimatch";

export interface SyncConfig {
  syncFilePatterns: string[];
  privateSyncFilePatterns: string[];
}

/**
 * Load sync configuration from a JSON file.
 * Returns empty patterns if the file doesn't exist or is malformed.
 */
export function loadSyncConfig(configPath?: string): SyncConfig {
  const resolved =
    configPath ?? path.resolve(process.cwd(), "content/sync-config.json");
  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      syncFilePatterns: Array.isArray(parsed.syncFilePatterns)
        ? parsed.syncFilePatterns
        : [],
      privateSyncFilePatterns: Array.isArray(parsed.privateSyncFilePatterns)
        ? parsed.privateSyncFilePatterns
        : [],
    };
  } catch {
    return { syncFilePatterns: [], privateSyncFilePatterns: [] };
  }
}

/**
 * Check if a file path matches the configured sync patterns.
 * A file matches if it matches at least one positive pattern and no negation patterns.
 */
export function shouldSyncFile(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;

  const negations = patterns.filter((p) => p.startsWith("!"));
  const positives = patterns.filter((p) => !p.startsWith("!"));

  const matchesPositive = positives.some((p) =>
    minimatch(filePath, p, { dot: true }),
  );
  if (!matchesPositive) return false;

  const matchesNegation = negations.some((p) =>
    minimatch(filePath, p.slice(1), { dot: true }),
  );
  if (matchesNegation) return false;

  return true;
}

/**
 * Generate a deterministic Firestore doc ID from a file path.
 * Prefixed with the app ID, path separators replaced with `__`.
 */
export function getDocId(appId: string, filePath: string): string {
  return `${appId}__${filePath.replace(/\//g, "__")}`;
}
