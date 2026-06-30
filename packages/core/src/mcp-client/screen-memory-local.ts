export interface ScreenMemoryConfig {
  enabled: boolean;
  paused: boolean;
  retentionHours: number;
  maxBytes: number;
  segmentSeconds: number;
  sampleIntervalSeconds: number;
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

export interface ScreenMemoryQueryResult {
  feature: "screen-memory";
  localOnly: true;
  enabled: boolean;
  paused: boolean;
  query: string | null;
  sinceMinutes: number | null;
  count: number;
  items: ScreenMemoryContextItem[];
  contextFiles: string[];
  note: string;
}

export interface ScreenMemoryLocalOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
}

const DEFAULT_CONFIG: ScreenMemoryConfig = {
  enabled: false,
  paused: false,
  retentionHours: 24,
  maxBytes: 20 * 1024 * 1024 * 1024,
  segmentSeconds: 5 * 60,
  sampleIntervalSeconds: 10,
};

const JSONL_NAMES = [
  "context.jsonl",
  "events.jsonl",
  "snapshots.jsonl",
  "screen-memory.jsonl",
];

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

function normalizeConfig(value: unknown): ScreenMemoryConfig {
  const raw = asRecord(value) ?? {};
  return {
    enabled: booleanValue(raw.enabled, DEFAULT_CONFIG.enabled),
    paused: booleanValue(raw.paused, DEFAULT_CONFIG.paused),
    retentionHours: positiveNumber(
      raw.retentionHours,
      DEFAULT_CONFIG.retentionHours,
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

async function readItems(files: string[]): Promise<ScreenMemoryContextItem[]> {
  const { fs } = await nodeModules();
  const items: ScreenMemoryContextItem[] = [];

  for (const file of files) {
    let text = "";
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/).filter(Boolean).slice(-10_000);
    for (const line of lines) {
      try {
        const item = normalizeContextItem(JSON.parse(line), file);
        if (item) items.push(item);
      } catch {
        // Keep one malformed row from hiding the rest of the local context.
      }
    }
  }

  return items.sort((a, b) => itemTime(b) - itemTime(a));
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
  const cutoff =
    sinceMinutes === null ? null : Date.now() - sinceMinutes * 60 * 1000;

  const needle = query?.toLowerCase() ?? null;
  const items = (await readItems(files)).filter((item) => {
    if (cutoff !== null) {
      const time = itemTime(item);
      if (!time || time < cutoff) return false;
    }
    if (!needle) return true;
    return JSON.stringify(item).toLowerCase().includes(needle);
  });

  return {
    feature: "screen-memory",
    localOnly: true,
    enabled: info.config.enabled,
    paused: info.config.paused,
    query,
    sinceMinutes,
    count: items.length,
    items: items.slice(0, limit),
    contextFiles: files,
    note:
      files.length === 0
        ? "No local Screen Memory context files were found. Enable Screen Memory in Clips desktop and keep the local MCP capability connected."
        : "Local Screen Memory context only. Do not treat this as shared, hosted, or exhaustive.",
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
