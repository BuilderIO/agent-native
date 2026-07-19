import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { queryScreenMemoryContext } from "../mcp-client/screen-memory-local.js";

interface ScreenMemorySegment {
  id: string;
  startedAt: string;
  endedAt: string;
  path: string;
  fileName?: string;
  mimeType: string;
  bytes: number;
  durationMs: number;
  corrupt?: boolean;
  excluded?: boolean;
  exclusionTainted?: boolean;
  tainted?: boolean;
}

export interface ScreenMemoryChapter {
  id: string;
  /** In v2, chapter identity survives later semantic refinements. */
  revision: number;
  aliases: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  label: string;
  summary: string;
  keywords: string[];
  accessibilitySummary: string;
  accessibilityKeywords: string[];
  confidence: number;
  segmentRefs: Array<{ id: string; startedAt: string; endedAt: string }>;
  sceneRefs: Array<{ id: string; startedAt?: string; endedAt?: string }>;
  evidenceRefs: Array<{
    sourceType: string;
    sourceKind?: string;
    segmentId?: string;
    offsetMs?: number;
    capturedAt?: string;
    keywords?: string[];
    confidence?: number;
  }>;
  contexts: Array<{
    appName?: string;
    windowTitle?: string;
    bundleId?: string;
  }>;
  representativeMoments: Array<{
    momentId: string;
    capturedAt: string;
    segmentId: string;
    offsetMs: number;
    reason: string;
  }>;
  representativeCoverage?:
    | string
    | { coveredScenes: number; totalScenes: number; truncated: boolean };
  ambiguityReasons: string[];
  indexState: "pending" | "partial" | "ready";
}

export interface ScreenMemoryChaptersDocument {
  schemaVersion: 1 | 2;
  generatedAt: string;
  state: string;
  coverage: unknown;
  chapters: ScreenMemoryChapter[];
}

export interface ScreenMemoryFrameDecoder {
  (segmentPath: string, offsetMs: number): Buffer;
}

interface ScreenMemoryConfig {
  enabled?: boolean;
  paused?: boolean;
  retentionHours?: number;
  maxBytes?: number;
  reviewBeforeSending?: boolean;
  agentClipRetention?: "forever" | "24-hours" | "7-days" | "30-days";
}

export interface RunScreenMemoryMCPStdioOptions {
  storeDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Test seam; production uses the local ffmpeg executable. */
  decodeFrame?: ScreenMemoryFrameDecoder;
}

const MAX_CHAPTERS = 12;
const MAX_FRAME_BYTES = 900_000;
const MAX_FRAME_EDGE = 1280;
const SEARCH_STOP_WORDS = new Set([
  "and",
  "for",
  "from",
  "that",
  "the",
  "this",
  "was",
  "were",
  "what",
  "when",
  "with",
  "work",
  "working",
]);

function log(msg: string): void {
  process.stderr.write(`[screen-memory-mcp] ${msg}\n`);
}

function defaultAppDataDir(env: NodeJS.ProcessEnv): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "com.clips.tray");
  }
  if (process.platform === "win32") {
    return path.join(
      env.APPDATA || path.join(home, "AppData", "Roaming"),
      "com.clips.tray",
    );
  }
  return path.join(
    env.XDG_DATA_HOME || path.join(home, ".local", "share"),
    "com.clips.tray",
  );
}

function defaultStoreDir(env: NodeJS.ProcessEnv): string {
  const envDir =
    env.AGENT_NATIVE_SCREEN_MEMORY_DIR ?? env.CLIPS_SCREEN_MEMORY_DIR;
  if (envDir) return envDir;
  return path.join(defaultAppDataDir(env), "screen-memory");
}

function readFeatureConfig(storeDir: string): ScreenMemoryConfig {
  const configPath = path.join(path.dirname(storeDir), "feature-config.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      screenMemory?: ScreenMemoryConfig;
    };
    return parsed.screenMemory ?? {};
  } catch {
    return {};
  }
}

function cutoffFor(minutes: number): number {
  return Date.now() - Math.max(1, Math.min(minutes, 24 * 60)) * 60_000;
}

function readSegments(storeDir: string): ScreenMemorySegment[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(storeDir);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(storeDir, entry), "utf-8"),
        ) as ScreenMemorySegment;
      } catch {
        return null;
      }
    })
    .filter((segment): segment is ScreenMemorySegment => Boolean(segment));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, 2_000) : fallback;
}

function cleanKeywords(value: unknown, limit = 12): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => cleanText(item).slice(0, 80))
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

function parseChapter(value: unknown): ScreenMemoryChapter | null {
  if (
    !isRecord(value) ||
    !isTimestamp(value.startedAt) ||
    !isTimestamp(value.endedAt)
  )
    return null;
  const id = cleanText(value.id);
  if (!id) return null;
  const indexState = value.indexState;
  if (
    indexState !== "pending" &&
    indexState !== "partial" &&
    indexState !== "ready"
  )
    return null;
  const segmentRefs = Array.isArray(value.segmentRefs)
    ? value.segmentRefs.flatMap((ref) =>
        isRecord(ref) &&
        cleanText(ref.id) &&
        isTimestamp(ref.startedAt) &&
        isTimestamp(ref.endedAt)
          ? [
              {
                id: cleanText(ref.id),
                startedAt: ref.startedAt,
                endedAt: ref.endedAt,
              },
            ]
          : [],
      )
    : [];
  const evidenceRefs = Array.isArray(value.evidenceRefs)
    ? value.evidenceRefs.flatMap((ref) =>
        isRecord(ref) && cleanText(ref.sourceType)
          ? [
              {
                sourceType: cleanText(ref.sourceType),
                ...(cleanText(ref.sourceKind)
                  ? { sourceKind: cleanText(ref.sourceKind) }
                  : {}),
                ...(cleanText(ref.segmentId)
                  ? { segmentId: cleanText(ref.segmentId) }
                  : {}),
                ...(typeof ref.offsetMs === "number" &&
                Number.isFinite(ref.offsetMs)
                  ? { offsetMs: ref.offsetMs }
                  : {}),
                ...(isTimestamp(ref.capturedAt)
                  ? { capturedAt: ref.capturedAt }
                  : {}),
                ...(cleanKeywords(ref.keywords, 64).length
                  ? { keywords: cleanKeywords(ref.keywords, 64) }
                  : {}),
                ...(typeof ref.confidence === "number" &&
                Number.isFinite(ref.confidence)
                  ? { confidence: Math.max(0, Math.min(1, ref.confidence)) }
                  : {}),
              },
            ]
          : [],
      )
    : [];
  const sceneRefs = Array.isArray(value.sceneRefs)
    ? value.sceneRefs.flatMap((ref) =>
        typeof ref === "string" && cleanText(ref)
          ? [{ id: cleanText(ref) }]
          : isRecord(ref) && cleanText(ref.id)
            ? [
                {
                  id: cleanText(ref.id),
                  ...(isTimestamp(ref.startedAt)
                    ? { startedAt: ref.startedAt }
                    : {}),
                  ...(isTimestamp(ref.endedAt) ? { endedAt: ref.endedAt } : {}),
                },
              ]
            : [],
      )
    : [];
  const representativeCoverage = isRecord(value.representativeCoverage)
    ? typeof value.representativeCoverage.coveredScenes === "number" &&
      Number.isFinite(value.representativeCoverage.coveredScenes) &&
      typeof value.representativeCoverage.totalScenes === "number" &&
      Number.isFinite(value.representativeCoverage.totalScenes) &&
      typeof value.representativeCoverage.truncated === "boolean"
      ? {
          coveredScenes: Math.max(
            0,
            Math.trunc(value.representativeCoverage.coveredScenes),
          ),
          totalScenes: Math.max(
            0,
            Math.trunc(value.representativeCoverage.totalScenes),
          ),
          truncated: value.representativeCoverage.truncated,
        }
      : undefined
    : cleanText(value.representativeCoverage) || undefined;
  const contexts = Array.isArray(value.contexts)
    ? value.contexts.flatMap((context) =>
        isRecord(context)
          ? [
              {
                ...(cleanText(context.appName)
                  ? { appName: cleanText(context.appName) }
                  : {}),
                ...(cleanText(context.windowTitle)
                  ? { windowTitle: cleanText(context.windowTitle) }
                  : {}),
                ...(cleanText(context.bundleId)
                  ? { bundleId: cleanText(context.bundleId) }
                  : {}),
              },
            ]
          : [],
      )
    : [];
  const representativeMoments = Array.isArray(value.representativeMoments)
    ? value.representativeMoments.flatMap((moment) =>
        isRecord(moment) &&
        cleanText(moment.momentId) &&
        isTimestamp(moment.capturedAt) &&
        cleanText(moment.segmentId) &&
        typeof moment.offsetMs === "number" &&
        Number.isFinite(moment.offsetMs)
          ? [
              {
                momentId: cleanText(moment.momentId),
                capturedAt: moment.capturedAt,
                segmentId: cleanText(moment.segmentId),
                offsetMs: moment.offsetMs,
                reason: cleanText(moment.reason),
              },
            ]
          : [],
      )
    : [];
  return {
    id,
    revision:
      typeof value.revision === "number" &&
      Number.isInteger(value.revision) &&
      value.revision >= 0
        ? value.revision
        : 1,
    aliases: cleanKeywords(value.aliases, 24),
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    durationMs:
      typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
        ? value.durationMs
        : Date.parse(value.endedAt) - Date.parse(value.startedAt),
    label: cleanText(value.label, "Untitled work chapter"),
    summary: cleanText(value.summary),
    keywords: cleanKeywords(value.keywords),
    accessibilitySummary: cleanText(value.accessibilitySummary),
    accessibilityKeywords: cleanKeywords(value.accessibilityKeywords),
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? Math.max(0, Math.min(1, value.confidence))
        : 0,
    segmentRefs,
    sceneRefs,
    evidenceRefs,
    contexts,
    representativeMoments,
    ...(representativeCoverage ? { representativeCoverage } : {}),
    ambiguityReasons: Array.isArray(value.ambiguityReasons)
      ? value.ambiguityReasons
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.slice(0, 500))
          .slice(0, 8)
      : [],
    indexState,
  };
}

/** Reads only the native, retention-bound chapter manifest; malformed rows never escape. */
export function readScreenMemoryChapters(
  storeDir: string,
): ScreenMemoryChaptersDocument | null {
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(storeDir, "chapters.json"), "utf8"),
    );
    if (
      !isRecord(raw) ||
      (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) ||
      !isTimestamp(raw.generatedAt) ||
      typeof raw.state !== "string" ||
      !Array.isArray(raw.chapters)
    )
      return null;
    const chapters = raw.chapters
      .map(parseChapter)
      .filter((chapter): chapter is ScreenMemoryChapter => Boolean(chapter));
    if (chapters.length !== raw.chapters.length) return null;
    return {
      schemaVersion: raw.schemaVersion,
      generatedAt: raw.generatedAt,
      state: raw.state,
      coverage: raw.coverage ?? null,
      chapters,
    };
  } catch {
    return null;
  }
}

type MatchProvenance = {
  sourceType: string;
  sourceKind?: string;
  confidence?: number;
  matchedTerms: string[];
};

function textIncludes(value: string, term: string): boolean {
  return value.toLowerCase().includes(term);
}

function isMicrophoneEvidence(
  ref: ScreenMemoryChapter["evidenceRefs"][number],
) {
  return /microphone|mic/.test(
    `${ref.sourceType} ${ref.sourceKind ?? ""}`.toLowerCase(),
  );
}

function isStrongScreenEvidence(
  ref: ScreenMemoryChapter["evidenceRefs"][number],
) {
  return /accessibility|ocr|visible|screen|visual/.test(
    `${ref.sourceType} ${ref.sourceKind ?? ""}`.toLowerCase(),
  );
}

export function searchScreenMemoryChapters(
  document: ScreenMemoryChaptersDocument,
  query: string,
  limit = 5,
  clientHint?: string,
): Array<
  ScreenMemoryChapter & {
    score: number;
    matchReasons: string[];
    matchProvenance: MatchProvenance[];
  }
> {
  const terms = (
    query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []
  ).filter((term) => !SEARCH_STOP_WORDS.has(term));
  const exactPhrase = query.trim().toLowerCase();
  const hint = clientHint?.toLowerCase().slice(0, 500) ?? "";
  return document.chapters
    .map((chapter) => {
      const strongText = [
        chapter.label,
        chapter.summary,
        ...chapter.keywords,
        chapter.accessibilitySummary,
        ...chapter.accessibilityKeywords,
      ]
        .filter(Boolean)
        .join(" ");
      const contextText = chapter.contexts
        .flatMap((context) => [
          context.appName,
          context.windowTitle,
          context.bundleId,
        ])
        .filter(Boolean)
        .join(" ");
      const strongMatched = terms.filter((term) =>
        textIncludes(strongText, term),
      );
      const contextMatched = terms.filter((term) =>
        textIncludes(contextText, term),
      );
      const evidenceMatches = chapter.evidenceRefs.flatMap((ref) => {
        const matchedTerms = terms.filter((term) =>
          (ref.keywords ?? []).some((keyword) => textIncludes(keyword, term)),
        );
        return matchedTerms.length ? [{ ref, matchedTerms }] : [];
      });
      const corroboratedTerms = new Set([
        ...strongMatched,
        ...evidenceMatches
          .filter(({ ref }) => isStrongScreenEvidence(ref))
          .flatMap(({ matchedTerms }) => matchedTerms),
      ]);
      const evidenceScore = evidenceMatches.reduce(
        (sum, { ref, matchedTerms }) => {
          const sourceWeight = isStrongScreenEvidence(ref)
            ? 1.5
            : isMicrophoneEvidence(ref)
              ? matchedTerms.filter((term) => corroboratedTerms.has(term))
                  .length
                ? 0.12
                : 0
              : /transcript/.test(
                    `${ref.sourceType} ${ref.sourceKind ?? ""}`.toLowerCase(),
                  )
                ? 0.3
                : 0.5;
          return (
            sum + sourceWeight * matchedTerms.length * (ref.confidence ?? 1)
          );
        },
        0,
      );
      const exactStrong =
        exactPhrase.length >= 2 && textIncludes(strongText, exactPhrase);
      const exactEvidence = chapter.evidenceRefs.some(
        (ref) =>
          isStrongScreenEvidence(ref) &&
          (ref.keywords ?? []).some((keyword) =>
            textIncludes(keyword, exactPhrase),
          ),
      );
      const semanticScore = terms.length
        ? (strongMatched.length * 1.2 +
            contextMatched.length * 0.2 +
            evidenceScore) /
            terms.length +
          (exactStrong || exactEvidence ? 2 : 0)
        : 0;
      // A hint may only settle an otherwise close semantic result; it cannot make a non-match win.
      const hintScore =
        semanticScore > 0 &&
        hint &&
        (textIncludes(strongText, hint) || textIncludes(contextText, hint))
          ? 0.03
          : 0;
      const score = semanticScore + hintScore + chapter.confidence * 0.001;
      return {
        ...chapter,
        score,
        semanticScore,
        matchReasons: [
          ...(exactStrong || exactEvidence
            ? [
                `exact phrase \"${exactPhrase}\" matched visible or accessibility evidence`,
              ]
            : []),
          ...strongMatched.map(
            (term) =>
              `matched \"${term}\" in chapter or accessibility evidence`,
          ),
          ...contextMatched.map(
            (term) => `matched \"${term}\" in app or document context`,
          ),
          ...evidenceMatches.flatMap(({ ref, matchedTerms }) =>
            matchedTerms.map((term) =>
              isMicrophoneEvidence(ref) && !corroboratedTerms.has(term)
                ? `ignored uncorroborated microphone match \"${term}\"`
                : `matched \"${term}\" in ${ref.sourceType}${ref.sourceKind ? `/${ref.sourceKind}` : ""} evidence`,
            ),
          ),
          ...(hintScore ? ["client hint weakly broke a close tie"] : []),
        ],
        matchProvenance: evidenceMatches.map(({ ref, matchedTerms }) => ({
          sourceType: ref.sourceType,
          ...(ref.sourceKind ? { sourceKind: ref.sourceKind } : {}),
          ...(typeof ref.confidence === "number"
            ? { confidence: ref.confidence }
            : {}),
          matchedTerms,
        })),
      };
    })
    .filter((chapter) => chapter.semanticScore > 0)
    .sort((a, b) => b.score - a.score || b.endedAt.localeCompare(a.endedAt))
    .slice(0, Math.min(Math.max(Math.trunc(limit), 1), MAX_CHAPTERS))
    .map(({ semanticScore: _semanticScore, ...chapter }) => chapter);
}

export function projectScreenMemoryChapterCandidate(
  chapter: ReturnType<typeof searchScreenMemoryChapters>[number],
) {
  const evidenceSources = [
    ...new Set(
      chapter.evidenceRefs.map(
        (reference) =>
          `${reference.sourceType}${reference.sourceKind ? `/${reference.sourceKind}` : ""}`,
      ),
    ),
  ].slice(0, 8);
  return {
    id: chapter.id,
    revision: chapter.revision,
    aliases: chapter.aliases.slice(0, 8),
    startedAt: chapter.startedAt,
    endedAt: chapter.endedAt,
    durationMs: chapter.durationMs,
    label: redactCredentialText(chapter.label),
    summary: redactCredentialText(chapter.summary),
    keywords: chapter.keywords.slice(0, 8),
    confidence: chapter.confidence,
    sceneCount: chapter.sceneRefs.length,
    evidenceSources,
    contexts: chapter.contexts.slice(0, 6),
    representativeMoments: chapter.representativeMoments
      .slice(0, 8)
      .map(({ momentId, capturedAt, reason }) => ({
        momentId,
        capturedAt,
        reason,
      })),
    representativeCoverage: chapter.representativeCoverage,
    ambiguityReasons: chapter.ambiguityReasons.slice(0, 8),
    indexState: chapter.indexState,
    score: chapter.score,
    matchReasons: chapter.matchReasons.slice(0, 8),
    matchProvenance: chapter.matchProvenance.slice(0, 6),
  };
}

function decodeFrameWithFfmpeg(segmentPath: string, offsetMs: number): Buffer {
  const result = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-ss",
      (Math.max(0, offsetMs) / 1000).toFixed(3),
      "-i",
      segmentPath,
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${MAX_FRAME_EDGE},iw)':-2`,
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ],
    { encoding: null, maxBuffer: MAX_FRAME_BYTES + 1 },
  );
  if (result.error || result.status !== 0 || !result.stdout?.length)
    throw new Error(
      "Local frame decoding is unavailable because ffmpeg could not decode this retained segment.",
    );
  if (result.stdout.length > MAX_FRAME_BYTES)
    throw new Error("The decoded frame exceeded the local byte cap.");
  return result.stdout;
}

function retainedSegmentAt(
  storeDir: string,
  timestamp: string,
): ScreenMemorySegment {
  const target = Date.parse(timestamp);
  if (!Number.isFinite(target))
    throw new Error("timestamp must be a valid RFC3339 timestamp.");
  if (target > Date.now() + 5_000)
    throw new Error("A Rewind frame cannot be requested from the future.");
  const segment = readSegments(storeDir).find(
    (candidate) =>
      Date.parse(candidate.startedAt) <= target &&
      target <= Date.parse(candidate.endedAt),
  );
  if (!segment)
    throw new Error(
      "No clean retained Rewind segment covers that timestamp (it may be outside retention or in a coverage gap).",
    );
  if (!segment.path || !fs.existsSync(segment.path))
    throw new Error("That Rewind segment is no longer retained locally.");
  if (segment.corrupt)
    throw new Error(
      "That Rewind segment is corrupt and cannot provide a frame.",
    );
  if (segment.excluded || segment.exclusionTainted || segment.tainted)
    throw new Error(
      "That Rewind interval was excluded from capture and cannot provide a frame.",
    );
  return segment;
}

function frameContent(
  segment: ScreenMemorySegment,
  timestamp: string,
  decoder: ScreenMemoryFrameDecoder,
) {
  const offsetMs = Date.parse(timestamp) - Date.parse(segment.startedAt);
  const bytes = decoder(segment.path, offsetMs);
  if (bytes.length > MAX_FRAME_BYTES)
    throw new Error("The decoded frame exceeded the local byte cap.");
  return {
    timestamp: new Date(Date.parse(segment.startedAt) + offsetMs).toISOString(),
    segmentId: segment.id,
    image: {
      type: "image" as const,
      data: bytes.toString("base64"),
      mimeType: "image/jpeg",
    },
  };
}

export function readScreenMemoryFrame(
  storeDir: string,
  timestamp: string,
  decoder: ScreenMemoryFrameDecoder = decodeFrameWithFfmpeg,
) {
  return frameContent(
    retainedSegmentAt(storeDir, timestamp),
    timestamp,
    decoder,
  );
}

export function selectContactSheetTimestamps(
  startAt: string,
  endAt: string,
  count: number,
  representative: string[] = [],
): string[] {
  const started = Date.parse(startAt);
  const duration = Date.parse(endAt) - started;
  const representatives = [
    ...new Set(
      representative
        .filter(isTimestamp)
        .filter(
          (timestamp) =>
            Date.parse(timestamp) >= started &&
            Date.parse(timestamp) <= started + duration,
        ),
    ),
  ];
  // Reserve one slot for temporal coverage whenever possible: a contact sheet
  // should not become a cluster of favorite frames with no sense of the span.
  const preferred = representatives.slice(0, Math.max(0, count - 1));
  const even = Array.from({ length: count }, (_, index) =>
    new Date(started + (duration * (index + 0.5)) / count).toISOString(),
  );
  const selected = [...preferred];
  while (selected.length < count) {
    const next = even
      .filter((timestamp) => !selected.includes(timestamp))
      .sort((a, b) => {
        const distance = (timestamp: string) =>
          Math.min(
            ...selected.map((chosen) =>
              Math.abs(Date.parse(timestamp) - Date.parse(chosen)),
            ),
            Number.POSITIVE_INFINITY,
          );
        return distance(b) - distance(a);
      })[0];
    if (!next) break;
    selected.push(next);
  }
  return selected;
}

export function contactSheetRangeIsValid(
  durationMs: number,
  usesChapterMoments: boolean,
): boolean {
  return durationMs >= 0 && (usesChapterMoments || durationMs <= 5 * 60_000);
}

function recentSegments(
  storeDir: string,
  minutes: number,
): ScreenMemorySegment[] {
  const cutoff = cutoffFor(minutes);
  return readSegments(storeDir)
    .filter((segment) => {
      const endedAt = Date.parse(segment.endedAt);
      return (
        Number.isFinite(endedAt) &&
        endedAt >= cutoff &&
        typeof segment.path === "string" &&
        fs.existsSync(segment.path) &&
        segment.corrupt !== true
      );
    })
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt));
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function redactCredentialText(value: string): string {
  return value
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{16})\b/g,
      "[REDACTED CREDENTIAL]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, "Bearer [REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*([^\s,;]{4,})/gi,
      "$1=[REDACTED]",
    );
}

const sanitizedEgressStores = new Set<string>();

function sanitizeLegacyEgressLog(storeDir: string): void {
  if (sanitizedEgressStores.has(storeDir)) return;
  sanitizedEgressStores.add(storeDir);
  const logPath = path.join(storeDir, "egress.jsonl");
  if (!fs.existsSync(logPath)) return;
  const sanitized = fs
    .readFileSync(logPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const packet = event.packet as
          | { evidence?: Array<Record<string, unknown>> }
          | null
          | undefined;
        if (!event.receipt && Array.isArray(packet?.evidence)) {
          event.receipt = {
            evidence: packet.evidence.map((evidence) => ({
              id: evidence.id,
              momentId: evidence.momentId,
              sourceType: evidence.sourceType,
              capturedAt: evidence.capturedAt ?? null,
            })),
          };
        }
        delete event.packet;
        delete event.reason;
        event.packetBytes =
          typeof event.packetBytes === "number" ? event.packetBytes : 0;
        return [JSON.stringify(event)];
      } catch {
        // A malformed audit row cannot provide reliable provenance. Dropping it
        // also prevents arbitrary stale text from surviving this migration.
        return [];
      }
    });
  const temporaryPath = `${logPath}.sanitize-${process.pid}`;
  fs.writeFileSync(
    temporaryPath,
    sanitized.length > 0 ? `${sanitized.join("\n")}\n` : "",
    { encoding: "utf-8", mode: 0o600 },
  );
  fs.renameSync(temporaryPath, logPath);
  fs.chmodSync(logPath, 0o600);
}

function appendEgressEvent(storeDir: string, event: Record<string, unknown>) {
  fs.mkdirSync(storeDir, { recursive: true });
  fs.chmodSync(storeDir, 0o700);
  sanitizeLegacyEgressLog(storeDir);
  fs.appendFileSync(
    path.join(storeDir, "egress.jsonl"),
    `${JSON.stringify(event)}\n`,
    { encoding: "utf-8", mode: 0o600 },
  );
  fs.chmodSync(path.join(storeDir, "egress.jsonl"), 0o600);
}

type EgressEvidenceReference = {
  id: string;
  momentId: string;
  sourceType: string;
  capturedAt: string | null;
};

/**
 * Records that bounded evidence was returned without preserving its text.
 * The originating Screen Memory interval remains the only durable home for
 * transcripts and chapter summaries.
 */
function appendEgressReceipt(
  storeDir: string,
  requestId: string,
  operation: string,
  evidence: EgressEvidenceReference[],
): void {
  const occurredAt = new Date().toISOString();
  const receipt = {
    evidence: evidence.map(({ id, momentId, sourceType, capturedAt }) => ({
      id,
      momentId,
      sourceType,
      capturedAt,
    })),
  };
  appendEgressEvent(storeDir, {
    requestId,
    occurredAt,
    state: "prepared",
    operation,
    receipt,
    evidenceCount: receipt.evidence.length,
    packetBytes: 0,
    error: null,
  });
  appendEgressEvent(storeDir, {
    requestId,
    occurredAt: new Date().toISOString(),
    state: "completed",
    operation,
    receipt: null,
    evidenceCount: receipt.evidence.length,
    packetBytes: 0,
    error: null,
  });
}

export function appendLocalEvidenceReceipt(
  storeDir: string,
  operation: string,
  evidence: Array<{ timestamp: string; segmentId: string }>,
): void {
  appendEgressEvent(storeDir, {
    requestId: `local-${operation}-${Date.now()}-${process.pid}`,
    occurredAt: new Date().toISOString(),
    state: "local-evidence-read",
    operation,
    receipt: {
      frames: evidence.map(({ timestamp, segmentId }) => ({
        timestamp,
        segmentId,
      })),
    },
    evidenceCount: evidence.length,
    packetBytes: 0,
    error: null,
  });
}

function handoffDir(storeDir: string): string {
  return path.join(storeDir, "agent-handoffs");
}

function handoffPath(storeDir: string, requestId: string): string {
  const safeId = requestId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId || safeId !== requestId)
    throw new Error("Invalid handoff request ID.");
  return path.join(handoffDir(storeDir), `${safeId}.json`);
}

function writePrivateJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  fs.chmodSync(file, 0o600);
}

function parseHandoffRange(args: Record<string, unknown>) {
  if (typeof args.startAt !== "string" || typeof args.endAt !== "string") {
    throw new Error("startAt and endAt must be RFC3339 timestamps.");
  }
  const startAt = new Date(args.startAt);
  const endAt = new Date(args.endAt);
  if (
    !Number.isFinite(startAt.getTime()) ||
    !Number.isFinite(endAt.getTime())
  ) {
    throw new Error("startAt and endAt must be valid RFC3339 timestamps.");
  }
  const durationMs = endAt.getTime() - startAt.getTime();
  if (durationMs < 1_000 || durationMs > 5 * 60_000) {
    throw new Error(
      "A Rewind Clip handoff must be between one second and five minutes.",
    );
  }
  if (endAt.getTime() > Date.now() + 5_000) {
    throw new Error("A Rewind Clip handoff cannot include future time.");
  }
  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    durationMs,
  };
}

export function screenMemoryMcpToolDefinitions() {
  return [
    {
      name: "screen_memory_status",
      description:
        "Read local Clips Screen Memory status, retention, disk usage, and connection health without exposing archive paths.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "screen_memory_recent_context",
      description:
        "Search bounded local Screen Memory evidence. Returns coverage, explicit gaps, typed app-context/OCR/transcript evidence when local files contain it, and no media bytes or images.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional case-insensitive text filter.",
          },
          minutes: {
            type: "number",
            description: "Lookback window in minutes. Defaults to 30.",
          },
          limit: {
            type: "number",
            description: "Maximum evidence items to return. Defaults to 40.",
          },
        },
      },
    },
    {
      name: "screen_memory_recent_segments",
      description:
        "List recent local Screen Memory segment references and timestamps. Media paths and bytes stay behind Clips' bounded private Clip handoff boundary.",
      inputSchema: {
        type: "object",
        properties: {
          minutes: {
            type: "number",
            description: "Lookback window in minutes. Defaults to 30.",
          },
        },
      },
    },
    {
      name: "screen_memory_search_chapters",
      description:
        "Search locally generated, retention-bound Rewind work chapters. Returns bounded scored candidates, coverage and ambiguity for the connected agent; never archive paths or media bytes.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description:
              "Question or topic to match against local chapter labels, summaries, context, and evidence types.",
          },
          minutes: {
            type: "number",
            description: "Optional recent-window cap, up to 24 hours.",
          },
          limit: {
            type: "number",
            description: "Maximum candidates, up to 12.",
          },
          clientHint: {
            type: "string",
            description:
              "Optional weak tie-breaker such as project or working directory; cannot hide a stronger semantic match.",
          },
        },
      },
    },
    {
      name: "screen_memory_frame_at",
      description:
        "Decode one bounded local JPEG at an exact RFC3339 Rewind timestamp. Returns image content and opaque segment reference only; no archive path, upload, motion, or audio.",
      inputSchema: {
        type: "object",
        required: ["timestamp"],
        properties: {
          timestamp: {
            type: "string",
            description: "Exact RFC3339 timestamp.",
          },
          reason: {
            type: "string",
            description: "Short reason for this bounded local evidence read.",
          },
        },
      },
    },
    {
      name: "screen_memory_contact_sheet",
      description:
        "Return up to eight bounded, timestamped local Rewind frames from one chapter or a range of no more than five minutes. Prefer representative moments; no paths or uploads.",
      inputSchema: {
        type: "object",
        properties: {
          chapterId: { type: "string" },
          startAt: { type: "string" },
          endAt: { type: "string" },
          count: {
            type: "number",
            description: "1 to 8 frames; defaults to 4.",
          },
          reason: { type: "string" },
        },
      },
    },
    {
      name: "screen_memory_request_clip",
      description:
        "Request one bounded private Clip from a Rewind interval when visual or audio inspection is necessary. Clips reviews it first by default, unless the user disabled review in Settings. Raw archive paths are never returned.",
      inputSchema: {
        type: "object",
        required: ["startAt", "endAt"],
        properties: {
          startAt: { type: "string", description: "RFC3339 start timestamp." },
          endAt: { type: "string", description: "RFC3339 end timestamp." },
          reason: {
            type: "string",
            description: "Short user-facing reason this media range is needed.",
          },
          includeMicrophone: { type: "boolean" },
          includeSystemAudio: { type: "boolean" },
        },
      },
    },
    {
      name: "screen_memory_handoff_status",
      description:
        "Check whether a bounded Rewind Clip request is awaiting review, processing, ready, declined, or failed. Ready responses contain only the private agent URL and timestamps, never local archive paths.",
      inputSchema: {
        type: "object",
        required: ["requestId"],
        properties: { requestId: { type: "string" } },
      },
    },
  ];
}

export async function runScreenMemoryMCPStdio(
  opts: RunScreenMemoryMCPStdioOptions = {},
): Promise<void> {
  const env = opts.env ?? process.env;
  const storeDir = opts.storeDir ?? defaultStoreDir(env);

  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } =
    await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { CallToolRequestSchema, ListToolsRequestSchema } =
    await import("@modelcontextprotocol/sdk/types.js");

  const server = new Server(
    { name: "clips-screen-memory", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: screenMemoryMcpToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const name = request.params?.name;
    const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
    if (name === "screen_memory_status") {
      const config = readFeatureConfig(storeDir);
      const segments = recentSegments(storeDir, 24 * 60);
      return textResult({
        enabled: config.enabled === true,
        paused: config.paused === true,
        retentionHours: config.retentionHours ?? 24,
        maxBytes: config.maxBytes ?? 20 * 1024 * 1024 * 1024,
        segmentCount: segments.length,
        totalBytes: segments.reduce(
          (sum, segment) => sum + (segment.bytes || 0),
          0,
        ),
        note: "The Screen Memory store is connected. Local archive paths are intentionally not exposed to agents.",
      });
    }
    if (name === "screen_memory_recent_context") {
      const result = await queryScreenMemoryContext(
        {
          query: typeof args.query === "string" ? args.query : undefined,
          sinceMinutes:
            typeof args.minutes === "number" ? args.minutes : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        },
        { env: { ...env, AGENT_NATIVE_SCREEN_MEMORY_DIR: storeDir } },
      );
      const sanitizedEvidence = result.evidence.map((item) => ({
        ...item,
        excerpt: redactCredentialText(item.excerpt),
      }));
      const sanitizedItems = result.items.map((item) => ({
        ...item,
        text: redactCredentialText(item.text),
        sourceFile: "local-screen-memory",
      }));
      const requestId = `egress-mcp-${Date.now()}-${process.pid}`;
      const packet = {
        question:
          typeof args.query === "string" && args.query.trim()
            ? redactCredentialText(args.query.trim().slice(0, 4_000))
            : "Recent Screen Memory context",
        evidence: sanitizedEvidence.slice(0, 20).map((item) => ({
          id: item.id,
          momentId: item.momentId,
          sourceType: item.sourceType,
          capturedAt: item.capturedAt,
          excerpt: item.excerpt.slice(0, 1_200),
        })),
      };
      appendEgressReceipt(
        storeDir,
        requestId,
        "recent-context",
        packet.evidence,
      );
      return textResult(
        // Keep the old MCP envelope available while adding the typed contract.
        {
          events: sanitizedItems,
          ...result,
          items: sanitizedItems,
          evidence: sanitizedEvidence,
          contextFiles: [],
          egress: {
            requestId,
            packet,
            note: "A content-free local activity receipt was recorded before this bounded text packet was returned.",
          },
        },
      );
    }
    if (name === "screen_memory_recent_segments") {
      const minutes = typeof args.minutes === "number" ? args.minutes : 30;
      const segments = recentSegments(storeDir, minutes);
      const requestId = `egress-mcp-${Date.now()}-${process.pid}`;
      const packet = {
        question: `List recent Rewind segment references from the previous ${Math.max(1, Math.min(minutes, 24 * 60))} minutes`,
        evidence: segments.slice(0, 20).map((segment) => ({
          id: segment.id,
          momentId: `segment:${segment.id}`,
          sourceType: "app-context",
          capturedAt: segment.startedAt,
          excerpt: `Local media segment reference from ${segment.startedAt} to ${segment.endedAt}; media path and bytes were not exposed.`,
        })),
      };
      appendEgressReceipt(
        storeDir,
        requestId,
        "recent-segments",
        packet.evidence,
      );
      return textResult({
        localOnly: true,
        mediaApprovalRequired: true,
        segments: segments.map((segment) => ({
          id: segment.id,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
          mimeType: segment.mimeType,
          durationMs: segment.durationMs,
        })),
        egress: {
          requestId,
          packet,
          note: "A content-free local activity receipt was recorded before this bounded metadata packet was returned.",
        },
      });
    }
    if (name === "screen_memory_search_chapters") {
      if (typeof args.query !== "string" || !args.query.trim())
        throw new Error("query is required.");
      const document = readScreenMemoryChapters(storeDir);
      if (!document)
        throw new Error(
          "No valid local Rewind chapters index is available yet.",
        );
      const minutes =
        typeof args.minutes === "number" && Number.isFinite(args.minutes)
          ? Math.max(1, Math.min(Math.trunc(args.minutes), 24 * 60))
          : null;
      const cutoff = minutes ? Date.now() - minutes * 60_000 : null;
      const boundedDocument = cutoff
        ? {
            ...document,
            chapters: document.chapters.filter(
              (chapter) => Date.parse(chapter.endedAt) >= cutoff,
            ),
          }
        : document;
      const candidates = searchScreenMemoryChapters(
        boundedDocument,
        args.query.trim(),
        typeof args.limit === "number" ? args.limit : 5,
        typeof args.clientHint === "string" ? args.clientHint : undefined,
      );
      const ambiguous =
        candidates.length > 1 &&
        Math.abs(candidates[0].score - candidates[1].score) <= 0.05;
      const packet = {
        question: redactCredentialText(args.query.trim().slice(0, 4_000)),
        evidence: candidates.map((chapter) => ({
          id: chapter.id,
          momentId: chapter.id,
          sourceType: "chapter",
          capturedAt: chapter.startedAt,
          excerpt: redactCredentialText(
            `${chapter.label}: ${chapter.summary}`,
          ).slice(0, 1_200),
        })),
      };
      const requestId = `egress-mcp-${Date.now()}-${process.pid}`;
      appendEgressReceipt(
        storeDir,
        requestId,
        "search-chapters",
        packet.evidence,
      );
      return textResult({
        localOnly: true,
        generatedAt: document.generatedAt,
        state: document.state,
        coverage: document.coverage,
        gaps:
          isRecord(document.coverage) && Array.isArray(document.coverage.gaps)
            ? document.coverage.gaps
            : [],
        indexState: candidates.some(
          (candidate) => candidate.indexState === "pending",
        )
          ? "pending"
          : candidates.some((candidate) => candidate.indexState === "partial")
            ? "partial"
            : "ready",
        ambiguous,
        candidates: candidates.map(projectScreenMemoryChapterCandidate),
        egress: {
          requestId,
          packet,
          note: "A content-free local activity receipt was recorded before this bounded chapter packet was returned.",
        },
      });
    }
    if (name === "screen_memory_frame_at") {
      if (typeof args.timestamp !== "string")
        throw new Error("timestamp is required.");
      const frame = readScreenMemoryFrame(
        storeDir,
        args.timestamp,
        opts.decodeFrame ?? decodeFrameWithFfmpeg,
      );
      appendLocalEvidenceReceipt(storeDir, "frame-at", [
        { timestamp: frame.timestamp, segmentId: frame.segmentId },
      ]);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              localOnly: true,
              timestamp: frame.timestamp,
              segmentId: frame.segmentId,
              coverage: "retained clean segment",
              note: "This is a bounded local image read. Request screen_memory_request_clip for motion or audio.",
            }),
          },
          frame.image,
        ],
      };
    }
    if (name === "screen_memory_contact_sheet") {
      const document = readScreenMemoryChapters(storeDir);
      const chapter =
        typeof args.chapterId === "string"
          ? document?.chapters.find(
              (candidate) => candidate.id === args.chapterId,
            )
          : undefined;
      const startAt =
        chapter?.startedAt ??
        (typeof args.startAt === "string" ? args.startAt : null);
      const endAt =
        chapter?.endedAt ??
        (typeof args.endAt === "string" ? args.endAt : null);
      if (!startAt || !endAt || !isTimestamp(startAt) || !isTimestamp(endAt))
        throw new Error(
          "Provide a valid chapterId or RFC3339 startAt and endAt.",
        );
      const durationMs = Date.parse(endAt) - Date.parse(startAt);
      if (!contactSheetRangeIsValid(durationMs, Boolean(chapter)))
        throw new Error(
          "A contact sheet range must be between zero and five minutes.",
        );
      if (Date.parse(endAt) > Date.now() + 5_000)
        throw new Error("A Rewind contact sheet cannot include future time.");
      const count = Math.min(
        Math.max(
          Math.trunc(typeof args.count === "number" ? args.count : 4),
          1,
        ),
        8,
      );
      const representative = (chapter?.representativeMoments ?? [])
        .filter(
          (moment) =>
            Date.parse(moment.capturedAt) >= Date.parse(startAt) &&
            Date.parse(moment.capturedAt) <= Date.parse(endAt),
        )
        .map((moment) => moment.capturedAt);
      const timestamps = selectContactSheetTimestamps(
        startAt,
        endAt,
        count,
        representative,
      );
      const decoder = opts.decodeFrame ?? decodeFrameWithFfmpeg;
      const frames = timestamps.flatMap((timestamp) => {
        try {
          return [readScreenMemoryFrame(storeDir, timestamp, decoder)];
        } catch {
          // A chapter may span a brief coverage gap. Keep the clean retained
          // frames instead of failing the entire bounded contact sheet.
          return [];
        }
      });
      if (frames.length === 0) {
        throw new Error(
          "No clean retained Rewind frames cover the requested contact-sheet range.",
        );
      }
      appendLocalEvidenceReceipt(
        storeDir,
        "contact-sheet",
        frames.map(({ timestamp, segmentId }) => ({ timestamp, segmentId })),
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              localOnly: true,
              chapterId: chapter?.id ?? null,
              startAt: new Date(Date.parse(startAt)).toISOString(),
              endAt: new Date(Date.parse(endAt)).toISOString(),
              frameCount: frames.length,
              selection: representative.length
                ? "representative moments then even coverage"
                : "even temporal coverage",
              frames: frames.map(({ timestamp, segmentId }) => ({
                timestamp,
                segmentId,
              })),
            }),
          },
          ...frames.map((frame) => frame.image),
        ],
      };
    }
    if (name === "screen_memory_request_clip") {
      const range = parseHandoffRange(args);
      const config = readFeatureConfig(storeDir);
      const requestId = `handoff-${randomUUID()}`;
      const reason =
        typeof args.reason === "string"
          ? redactCredentialText(args.reason.trim().slice(0, 500))
          : "Visual or audio context requested by the agent";
      const request = {
        requestId,
        status: "pending",
        requestedAt: new Date().toISOString(),
        ...range,
        reason,
        includeMicrophone: args.includeMicrophone !== false,
        includeSystemAudio: args.includeSystemAudio !== false,
        reviewRequired: config.reviewBeforeSending !== false,
        agentClipRetention: config.agentClipRetention ?? "forever",
      };
      writePrivateJson(handoffPath(storeDir, requestId), request);
      appendEgressEvent(storeDir, {
        requestId,
        occurredAt: request.requestedAt,
        state: "handoff-requested",
        operation: "request-clip",
        receipt: {
          mediaInterval: { startAt: range.startAt, endAt: range.endAt },
          reviewRequired: request.reviewRequired,
        },
        evidenceCount: 0,
        packetBytes: 0,
        error: null,
      });
      return textResult({
        requestId,
        status: "pending",
        startAt: range.startAt,
        endAt: range.endAt,
        reviewRequired: request.reviewRequired,
        note: request.reviewRequired
          ? "Clips is waiting for the user to review this bounded range. Poll screen_memory_handoff_status."
          : "Clips is processing the explicitly requested bounded range. Poll screen_memory_handoff_status.",
      });
    }
    if (name === "screen_memory_handoff_status") {
      if (typeof args.requestId !== "string") {
        throw new Error("requestId is required.");
      }
      const parsed = JSON.parse(
        fs.readFileSync(handoffPath(storeDir, args.requestId), "utf-8"),
      ) as Record<string, unknown>;
      return textResult({
        requestId: parsed.requestId,
        status: parsed.status,
        startAt: parsed.startAt,
        endAt: parsed.endAt,
        recordingId: parsed.recordingId,
        agentUrl: parsed.agentUrl,
        contextUrl: parsed.contextUrl,
        expiresAt: parsed.expiresAt,
        autoDeleteAt: parsed.autoDeleteAt,
        autoDeletedAt: parsed.autoDeletedAt,
        error: parsed.error,
      });
    }
    throw new Error(`Unknown Screen Memory tool: ${name}`);
  });

  log(`Serving local Screen Memory from ${storeDir}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = resolve;
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}
