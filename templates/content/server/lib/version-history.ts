import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import * as Diff from "diff";

const USER_BATCH_WINDOW_MS = 30_000;
const AGENT_BATCH_WINDOW_MS = 180_000;
const PENDING_WRITE_TTL_MS = 120_000;
const WATCHER_SUPPRESSION_WINDOW_MS = 10_000;
const RECENT_PERSIST_DEDUPE_WINDOW_MS = 15_000;
const MAX_SECTIONS_AFFECTED = 8;
const PROJECTS_ROOT = path.resolve(process.cwd(), "content", "projects");
const VERSION_HISTORY_DIR = path.resolve(
  process.cwd(),
  "content",
  ".version-history",
);

export type VersionActorType = "user" | "agent";
export type VersionSource = "autosave" | "agentWrite" | "restore";

export interface PendingFileWrite {
  actorType: VersionActorType;
  actorId: string;
  actorDisplayName?: string;
  actorEmail?: string;
  source: VersionSource;
  timestamp: number;
  batchId: string;
}

export interface ChangeSummary {
  wordsAdded: number;
  wordsRemoved: number;
  linesChanged: number;
  sectionsAffected: string[];
}

interface VersionHistoryDoc extends PendingFileWrite, ChangeSummary {
  id: string;
  content: string;
}

interface PersistVersionHistoryInput {
  filePath: string;
  content: string;
  fallbackTimestamp?: number;
}

interface MarkdownSection {
  heading: string;
  body: string;
}

const pendingFileWrites = new Map<string, PendingFileWrite>();
const recentAgentBatches = new Map<
  string,
  { batchId: string; timestamp: number }
>();
const suppressedWatcherWrites = new Map<string, number>();
const persistQueueTails = new Map<string, Promise<void>>();
const recentPersistFingerprints = new Map<
  string,
  { fingerprint: string; timestamp: number }
>();

function normalizeVersionHistoryKey(filePath: string) {
  return path.posix.normalize(filePath.replace(/\\/g, "/"));
}

/**
 * Build a canonical path key for a project file (used as the version history key).
 */
export function buildProjectFilePath(project: string, filePath: string) {
  return normalizeVersionHistoryKey(
    path.posix.join("content", "projects", project, filePath),
  );
}

/** @deprecated Alias kept for backward compatibility with route imports */
export const buildProjectFileFirestorePath = buildProjectFilePath;

export function shouldTrackVersionHistory(filePath: string) {
  return (
    filePath.endsWith(".md") &&
    !filePath.includes("/resources/") &&
    !filePath.includes("/shared-resources/")
  );
}

// ---------------------------------------------------------------------------
// File-based version history store
// ---------------------------------------------------------------------------

function getVersionHistoryFilePath(fileKey: string): string {
  const safeKey = fileKey.replace(/\//g, "__");
  return path.join(VERSION_HISTORY_DIR, `${safeKey}.json`);
}

function readVersionHistoryFile(fileKey: string): VersionHistoryDoc[] {
  const filePath = getVersionHistoryFilePath(fileKey);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as VersionHistoryDoc[];
  } catch {
    return [];
  }
}

function writeVersionHistoryFile(fileKey: string, docs: VersionHistoryDoc[]) {
  const filePath = getVersionHistoryFilePath(fileKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), "utf-8");
}

/**
 * Read version history entries for a file, sorted by timestamp ascending.
 */
export function getVersionHistory(fileKey: string): VersionHistoryDoc[] {
  return readVersionHistoryFile(fileKey).sort(
    (a, b) => a.timestamp - b.timestamp,
  );
}

/**
 * Get a single version history entry by ID.
 */
export function getVersionById(
  fileKey: string,
  versionId: string,
): VersionHistoryDoc | null {
  const docs = readVersionHistoryFile(fileKey);
  return docs.find((d) => d.id === versionId) ?? null;
}

// ---------------------------------------------------------------------------
// Batch / pending write logic (unchanged from original)
// ---------------------------------------------------------------------------

function getAgentBatchId(filePath: string, timestamp: number) {
  const normalizedFilePath = normalizeVersionHistoryKey(filePath);
  const existing = recentAgentBatches.get(normalizedFilePath);
  if (existing && timestamp - existing.timestamp <= AGENT_BATCH_WINDOW_MS) {
    existing.timestamp = timestamp;
    return existing.batchId;
  }

  const next = {
    batchId: randomUUID(),
    timestamp,
  };
  recentAgentBatches.set(normalizedFilePath, next);
  return next.batchId;
}

function createPendingFileWrite(
  filePath: string,
  metadata: Omit<PendingFileWrite, "timestamp" | "batchId"> & {
    timestamp?: number;
    batchId?: string;
  },
): PendingFileWrite {
  const timestamp = metadata.timestamp ?? Date.now();

  return {
    ...metadata,
    timestamp,
    batchId:
      metadata.batchId ??
      (metadata.actorType === "agent"
        ? getAgentBatchId(filePath, timestamp)
        : randomUUID()),
  };
}

export function registerPendingFileWrite(
  filePath: string,
  metadata: Omit<PendingFileWrite, "timestamp" | "batchId"> & {
    timestamp?: number;
    batchId?: string;
  },
) {
  const normalizedFilePath = normalizeVersionHistoryKey(filePath);
  pendingFileWrites.set(
    normalizedFilePath,
    createPendingFileWrite(normalizedFilePath, metadata),
  );
}

export function suppressWatcherVersionHistory(
  absFilePath: string,
  ttlMs = WATCHER_SUPPRESSION_WINDOW_MS,
) {
  suppressedWatcherWrites.set(path.resolve(absFilePath), Date.now() + ttlMs);
}

export function shouldSuppressWatcherVersionHistory(absFilePath: string) {
  const normalizedPath = path.resolve(absFilePath);
  const expiresAt = suppressedWatcherWrites.get(normalizedPath);
  if (!expiresAt) {
    return false;
  }

  if (expiresAt <= Date.now()) {
    suppressedWatcherWrites.delete(normalizedPath);
    return false;
  }

  return true;
}

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

export function resolveProjectVersionHistoryTarget(absFilePath: string) {
  const normalizedPath = path.resolve(absFilePath);
  const relativeToProjects = path.relative(PROJECTS_ROOT, normalizedPath);

  if (
    !relativeToProjects ||
    relativeToProjects.startsWith("..") ||
    path.isAbsolute(relativeToProjects)
  ) {
    return null;
  }

  let projectDir = path.dirname(normalizedPath);
  while (projectDir.startsWith(PROJECTS_ROOT) && projectDir !== PROJECTS_ROOT) {
    if (fs.existsSync(path.join(projectDir, ".project.json"))) {
      const projectSlug = toPosixPath(path.relative(PROJECTS_ROOT, projectDir));
      const filePath = toPosixPath(path.relative(projectDir, normalizedPath));
      if (!filePath || filePath.startsWith("..")) {
        return null;
      }

      return {
        projectSlug,
        filePath,
        historyPath: buildProjectFilePath(projectSlug, filePath),
      };
    }

    projectDir = path.dirname(projectDir);
  }

  return null;
}

function consumePendingFileWrite(filePath: string): PendingFileWrite | null {
  const normalizedFilePath = normalizeVersionHistoryKey(filePath);
  const entry = pendingFileWrites.get(normalizedFilePath);
  if (!entry) return null;
  pendingFileWrites.delete(normalizedFilePath);
  if (Date.now() - entry.timestamp > PENDING_WRITE_TTL_MS) {
    return null;
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Change summary helpers
// ---------------------------------------------------------------------------

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function parseMarkdownSections(content: string): MarkdownSection[] {
  const lines = content.split("\n");
  const sections: MarkdownSection[] = [];
  let currentHeading = "(intro)";
  let currentBody: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headingMatch) {
      if (currentBody.length > 0 || currentHeading !== "(intro)") {
        sections.push({
          heading: currentHeading,
          body: currentBody.join("\n"),
        });
      }
      currentHeading = headingMatch[1].trim();
      currentBody = [];
      continue;
    }

    currentBody.push(line);
  }

  sections.push({ heading: currentHeading, body: currentBody.join("\n") });
  return sections;
}

export function detectAffectedSections(oldContent: string, newContent: string) {
  const oldSections = parseMarkdownSections(oldContent);
  const newSections = parseMarkdownSections(newContent);
  const headings = new Set([
    ...oldSections.map((section) => section.heading),
    ...newSections.map((section) => section.heading),
  ]);
  const affected: string[] = [];

  for (const heading of headings) {
    const oldSection = oldSections.find(
      (section) => section.heading === heading,
    );
    const newSection = newSections.find(
      (section) => section.heading === heading,
    );
    if (!oldSection || !newSection || oldSection.body !== newSection.body) {
      affected.push(heading);
    }
  }

  return affected.slice(0, MAX_SECTIONS_AFFECTED);
}

export function computeChangeSummary(
  oldContent: string,
  newContent: string,
): ChangeSummary {
  const wordDiff = Diff.diffWords(oldContent, newContent);
  let wordsAdded = 0;
  let wordsRemoved = 0;

  for (const part of wordDiff) {
    const wordCount = countWords(part.value);
    if (part.added) wordsAdded += wordCount;
    if (part.removed) wordsRemoved += wordCount;
  }

  const lineDiff = Diff.diffLines(oldContent, newContent);
  let linesChanged = 0;
  for (const part of lineDiff) {
    if (part.added || part.removed) {
      linesChanged += part.count ?? 0;
    }
  }

  return {
    wordsAdded,
    wordsRemoved,
    linesChanged,
    sectionsAffected: detectAffectedSections(oldContent, newContent),
  };
}

function getResolvedActorValue(
  nextValue: string | undefined,
  currentValue: unknown,
) {
  if (typeof nextValue === "string" && nextValue.trim()) {
    return nextValue;
  }

  return typeof currentValue === "string" ? currentValue : "";
}

function shouldGroupWithLatest(
  latestVersion: VersionHistoryDoc | null,
  metadata: PendingFileWrite,
  timestamp: number,
) {
  if (!latestVersion) return false;

  if (metadata.actorType === "user") {
    return (
      latestVersion.actorType === "user" &&
      latestVersion.actorId === metadata.actorId &&
      latestVersion.source === "autosave" &&
      timestamp - (latestVersion.timestamp ?? 0) <= USER_BATCH_WINDOW_MS
    );
  }

  return (
    latestVersion.actorType === "agent" &&
    latestVersion.actorId === metadata.actorId &&
    latestVersion.source === metadata.source &&
    latestVersion.batchId === metadata.batchId
  );
}

function buildPersistFingerprint(filePath: string, content: string) {
  return createHash("sha1")
    .update(
      JSON.stringify({
        filePath: normalizeVersionHistoryKey(filePath),
        content,
      }),
    )
    .digest("hex");
}

function wasRecentlyPersisted(
  filePath: string,
  fingerprint: string,
  timestamp: number,
) {
  const recent = recentPersistFingerprints.get(filePath);
  if (!recent) {
    return false;
  }

  if (timestamp - recent.timestamp > RECENT_PERSIST_DEDUPE_WINDOW_MS) {
    recentPersistFingerprints.delete(filePath);
    return false;
  }

  return recent.fingerprint === fingerprint;
}

function markRecentlyPersisted(
  filePath: string,
  fingerprint: string,
  timestamp: number,
) {
  recentPersistFingerprints.set(filePath, { fingerprint, timestamp });
}

async function runPersistSerially<T>(
  filePath: string,
  callback: () => Promise<T>,
) {
  const normalizedFilePath = normalizeVersionHistoryKey(filePath);
  const previous =
    persistQueueTails.get(normalizedFilePath) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  persistQueueTails.set(normalizedFilePath, tail);

  await previous.catch(() => undefined);

  try {
    return await callback();
  } finally {
    releaseCurrent();
    if (persistQueueTails.get(normalizedFilePath) === tail) {
      persistQueueTails.delete(normalizedFilePath);
    }
  }
}

export async function persistVersionHistory({
  filePath,
  content,
  fallbackTimestamp,
}: PersistVersionHistoryInput) {
  const normalizedFilePath = normalizeVersionHistoryKey(filePath);
  if (!shouldTrackVersionHistory(normalizedFilePath)) return;

  return runPersistSerially(normalizedFilePath, async () => {
    const metadata =
      consumePendingFileWrite(normalizedFilePath) ??
      createPendingFileWrite(normalizedFilePath, {
        actorType: "agent",
        actorId: "agent",
        actorDisplayName: "Agent",
        actorEmail: "",
        source: "agentWrite",
        timestamp: fallbackTimestamp ?? Date.now(),
      });

    const timestamp = fallbackTimestamp ?? metadata.timestamp ?? Date.now();
    const fingerprint = buildPersistFingerprint(normalizedFilePath, content);
    if (wasRecentlyPersisted(normalizedFilePath, fingerprint, timestamp)) {
      return;
    }

    const docs = readVersionHistoryFile(normalizedFilePath);
    // Sort descending to find latest
    const sorted = [...docs].sort((a, b) => b.timestamp - a.timestamp);
    const latestVersion = sorted[0] ?? null;

    if (latestVersion && latestVersion.content === content) {
      markRecentlyPersisted(normalizedFilePath, fingerprint, timestamp);
      return;
    }

    if (shouldGroupWithLatest(latestVersion, metadata, timestamp)) {
      const summary = computeChangeSummary(
        latestVersion!.content ?? "",
        content,
      );
      // Update in place
      Object.assign(latestVersion!, {
        ...summary,
        content,
        timestamp,
        actorType: metadata.actorType,
        actorId: metadata.actorId,
        actorDisplayName: getResolvedActorValue(
          metadata.actorDisplayName,
          latestVersion!.actorDisplayName,
        ),
        actorEmail: getResolvedActorValue(
          metadata.actorEmail,
          latestVersion!.actorEmail,
        ),
        source: metadata.source,
        batchId: latestVersion!.batchId || metadata.batchId,
      });
      writeVersionHistoryFile(normalizedFilePath, docs);
      markRecentlyPersisted(normalizedFilePath, fingerprint, timestamp);
      return;
    }

    const previousContent = latestVersion?.content ?? "";
    const summary = computeChangeSummary(previousContent, content);

    docs.push({
      id: randomUUID(),
      ...summary,
      content,
      timestamp,
      actorType: metadata.actorType,
      actorId: metadata.actorId,
      actorDisplayName: metadata.actorDisplayName ?? "",
      actorEmail: metadata.actorEmail ?? "",
      source: metadata.source,
      batchId: metadata.batchId,
    });
    writeVersionHistoryFile(normalizedFilePath, docs);
    markRecentlyPersisted(normalizedFilePath, fingerprint, timestamp);
  });
}
