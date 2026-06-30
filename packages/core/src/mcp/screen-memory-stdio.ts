import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface ScreenMemoryEvent {
  capturedAt: string;
  appName?: string | null;
  windowTitle?: string | null;
  bundleId?: string | null;
  source: string;
}

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
}

interface ScreenMemoryConfig {
  enabled?: boolean;
  paused?: boolean;
  retentionHours?: number;
  maxBytes?: number;
}

export interface RunScreenMemoryMCPStdioOptions {
  storeDir?: string;
  env?: NodeJS.ProcessEnv;
}

const EVENTS_JSONL = "events.jsonl";

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

function readJsonl<T>(file: string): T[] {
  let body = "";
  try {
    body = fs.readFileSync(file, "utf-8");
  } catch {
    return [];
  }
  return body
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        return null;
      }
    })
    .filter((value): value is T => Boolean(value));
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

function eventMatches(event: ScreenMemoryEvent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [event.appName, event.windowTitle, event.bundleId, event.source].some(
    (value) => value?.toLowerCase().includes(needle),
  );
}

function recentEvents(
  storeDir: string,
  args: { query?: string; minutes?: number; limit?: number },
): ScreenMemoryEvent[] {
  const cutoff = cutoffFor(args.minutes ?? 30);
  const limit = Math.max(1, Math.min(args.limit ?? 40, 200));
  return readJsonl<ScreenMemoryEvent>(path.join(storeDir, EVENTS_JSONL))
    .filter((event) => {
      const capturedAt = Date.parse(event.capturedAt);
      return Number.isFinite(capturedAt) && capturedAt >= cutoff;
    })
    .filter((event) => eventMatches(event, args.query ?? ""))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .slice(0, limit);
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
    tools: [
      {
        name: "screen_memory_status",
        description:
          "Read local Clips Screen Memory status, retention, disk usage, and store path. Local-only.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "screen_memory_recent_context",
        description:
          "Search recent local Screen Memory app/window context. Returns timestamps, app names, window titles, and bundle ids; does not return images.",
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
              description: "Maximum events to return. Defaults to 40.",
            },
          },
        },
      },
      {
        name: "screen_memory_recent_segments",
        description:
          "List recent local Screen Memory video segment file paths and timestamps. Use only when the user asks to inspect or export local context.",
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
    ],
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
        storeDir,
      });
    }
    if (name === "screen_memory_recent_context") {
      return textResult({
        storeDir,
        events: recentEvents(storeDir, {
          query: typeof args.query === "string" ? args.query : undefined,
          minutes: typeof args.minutes === "number" ? args.minutes : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        }),
      });
    }
    if (name === "screen_memory_recent_segments") {
      const minutes = typeof args.minutes === "number" ? args.minutes : 30;
      return textResult({
        storeDir,
        segments: recentSegments(storeDir, minutes),
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
