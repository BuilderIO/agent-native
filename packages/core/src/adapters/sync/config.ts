import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { Minimatch } from "minimatch";
import type { SafePath, ContentHash, ValidIdentifier } from "./types.js";

// ---------------------------------------------------------------------------
// Sync denylist — non-overridable, checked before user patterns
// ---------------------------------------------------------------------------

const SYNC_DENYLIST = [
  // Secrets and credentials
  "**/.env*", "**/*.key", "**/*.pem", "**/*.p12", "**/*.pfx",
  "**/credentials.json", "**/service-account*.json",
  "**/.ssh/**", "**/.npmrc", "**/.pypirc", "**/.yarnrc.yml",
  "**/*.jks", "**/.docker/config.json", "**/.aws/**",
  "**/id_rsa*", "**/id_ed25519*", "**/id_ecdsa*",
  // Infrastructure
  "**/.git/**", "**/node_modules/**",
  "**/*.sqlite", "**/*.db", "**/*.tfstate*",
  // Sync meta-files (prevents meta-sync attack)
  "**/sync-config.json", "**/.sync-status.json", "**/.sync-failures.json",
  // Editor temp files
  "**/*~", "**/*.swp", "**/*.swo", "**/.#*", "**/#*#",
  // OS metadata
  "**/.DS_Store", "**/Thumbs.db", "**/desktop.ini",
  // Conflict files (prevents feedback loop)
  "**/*.conflict",
  // Agent scratch space
  "**/_tmp-*",
];

// Pre-compiled denylist matchers (created once at module load)
const compiledDenylist = SYNC_DENYLIST.map(
  (p) => new Minimatch(p, { dot: true }),
);

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface SyncConfig {
  syncFilePatterns: string[];
  privateSyncFilePatterns: string[];
}

interface CompiledPatterns {
  positives: Minimatch[];
  negations: Minimatch[];
}

// ---------------------------------------------------------------------------
// Pattern compilation cache
// ---------------------------------------------------------------------------

const patternCache = new Map<string, CompiledPatterns>();

function compilePatterns(patterns: string[]): CompiledPatterns {
  const key = patterns.join("\0");
  const cached = patternCache.get(key);
  if (cached) return cached;

  const positives = patterns
    .filter((p) => !p.startsWith("!"))
    .map((p) => new Minimatch(p, { dot: true }));
  const negations = patterns
    .filter((p) => p.startsWith("!"))
    .map((p) => new Minimatch(p.slice(1), { dot: true }));

  const compiled = { positives, negations };
  patternCache.set(key, compiled);
  return compiled;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

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

    const syncFilePatterns = validatePatterns(parsed.syncFilePatterns);
    const privateSyncFilePatterns = validatePatterns(
      parsed.privateSyncFilePatterns,
    );

    return { syncFilePatterns, privateSyncFilePatterns };
  } catch {
    return { syncFilePatterns: [], privateSyncFilePatterns: [] };
  }
}

function validatePatterns(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => {
    if (typeof p !== "string") return false;
    if (p.length > 200) {
      console.warn(
        `[file-sync] Pattern rejected (>200 chars, potential ReDoS): ${p.slice(0, 50)}...`,
      );
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// File matching
// ---------------------------------------------------------------------------

/**
 * Check if a file is blocked by the hardcoded denylist.
 */
export function isDenylisted(filePath: string): boolean {
  return compiledDenylist.some((m) => m.match(filePath));
}

/**
 * Check if a file path matches the configured sync patterns.
 * Returns false for denylisted files regardless of user patterns.
 */
export function shouldSyncFile(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;

  // Denylist always wins
  if (isDenylisted(filePath)) return false;

  const { positives, negations } = compilePatterns(patterns);

  const matchesPositive = positives.some((m) => m.match(filePath));
  if (!matchesPositive) return false;

  const matchesNegation = negations.some((m) => m.match(filePath));
  if (matchesNegation) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Doc ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic doc ID from a file path.
 * Uses `:` separator (cannot appear in filenames on any OS).
 */
export function getDocId(appId: string, filePath: string): string {
  return `${appId}:${filePath}`;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/**
 * Validate that a string is safe for use as a database filter parameter.
 * Prevents filter injection in Supabase Realtime expressions.
 */
export function validateIdentifier(
  name: string,
  value: string,
): ValidIdentifier {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(
      `[file-sync] Invalid ${name}: must be alphanumeric/hyphens/underscores, got "${value}"`,
    );
  }
  return value as ValidIdentifier;
}

// ---------------------------------------------------------------------------
// Content hashing
// ---------------------------------------------------------------------------

export function hashContent(content: string): ContentHash {
  return createHash("sha256").update(content).digest("hex") as ContentHash;
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Validate that a relative path resolves inside the project root.
 * Uses OWASP-recommended canonicalize-then-verify approach.
 */
export function assertSafePath(
  root: string,
  untrustedRelPath: string,
): SafePath {
  if (!untrustedRelPath || untrustedRelPath.includes("\0")) {
    throw new Error(`[file-sync] Invalid path: empty or contains null byte`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, untrustedRelPath);
  if (
    !resolved.startsWith(resolvedRoot + path.sep) &&
    resolved !== resolvedRoot
  ) {
    throw new Error(
      `[file-sync] Path traversal blocked: ${untrustedRelPath}`,
    );
  }
  // Check for symlink-based escapes within project root
  const parentDir = path.dirname(resolved);
  if (fs.existsSync(parentDir)) {
    const realParent = fs.realpathSync(parentDir);
    if (
      !realParent.startsWith(resolvedRoot + path.sep) &&
      realParent !== resolvedRoot
    ) {
      throw new Error(
        `[file-sync] Symlink escape blocked: ${untrustedRelPath}`,
      );
    }
  }
  return resolved as SafePath;
}

/**
 * Assert that a file path is not a symlink (prevents write-through-symlink attacks).
 */
export function assertNotSymlink(filePath: string): void {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      throw new Error(
        `[file-sync] Refusing to write through symlink: ${filePath}`,
      );
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // File doesn't exist yet — safe to create
  }
}
