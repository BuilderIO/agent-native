export interface ScreenMemoryConfig {
  enabled: boolean;
  paused: boolean;
  retentionHours: number;
  maxBytes: number;
  segmentSeconds: number;
  sampleIntervalSeconds: number;
  captureMode: "visuals" | "visuals-audio";
  reviewBeforeSending: boolean;
  agentClipRetention: "forever" | "24-hours" | "7-days" | "30-days";
  excludedBundleIds: string[];
  excludePrivateWindows: boolean;
}

export interface ScreenMemoryStatus {
  feature: "screen-memory";
  localOnly: true;
  enabled: boolean;
  paused: boolean;
  state: "disabled" | "paused" | "ready" | "empty" | "unavailable";
  config: ScreenMemoryConfig;
  configPath: string | null;
  configSource: "feature-config" | "standalone" | "default";
  dataDirs: string[];
  contextFiles: string[];
  captureCount: number;
  storageBytes: number;
  oldestCaptureAt: string | null;
  newestCaptureAt: string | null;
  note: string;
}

export interface ScreenMemoryContextItem {
  capturedAt: string | null;
  appName: string | null;
  windowTitle: string | null;
  bundleId: string | null;
  url: string | null;
  title: string | null;
  source: string | null;
  text: string;
  sourceFile: string;
}

export type ScreenMemoryEvidenceSourceType =
  | "app-context"
  | "transcript"
  | "ocr";

export interface ScreenMemoryTimeRange {
  startedAt: string | null;
  endedAt: string;
}

export interface ScreenMemoryCoverageGap {
  startedAt: string | null;
  endedAt: string | null;
  reason:
    | "no-context-files"
    | "no-evidence-in-requested-range"
    | "missing-before-first-evidence"
    | "capture-stale"
    | "timestamps-unavailable"
    | "index-pending"
    | "index-failed"
    | "index-skipped"
    | "privacy-excluded-or-unretained";
}

export interface ScreenMemorySegmentReference {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ScreenMemoryEvidenceItem {
  id: string;
  momentId: string;
  capturedAt: string | null;
  sourceType: ScreenMemoryEvidenceSourceType;
  excerpt: string;
  excerptTruncated: boolean;
  appName: string | null;
  windowTitle: string | null;
  bundleId: string | null;
  url: string | null;
  title: string | null;
  segmentRefs: ScreenMemorySegmentReference[];
  jumpTarget: {
    kind: "screen-memory-moment";
    momentId: string;
    capturedAt: string | null;
    segmentId: string | null;
  };
}

export interface ScreenMemoryRetrievalCoverage {
  requestedRange: ScreenMemoryTimeRange;
  coveredRange: { startedAt: string | null; endedAt: string | null };
  gaps: ScreenMemoryCoverageGap[];
}

export interface ScreenMemoryTruncation {
  itemLimit: number;
  returnedItems: number;
  omittedItems: number;
  maxExcerptChars: number;
  excerptsTruncated: number;
  sourceRowsReadLimit: number;
  sourceRowsReadTruncated: boolean;
}

export interface ScreenMemoryQueryResult {
  feature: "screen-memory";
  localOnly: true;
  enabled: boolean;
  paused: boolean;
  query: string | null;
  sinceMinutes: number | null;
  count: number;
  items: ScreenMemoryContextItem[];
  /** Stable, bounded local retrieval contract. `items` remains for legacy callers. */
  evidence: ScreenMemoryEvidenceItem[];
  coverage: ScreenMemoryRetrievalCoverage;
  truncation: ScreenMemoryTruncation;
  contextFiles: string[];
  note: string;
}

export interface ScreenMemoryLocalOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
  /** Test-only clock injection; retrieval never reads network time. */
  now?: () => Date;
}

export interface ScreenMemoryAgentQueryResult extends ScreenMemoryQueryResult {
  egress: {
    requestId: string;
    packet: {
      question: string;
      evidence: Array<{
        id: string;
        momentId: string;
        sourceType: ScreenMemoryEvidenceSourceType;
        capturedAt: string | null;
        excerpt: string;
      }>;
    };
    note: string;
  };
}

const DEFAULT_CONFIG: ScreenMemoryConfig = {
  enabled: false,
  paused: false,
  retentionHours: 8,
  maxBytes: 20 * 1024 * 1024 * 1024,
  segmentSeconds: 5 * 60,
  sampleIntervalSeconds: 10,
  captureMode: "visuals",
  reviewBeforeSending: true,
  agentClipRetention: "forever",
  excludedBundleIds: [
    "com.1password.1password",
    "com.agilebits.onepassword7",
    "com.bitwarden.desktop",
    "com.dashlane.dashlane",
    "com.lastpass.lastpass",
  ],
  excludePrivateWindows: false,
};

const JSONL_NAMES = [
  "context.jsonl",
  "events.jsonl",
  "snapshots.jsonl",
  "screen-memory.jsonl",
];
const MAX_SOURCE_ROWS = 10_000;
const MAX_EXCERPT_CHARS = 1_200;
const MAX_TRANSCRIPT_JOIN_GAP_MS = 2_000;
type ScreenMemoryOcrIndexState =
  | "pending"
  | "indexing"
  | "ready"
  | "failed"
  | "skipped";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function bundleIds(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}

function normalizeConfig(value: unknown): ScreenMemoryConfig {
  const raw = asRecord(value) ?? {};
  return {
    enabled: booleanValue(raw.enabled, DEFAULT_CONFIG.enabled),
    paused: booleanValue(raw.paused, DEFAULT_CONFIG.paused),
    retentionHours: Math.min(
      positiveNumber(raw.retentionHours, DEFAULT_CONFIG.retentionHours),
      24,
    ),
    maxBytes: positiveNumber(raw.maxBytes, DEFAULT_CONFIG.maxBytes),
    segmentSeconds: positiveNumber(
      raw.segmentSeconds,
      DEFAULT_CONFIG.segmentSeconds,
    ),
    sampleIntervalSeconds: positiveNumber(
      raw.sampleIntervalSeconds,
      DEFAULT_CONFIG.sampleIntervalSeconds,
    ),
    captureMode: enumValue(
      raw.captureMode,
      ["visuals", "visuals-audio"],
      DEFAULT_CONFIG.captureMode,
    ),
    reviewBeforeSending:
      typeof raw.reviewBeforeSending === "boolean"
        ? raw.reviewBeforeSending
        : DEFAULT_CONFIG.reviewBeforeSending,
    agentClipRetention: enumValue(
      raw.agentClipRetention,
      ["forever", "24-hours", "7-days", "30-days"],
      DEFAULT_CONFIG.agentClipRetention,
    ),
    excludedBundleIds: bundleIds(
      raw.excludedBundleIds,
      DEFAULT_CONFIG.excludedBundleIds,
    ),
    excludePrivateWindows:
      typeof raw.excludePrivateWindows === "boolean"
        ? raw.excludePrivateWindows
        : DEFAULT_CONFIG.excludePrivateWindows,
  };
}

async function nodeModules() {
  const [fs, path, os] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
    import("node:os"),
  ]);
  return { fs, path, os };
}

async function exists(pathname: string): Promise<boolean> {
  const { fs } = await nodeModules();
  try {
    await fs.stat(pathname);
    return true;
  } catch {
    return false;
  }
}

async function readJson(pathname: string): Promise<unknown | null> {
  const { fs } = await nodeModules();
  try {
    return JSON.parse(await fs.readFile(pathname, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(pathname: string, value: unknown): Promise<void> {
  const { fs, path } = await nodeModules();
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function resolvePaths(options: ScreenMemoryLocalOptions = {}): Promise<{
  featureConfigPaths: string[];
  standaloneConfigPath: string;
  dataDirs: string[];
}> {
  const { path, os } = await nodeModules();
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? os.homedir();

  const appDataBase =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : platform === "win32"
        ? env.APPDATA || path.join(home, "AppData", "Roaming")
        : env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const appConfigBase =
    platform === "darwin" || platform === "win32"
      ? appDataBase
      : env.XDG_CONFIG_HOME || path.join(home, ".config");
  const clipsDataDir = path.join(appDataBase, "com.clips.tray");
  const clipsConfigDir = path.join(appConfigBase, "com.clips.tray");
  const fallbackDir = path.join(home, ".agent-native", "screen-memory");
  const envDir =
    env.AGENT_NATIVE_SCREEN_MEMORY_DIR ?? env.CLIPS_SCREEN_MEMORY_DIR;
  const envConfig = env.AGENT_NATIVE_SCREEN_MEMORY_CONFIG;

  const dataDirs = [
    ...(envDir ? [envDir] : []),
    path.join(clipsDataDir, "screen-memory"),
    ...(clipsConfigDir === clipsDataDir
      ? []
      : [path.join(clipsConfigDir, "screen-memory")]),
    fallbackDir,
  ];

  return {
    featureConfigPaths: [
      ...(envConfig ? [envConfig] : []),
      path.join(clipsDataDir, "feature-config.json"),
      ...(clipsConfigDir === clipsDataDir
        ? []
        : [path.join(clipsConfigDir, "feature-config.json")]),
    ],
    standaloneConfigPath: path.join(fallbackDir, "config.json"),
    dataDirs,
  };
}

async function readConfigInfo(options: ScreenMemoryLocalOptions = {}): Promise<{
  config: ScreenMemoryConfig;
  path: string | null;
  source: ScreenMemoryStatus["configSource"];
  raw: Record<string, unknown> | null;
  nested: boolean;
}> {
  const paths = await resolvePaths(options);
  for (const pathname of paths.featureConfigPaths) {
    const raw = asRecord(await readJson(pathname));
    if (!raw) continue;
    const nested = asRecord(raw.screenMemory);
    if (nested) {
      return {
        config: normalizeConfig(nested),
        path: pathname,
        source: "feature-config",
        raw,
        nested: true,
      };
    }
    if (
      "enabled" in raw ||
      "paused" in raw ||
      "retentionHours" in raw ||
      "maxBytes" in raw
    ) {
      return {
        config: normalizeConfig(raw),
        path: pathname,
        source: "standalone",
        raw,
        nested: false,
      };
    }
  }

  const standalone = asRecord(await readJson(paths.standaloneConfigPath));
  if (standalone) {
    return {
      config: normalizeConfig(standalone),
      path: paths.standaloneConfigPath,
      source: "standalone",
      raw: standalone,
      nested: false,
    };
  }

  return {
    config: { ...DEFAULT_CONFIG },
    path: null,
    source: "default",
    raw: null,
    nested: false,
  };
}

export async function configureScreenMemory(
  patch: Partial<ScreenMemoryConfig>,
  options: ScreenMemoryLocalOptions = {},
): Promise<ScreenMemoryStatus> {
  const info = await readConfigInfo(options);
  const paths = await resolvePaths(options);
  const next = normalizeConfig({ ...info.config, ...patch });
  const targetPath = info.path ?? paths.standaloneConfigPath;

  if (info.raw && info.nested) {
    await writeJson(targetPath, { ...info.raw, screenMemory: next });
  } else {
    await writeJson(targetPath, next);
  }

  return readScreenMemoryStatus(options);
}

async function contextFilesFor(
  dataDirs: string[],
): Promise<{ files: string[]; storageBytes: number }> {
  const { fs, path } = await nodeModules();
  const files: string[] = [];
  let storageBytes = 0;

  for (const dir of dataDirs) {
    if (!(await exists(dir))) continue;
    for (const name of JSONL_NAMES) {
      const candidate = path.join(dir, name);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          files.push(candidate);
          storageBytes += stat.size;
        }
      } catch {
        // ignore missing candidate files
      }
    }
    try {
      const names = await fs.readdir(dir);
      for (const name of names.filter(
        (entry) =>
          entry.endsWith(".ocr.jsonl") || entry.endsWith(".transcript.jsonl"),
      )) {
        const candidate = path.join(dir, name);
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          files.push(candidate);
          storageBytes += stat.size;
        }
      }
    } catch {
      // ignore unavailable local directories
    }
  }

  return { files, storageBytes };
}

function firstString(
  raw: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function firstFiniteNumber(
  raw: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function firstBoolean(
  raw: Record<string, unknown>,
  keys: string[],
): boolean | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function normalizeContextItem(
  value: unknown,
  sourceFile: string,
): ScreenMemoryContextItem | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const text =
    firstString(raw, [
      "text",
      "ocrText",
      "visibleText",
      "summary",
      "caption",
    ]) ?? "";
  const capturedAt = firstString(raw, [
    "capturedAt",
    "timestamp",
    "time",
    "createdAt",
  ]);
  return {
    capturedAt,
    appName: firstString(raw, ["appName", "application", "bundleName"]),
    windowTitle: firstString(raw, ["windowTitle", "window", "activeWindow"]),
    bundleId: firstString(raw, ["bundleId", "appBundleId"]),
    url: firstString(raw, ["url", "pageUrl"]),
    title: firstString(raw, ["title", "pageTitle"]),
    source: firstString(raw, ["source", "kind"]),
    text,
    sourceFile,
  };
}

function itemTime(item: ScreenMemoryContextItem): number {
  if (!item.capturedAt) return 0;
  const parsed = Date.parse(item.capturedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface LocalContextRow {
  item: ScreenMemoryContextItem;
  raw: Record<string, unknown>;
}

function isPrivacyExcludedRow(
  row: LocalContextRow,
  config: ScreenMemoryConfig,
): boolean {
  const bundleId = row.item.bundleId?.trim().toLowerCase();
  if (
    bundleId &&
    config.excludedBundleIds.some(
      (excluded) => excluded.trim().toLowerCase() === bundleId,
    )
  ) {
    return true;
  }

  if (!config.excludePrivateWindows) return false;
  if (
    firstBoolean(row.raw, [
      "isPrivate",
      "is_private",
      "privateWindow",
      "private_window",
      "incognito",
    ]) === true
  ) {
    return true;
  }
  const title = row.item.windowTitle?.toLowerCase() ?? "";
  return ["incognito", "inprivate", "private browsing", "private window"].some(
    (marker) => title.includes(marker),
  );
}

function rowTimeRange(
  rows: LocalContextRow[],
  fallback: ScreenMemoryTimeRange,
): ScreenMemoryTimeRange {
  const times = rows
    .map(({ item }) => itemTime(item))
    .filter((time) => time > 0);
  if (times.length === 0) return fallback;
  return {
    startedAt: new Date(Math.min(...times)).toISOString(),
    endedAt: new Date(Math.max(...times)).toISOString(),
  };
}

interface LocalTranscriptSpan {
  row: LocalContextRow;
  segmentId: string;
  source: string;
  startMs: number;
  endMs: number;
}

interface LocalSegment {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  clean: boolean;
}

function stableId(prefix: string, value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function boundedExcerpt(value: string): {
  excerpt: string;
  excerptTruncated: boolean;
} {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_EXCERPT_CHARS) {
    return { excerpt: normalized, excerptTruncated: false };
  }
  return {
    excerpt: `${normalized.slice(0, MAX_EXCERPT_CHARS - 1)}…`,
    excerptTruncated: true,
  };
}

function redactCredentialText(value: string): string {
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

function sourceTexts(
  raw: Record<string, unknown>,
  fallback: string,
): Array<{ sourceType: ScreenMemoryEvidenceSourceType; text: string }> {
  const localTranscriptText =
    firstString(raw, ["text"]) &&
    firstString(raw, ["segmentId", "segment_id"]) &&
    (typeof raw.startMs === "number" || typeof raw.start_ms === "number")
      ? firstString(raw, ["text"])
      : null;
  const values: Array<{
    sourceType: ScreenMemoryEvidenceSourceType;
    keys: string[];
  }> = [
    { sourceType: "transcript", keys: ["transcript", "transcriptText"] },
    { sourceType: "ocr", keys: ["ocrText", "visibleText", "ocr"] },
  ];
  const evidence = values.flatMap(({ sourceType, keys }) => {
    const text = firstString(raw, keys);
    return text ? [{ sourceType, text }] : [];
  });
  if (localTranscriptText) {
    evidence.unshift({
      sourceType: "transcript",
      text: localTranscriptText,
    });
  }
  return evidence.length > 0
    ? evidence
    : fallback
      ? [{ sourceType: "app-context", text: fallback }]
      : [];
}

function segmentReferences(
  raw: Record<string, unknown>,
  capturedAt: string | null,
  segments: LocalSegment[],
): ScreenMemorySegmentReference[] {
  const directId = firstString(raw, ["segmentId", "segment_id"]);
  const matched = directId
    ? segments.filter((segment) => segment.id === directId)
    : capturedAt
      ? segments.filter((segment) => {
          const moment = Date.parse(capturedAt);
          const started = segment.startedAt
            ? Date.parse(segment.startedAt)
            : NaN;
          const ended = segment.endedAt ? Date.parse(segment.endedAt) : NaN;
          return moment >= started && moment <= ended;
        })
      : [];
  return matched.slice(0, 3).map((segment) => ({
    id: segment.id,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
  }));
}

function normalizeEvidence(
  row: LocalContextRow,
  segments: LocalSegment[],
): ScreenMemoryEvidenceItem[] {
  const refs = segmentReferences(row.raw, row.item.capturedAt, segments);
  const base = [
    row.item.sourceFile,
    row.item.capturedAt ?? "unknown-time",
    row.item.appName ?? "",
    row.item.windowTitle ?? "",
  ].join("|");
  const momentId =
    firstString(row.raw, ["momentId", "moment_id", "eventId", "captureId"]) ??
    stableId("moment", base);
  const appContext =
    row.item.text ||
    [row.item.appName, row.item.windowTitle, row.item.title, row.item.url]
      .filter((value): value is string => Boolean(value))
      .join(" — ");
  return sourceTexts(row.raw, appContext).map(({ sourceType, text }) => {
    const { excerpt, excerptTruncated } = boundedExcerpt(text);
    const id =
      firstString(row.raw, ["evidenceId", "evidence_id"]) ??
      stableId("evidence", `${momentId}|${sourceType}|${text}`);
    return {
      id,
      momentId,
      capturedAt: row.item.capturedAt,
      sourceType,
      excerpt,
      excerptTruncated,
      appName: row.item.appName,
      windowTitle: row.item.windowTitle,
      bundleId: row.item.bundleId,
      url: row.item.url,
      title: row.item.title,
      segmentRefs: refs,
      jumpTarget: {
        kind: "screen-memory-moment",
        momentId,
        capturedAt: row.item.capturedAt,
        segmentId: refs[0]?.id ?? null,
      },
    };
  });
}

function transcriptSpan(row: LocalContextRow): LocalTranscriptSpan | null {
  const segmentId = firstString(row.raw, ["segmentId", "segment_id"]);
  const source = firstString(row.raw, ["source", "kind"]);
  const startMs = firstFiniteNumber(row.raw, ["startMs", "start_ms"]);
  const endMs = firstFiniteNumber(row.raw, ["endMs", "end_ms"]);
  if (
    !segmentId ||
    !source ||
    startMs === null ||
    endMs === null ||
    endMs <= startMs ||
    !firstString(row.raw, ["text"])
  ) {
    return null;
  }
  return { row, segmentId, source, startMs, endMs };
}

/**
 * Whisper emits phrase-sized rows, which can split an ordinary sentence in
 * the middle. Join only rows that are demonstrably continuous in the same
 * finalized segment and audio source. Stored sidecars remain untouched, and a
 * real pause, source switch, segment boundary, or excerpt bound starts a new
 * evidence item.
 */
function coalesceTranscriptRows(rows: LocalContextRow[]): LocalContextRow[] {
  const passthrough: LocalContextRow[] = [];
  const groups = new Map<string, LocalTranscriptSpan[]>();

  for (const row of rows) {
    const span = transcriptSpan(row);
    if (!span) {
      passthrough.push(row);
      continue;
    }
    const key = [row.item.sourceFile, span.segmentId, span.source].join("\0");
    const group = groups.get(key) ?? [];
    group.push(span);
    groups.set(key, group);
  }

  const joined = [...groups.values()].flatMap((group) => {
    const ordered = group.sort((a, b) => a.startMs - b.startMs);
    const output: LocalContextRow[] = [];
    let current: LocalTranscriptSpan | null = null;

    for (const next of ordered) {
      const currentText = current
        ? (firstString(current.row.raw, ["text"]) ?? "")
        : "";
      const nextText = firstString(next.row.raw, ["text"]) ?? "";
      const gapMs = current ? next.startMs - current.endMs : Infinity;
      const combinedText = [currentText, nextText].filter(Boolean).join(" ");
      const canJoin =
        current !== null &&
        gapMs >= 0 &&
        gapMs <= MAX_TRANSCRIPT_JOIN_GAP_MS &&
        combinedText.length <= MAX_EXCERPT_CHARS;

      if (!current || !canJoin) {
        if (current) output.push(current.row);
        current = {
          ...next,
          row: {
            item: { ...next.row.item },
            raw: { ...next.row.raw },
          },
        };
        continue;
      }

      current.endMs = next.endMs;
      current.row.item.text = combinedText;
      current.row.raw.text = combinedText;
      if ("end_ms" in current.row.raw) current.row.raw.end_ms = next.endMs;
      else current.row.raw.endMs = next.endMs;
    }
    if (current) output.push(current.row);
    return output;
  });

  return [...passthrough, ...joined].sort(
    (a, b) => itemTime(b.item) - itemTime(a.item),
  );
}

async function readRows(files: string[]): Promise<{
  rows: LocalContextRow[];
  sourceRowsReadTruncated: boolean;
}> {
  const { fs } = await nodeModules();
  const rows: LocalContextRow[] = [];
  let sourceRowsReadTruncated = false;

  for (const file of files) {
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const allLines = text.split(/\r?\n/).filter(Boolean);
    if (allLines.length > MAX_SOURCE_ROWS) sourceRowsReadTruncated = true;
    const lines = allLines.slice(-MAX_SOURCE_ROWS);
    for (const line of lines) {
      try {
        const raw = asRecord(JSON.parse(line));
        const item = raw ? normalizeContextItem(raw, file) : null;
        if (item && raw) rows.push({ item, raw });
      } catch {
        // Keep one malformed row from hiding the rest of the local context.
      }
    }
  }

  return {
    rows: coalesceTranscriptRows(rows),
    sourceRowsReadTruncated,
  };
}

async function readItems(files: string[]): Promise<ScreenMemoryContextItem[]> {
  const { rows } = await readRows(files);
  return rows.map(({ item }) => item);
}

async function readSegments(dataDirs: string[]): Promise<LocalSegment[]> {
  const { fs, path } = await nodeModules();
  const segments: LocalSegment[] = [];
  for (const dir of dataDirs) {
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((candidate) =>
      candidate.endsWith(".json"),
    )) {
      const raw = asRecord(await readJson(path.join(dir, name)));
      const id = raw && firstString(raw, ["id"]);
      if (!raw || !id) continue;
      const mediaPath = firstString(raw, ["path"]);
      let retained = true;
      if (mediaPath) {
        try {
          await fs.access(mediaPath);
        } catch {
          retained = false;
        }
      }
      segments.push({
        id,
        startedAt: firstString(raw, ["startedAt"]),
        endedAt: firstString(raw, ["endedAt"]),
        clean:
          retained &&
          raw.exclusionTainted !== true &&
          raw.corrupt !== true &&
          !firstString(raw, ["error"]),
      });
    }
  }
  return segments;
}

async function readOcrIndexStates(
  dataDirs: string[],
): Promise<Array<{ segmentId: string; state: ScreenMemoryOcrIndexState }>> {
  const { fs, path } = await nodeModules();
  const states: Array<{ segmentId: string; state: ScreenMemoryOcrIndexState }> =
    [];
  for (const dir of dataDirs) {
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.filter(
      (entry) =>
        entry.endsWith(".ocr-status.json") ||
        entry.endsWith(".transcript-status.json"),
    )) {
      const raw = asRecord(await readJson(path.join(dir, name)));
      const rawState = String(raw?.state);
      const state = rawState === "transcribing" ? "indexing" : rawState;
      const suffix = name.endsWith(".ocr-status.json")
        ? ".ocr-status.json"
        : ".transcript-status.json";
      const segmentId = name.slice(0, -suffix.length);
      if (
        ["pending", "indexing", "ready", "failed", "skipped"].includes(
          String(state),
        )
      ) {
        states.push({ segmentId, state: state as ScreenMemoryOcrIndexState });
      }
    }
  }
  return states;
}

export async function queryScreenMemoryContext(
  args: {
    query?: string | null;
    limit?: number | null;
    sinceMinutes?: number | null;
  } = {},
  options: ScreenMemoryLocalOptions = {},
): Promise<ScreenMemoryQueryResult> {
  const info = await readConfigInfo(options);
  const paths = await resolvePaths(options);
  const { files } = await contextFilesFor(paths.dataDirs);
  const query = args.query?.trim() || null;
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? 10), 1), 50);
  const sinceMinutes =
    typeof args.sinceMinutes === "number" && Number.isFinite(args.sinceMinutes)
      ? Math.max(args.sinceMinutes, 0)
      : null;
  const now = options.now?.() ?? new Date();
  const cutoff =
    sinceMinutes === null ? null : now.getTime() - sinceMinutes * 60 * 1000;

  const needle = query?.toLowerCase() ?? null;
  const source = await readRows(files);
  const rangeRows = source.rows.filter((row) => {
    const { item } = row;
    if (cutoff !== null) {
      const time = itemTime(item);
      if (!time || time < cutoff) return false;
    }
    return true;
  });
  const privacyExcludedRows = rangeRows.filter((row) =>
    isPrivacyExcludedRow(row, info.config),
  );
  const candidateRows = rangeRows.filter((row) => {
    if (isPrivacyExcludedRow(row, info.config)) return false;
    if (!needle) return true;
    const { item } = row;
    return JSON.stringify({ item, raw: row.raw })
      .toLowerCase()
      .includes(needle);
  });
  const segments = await readSegments(paths.dataDirs);
  const cleanSegments = segments.filter((segment) => segment.clean);
  // Modern stores bind every evidence row to retained segment metadata. Once
  // segment metadata exists, refuse rows that only point at tainted, corrupt,
  // or pruned media. Legacy context-only stores (no segment metadata at all)
  // remain readable for backwards compatibility.
  const rows =
    segments.length === 0
      ? candidateRows
      : candidateRows.filter(
          (row) =>
            segmentReferences(row.raw, row.item.capturedAt, cleanSegments)
              .length > 0,
        );
  const items = rows.map(({ item }) => item);
  const ocrIndexStates = await readOcrIndexStates(paths.dataDirs);
  const evidence = rows.flatMap((row) => normalizeEvidence(row, cleanSegments));
  const returnedEvidence = evidence.slice(0, limit);
  const evidenceTimes = evidence
    .map((item) => (item.capturedAt ? Date.parse(item.capturedAt) : NaN))
    .filter(Number.isFinite);
  const coveredRange = evidenceTimes.length
    ? {
        startedAt: new Date(Math.min(...evidenceTimes)).toISOString(),
        endedAt: new Date(Math.max(...evidenceTimes)).toISOString(),
      }
    : { startedAt: null, endedAt: null };
  const requestedRange = {
    startedAt: cutoff === null ? null : new Date(cutoff).toISOString(),
    endedAt: now.toISOString(),
  };
  const gaps: ScreenMemoryCoverageGap[] = [];
  if (privacyExcludedRows.length > 0) {
    gaps.push({
      ...rowTimeRange(privacyExcludedRows, requestedRange),
      reason: "privacy-excluded-or-unretained",
    });
  }
  if (candidateRows.length > rows.length) {
    gaps.push({
      ...requestedRange,
      reason: "privacy-excluded-or-unretained",
    });
  }
  for (const index of ocrIndexStates) {
    if (index.state === "ready") continue;
    const segment = segments.find(
      (candidate) => candidate.id === index.segmentId,
    );
    const reason =
      index.state === "failed"
        ? "index-failed"
        : index.state === "skipped"
          ? "index-skipped"
          : "index-pending";
    gaps.push({
      startedAt: segment?.startedAt ?? null,
      endedAt: segment?.endedAt ?? null,
      reason,
    });
  }
  if (files.length === 0) {
    gaps.push({ ...requestedRange, reason: "no-context-files" });
  } else if (evidence.length === 0) {
    gaps.push({ ...requestedRange, reason: "no-evidence-in-requested-range" });
  } else {
    if (evidence.some((item) => !item.capturedAt)) {
      gaps.push({
        startedAt: null,
        endedAt: null,
        reason: "timestamps-unavailable",
      });
    }
    if (
      requestedRange.startedAt &&
      coveredRange.startedAt &&
      coveredRange.startedAt > requestedRange.startedAt
    ) {
      gaps.push({
        startedAt: requestedRange.startedAt,
        endedAt: coveredRange.startedAt,
        reason: "missing-before-first-evidence",
      });
    }
    const staleAfterMs = Math.max(
      info.config.sampleIntervalSeconds * 3 * 1000,
      2 * 60 * 1000,
    );
    if (
      coveredRange.endedAt &&
      Date.parse(coveredRange.endedAt) < now.getTime() - staleAfterMs
    ) {
      gaps.push({
        startedAt: coveredRange.endedAt,
        endedAt: requestedRange.endedAt,
        reason: "capture-stale",
      });
    }
  }

  return {
    feature: "screen-memory",
    localOnly: true,
    enabled: info.config.enabled,
    paused: info.config.paused,
    query,
    sinceMinutes,
    count: items.length,
    items: items.slice(0, limit),
    evidence: returnedEvidence,
    coverage: { requestedRange, coveredRange, gaps },
    truncation: {
      itemLimit: limit,
      returnedItems: returnedEvidence.length,
      omittedItems: Math.max(evidence.length - returnedEvidence.length, 0),
      maxExcerptChars: MAX_EXCERPT_CHARS,
      excerptsTruncated: returnedEvidence.filter(
        (item) => item.excerptTruncated,
      ).length,
      sourceRowsReadLimit: MAX_SOURCE_ROWS,
      sourceRowsReadTruncated: source.sourceRowsReadTruncated,
    },
    contextFiles: files,
    note:
      files.length === 0
        ? "No local Screen Memory context files were found. Enable Screen Memory in Clips desktop and keep the local MCP capability connected."
        : "Local Screen Memory context only. Do not treat this as shared, hosted, or exhaustive.",
  };
}

/**
 * Agent-facing retrieval boundary. Asking an agent to search Rewind is the
 * authorization. This removes filesystem paths, redacts obvious
 * credential-shaped text, and records a content-free activity receipt before
 * it is returned to an action caller.
 */
export async function queryScreenMemoryForAgent(
  args: {
    query?: string | null;
    limit?: number | null;
    sinceMinutes?: number | null;
  } = {},
  options: ScreenMemoryLocalOptions = {},
): Promise<ScreenMemoryAgentQueryResult> {
  const result = await queryScreenMemoryContext(args, options);
  const items = result.items.map((item) => ({
    ...item,
    text: redactCredentialText(item.text),
    sourceFile: "local-screen-memory",
  }));
  const evidence = result.evidence.map((item) => ({
    ...item,
    excerpt: redactCredentialText(item.excerpt),
  }));
  const packet = {
    question: redactCredentialText(
      args.query?.trim().slice(0, 4_000) || "Recent Screen Memory context",
    ),
    evidence: evidence.slice(0, 20).map((item) => ({
      id: item.id,
      momentId: item.momentId,
      sourceType: item.sourceType,
      capturedAt: item.capturedAt,
      excerpt: item.excerpt.slice(0, MAX_EXCERPT_CHARS),
    })),
  };
  const paths = await resolvePaths(options);
  const { fs, path } = await nodeModules();
  const storeDir = paths.dataDirs[0];
  await fs.mkdir(storeDir, { recursive: true, mode: 0o700 });
  await fs.chmod(storeDir, 0o700);
  const logPath = path.join(storeDir, "egress.jsonl");
  if (await exists(logPath)) {
    const sanitized = (await fs.readFile(logPath, "utf8"))
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
              evidence: packet.evidence.map((item) => ({
                id: item.id,
                momentId: item.momentId,
                sourceType: item.sourceType,
                capturedAt: item.capturedAt ?? null,
              })),
            };
          }
          delete event.packet;
          delete event.reason;
          event.packetBytes =
            typeof event.packetBytes === "number" ? event.packetBytes : 0;
          return [JSON.stringify(event)];
        } catch {
          return [];
        }
      });
    const temporaryPath = `${logPath}.sanitize-${process.pid}`;
    await fs.writeFile(
      temporaryPath,
      sanitized.length > 0 ? `${sanitized.join("\n")}\n` : "",
      { encoding: "utf8", mode: 0o600 },
    );
    await fs.rename(temporaryPath, logPath);
  }
  const requestId = `egress-action-${Date.now()}-${process.pid}`;
  const prepared = {
    requestId,
    occurredAt: new Date().toISOString(),
    state: "prepared",
    operation: "agent-query",
    receipt: {
      evidence: packet.evidence.map(
        ({ id, momentId, sourceType, capturedAt }) => ({
          id,
          momentId,
          sourceType,
          capturedAt,
        }),
      ),
    },
    evidenceCount: packet.evidence.length,
    packetBytes: 0,
    error: null,
  };
  const completed = {
    ...prepared,
    occurredAt: new Date().toISOString(),
    state: "completed",
    receipt: null,
  };
  await fs.appendFile(
    logPath,
    `${JSON.stringify(prepared)}\n${JSON.stringify(completed)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await fs.chmod(logPath, 0o600);
  return {
    ...result,
    items,
    evidence,
    contextFiles: [],
    egress: {
      requestId,
      packet,
      note: "A content-free local activity receipt was recorded before this bounded text packet was returned.",
    },
  };
}

export async function readScreenMemoryStatus(
  options: ScreenMemoryLocalOptions = {},
): Promise<ScreenMemoryStatus> {
  const info = await readConfigInfo(options);
  const paths = await resolvePaths(options);
  const { files, storageBytes } = await contextFilesFor(paths.dataDirs);
  const items = await readItems(files);
  const times = items.map(itemTime).filter(Boolean);
  const oldest = times.length
    ? new Date(Math.min(...times)).toISOString()
    : null;
  const newest = times.length
    ? new Date(Math.max(...times)).toISOString()
    : null;
  const state = !info.config.enabled
    ? "disabled"
    : info.config.paused
      ? "paused"
      : files.length === 0
        ? "empty"
        : "ready";

  return {
    feature: "screen-memory",
    localOnly: true,
    enabled: info.config.enabled,
    paused: info.config.paused,
    state,
    config: info.config,
    configPath: info.path,
    configSource: info.source,
    dataDirs: paths.dataDirs,
    contextFiles: files,
    captureCount: items.length,
    storageBytes,
    oldestCaptureAt: oldest,
    newestCaptureAt: newest,
    note:
      state === "disabled"
        ? "Screen Memory is disabled by default. Turn it on from Clips desktop Settings before agents can use recent screen context."
        : state === "empty"
          ? "Screen Memory is enabled, but no local context files were found yet."
          : "Screen Memory status is local to this machine.",
  };
}
