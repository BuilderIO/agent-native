/**
 * The decisions behind `journey:capture`, kept free of the network and the
 * browser: which examples to render, how they group by recording, what each
 * file is called, which token authenticates, and what the manifest says.
 */
import path from "node:path";

import { SESSION_REPLAY_AGENT_ACCESS_PARAM } from "../shared/session-replay-agent-access.js";

export const DEFAULT_APP_URL = "https://analytics.agent-native.com";

export interface TreeExample {
  sessionId: string;
  recordingId: string | null;
  ts: string;
  offsetMs: number | null;
  viewport: { width: number; height: number } | null;
}

export interface TreeNode {
  key: string;
  examples: TreeExample[];
}

export class TreeFormatError extends Error {}

function fail(where: string, expected: string): never {
  throw new TreeFormatError(
    `Tree JSON is not a JourneyTree: ${where} ${expected}.`,
  );
}

/** Reads only what capture needs from a JourneyTree and rejects anything else loudly. */
export function parseTree(raw: unknown): { nodes: TreeNode[] } {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as any).nodes)) {
    fail("the top level", "must be an object with a nodes array");
  }
  const nodes = ((raw as any).nodes as unknown[]).map((node, i) => {
    const n = node as Record<string, unknown> | null;
    if (!n || typeof n.key !== "string" || !n.key) {
      fail(`nodes[${i}].key`, "must be a non-empty string");
    }
    if (!Array.isArray(n.examples)) {
      fail(`nodes[${i}].examples`, "must be an array");
    }
    const examples = (n.examples as unknown[]).map((example, j) => {
      const e = example as Record<string, unknown> | null;
      const at = `nodes[${i}].examples[${j}]`;
      if (!e || typeof e.sessionId !== "string") {
        fail(`${at}.sessionId`, "must be a string");
      }
      if (e.recordingId !== null && typeof e.recordingId !== "string") {
        fail(`${at}.recordingId`, "must be a string or null");
      }
      if (
        e.offsetMs !== null &&
        !(typeof e.offsetMs === "number" && Number.isFinite(e.offsetMs))
      ) {
        fail(`${at}.offsetMs`, "must be a number or null");
      }
      const v = e.viewport as Record<string, unknown> | null | undefined;
      if (
        v !== null &&
        v !== undefined &&
        !(
          typeof v.width === "number" &&
          typeof v.height === "number" &&
          v.height > 0
        )
      ) {
        fail(`${at}.viewport`, "must be { width, height } or null");
      }
      return {
        sessionId: e.sessionId as string,
        recordingId: e.recordingId as string | null,
        ts: typeof e.ts === "string" ? e.ts : "",
        offsetMs: e.offsetMs as number | null,
        viewport: v
          ? { width: v.width as number, height: v.height as number }
          : null,
      };
    });
    return { key: n.key as string, examples };
  });
  return { nodes };
}

export interface PlanOptions {
  perNode: number;
  minAspect?: number;
  maxAspect?: number;
}

export interface PlanItem {
  nodeKey: string;
  exampleIndex: number;
  recordingId: string;
  offsetMs: number;
  viewport: { width: number; height: number } | null;
  sourceEventAt: string | null;
}

export interface SkippedExample {
  nodeKey: string;
  exampleIndex: number;
  reason: "no_recording" | "no_offset" | "aspect_out_of_range";
}

export function aspectInRange(
  width: number,
  height: number,
  options: Pick<PlanOptions, "minAspect" | "maxAspect">,
): boolean {
  const aspect = width / height;
  return (
    (options.minAspect === undefined || aspect >= options.minAspect) &&
    (options.maxAspect === undefined || aspect <= options.maxAspect)
  );
}

/**
 * Up to `perNode` renderable examples per node, in the tree's order. An
 * example with no recording or offset, or a known viewport outside the aspect
 * range, is listed as skipped. An unknown viewport is rendered and checked on
 * the captured size instead.
 */
export function planCapture(
  tree: { nodes: TreeNode[] },
  options: PlanOptions,
): { items: PlanItem[]; skipped: SkippedExample[] } {
  const items: PlanItem[] = [];
  const skipped: SkippedExample[] = [];
  for (const node of tree.nodes) {
    let taken = 0;
    node.examples.forEach((example, exampleIndex) => {
      const skip = (reason: SkippedExample["reason"]) =>
        skipped.push({ nodeKey: node.key, exampleIndex, reason });
      if (!example.recordingId) return skip("no_recording");
      if (example.offsetMs === null || example.offsetMs < 0) {
        return skip("no_offset");
      }
      if (
        example.viewport &&
        !aspectInRange(example.viewport.width, example.viewport.height, options)
      ) {
        return skip("aspect_out_of_range");
      }
      if (taken >= options.perNode) return;
      taken += 1;
      items.push({
        nodeKey: node.key,
        exampleIndex,
        recordingId: example.recordingId,
        offsetMs: Math.round(example.offsetMs),
        viewport: example.viewport,
        sourceEventAt: example.ts || null,
      });
    });
  }
  return { items, skipped };
}

export interface RecordingPlan {
  recordingId: string;
  items: PlanItem[];
}

/** One entry per recording, offsets ascending, so each recording opens once. */
export function groupByRecording(items: readonly PlanItem[]): RecordingPlan[] {
  const groups = new Map<string, PlanItem[]>();
  for (const item of items) {
    const list = groups.get(item.recordingId);
    if (list) list.push(item);
    else groups.set(item.recordingId, [item]);
  }
  return [...groups].map(([recordingId, list]) => ({
    recordingId,
    items: [...list].sort(
      (a, b) =>
        a.offsetMs - b.offsetMs ||
        (a.nodeKey < b.nodeKey ? -1 : a.nodeKey > b.nodeKey ? 1 : 0) ||
        a.exampleIndex - b.exampleIndex,
    ),
  }));
}

/** `<nodeKey>-<n>.png` with the key made filesystem-safe; unique within `used`. */
export function frameFileName(
  nodeKey: string,
  exampleIndex: number,
  used: Set<string>,
): string {
  const slug =
    nodeKey
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120) || "node";
  let name = `${slug}-${exampleIndex}.png`;
  for (let suffix = 2; used.has(name); suffix += 1) {
    name = `${slug}~${suffix}-${exampleIndex}.png`;
  }
  used.add(name);
  return name;
}

export interface ManifestFrame {
  nodeKey: string;
  exampleIndex: number;
  recordingId: string;
  offsetMs: number;
  width: number;
  height: number;
  localPath: string;
  capturedAt: string;
  assetStatus: "not_fetched" | "preflighted";
  sourceEventAt: string | null;
  replayAt: string | null;
  route?: string;
  attachmentRef?: string;
}

export interface ManifestFailure {
  nodeKey: string;
  exampleIndex: number;
  recordingId: string;
  offsetMs: number;
  reason: string;
  sourceEventAt: string | null;
  replayAt: string | null;
  assetStatus?: "preflight_failed";
  code?:
    | "replay_iframe_content_unavailable"
    | "replay_iframe_visibility_unverifiable";
  diagnostics?: {
    visibleIframeCount: number;
    unavailableIframeCount: number;
    unverifiableIframeCount?: number;
  };
}

export function replayAtFromRecordingStart(
  recordingStartedAtMs: number,
  offsetMs: number,
): string | null {
  const timestamp = recordingStartedAtMs + offsetMs;
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return null;
  return new Date(timestamp).toISOString();
}

export function replayIframeParentIdsAt(
  events: readonly unknown[],
  throughTimestamp: number,
): Set<number> {
  if (!Number.isFinite(throughTimestamp)) {
    throw new Error("replay_iframe_timestamp_invalid");
  }
  const parentIds = new Set<number>();
  for (const value of events) {
    const event = asRecord(value);
    if (
      !event ||
      event.type !== 3 ||
      typeof event.timestamp !== "number" ||
      !Number.isFinite(event.timestamp) ||
      event.timestamp > throughTimestamp
    ) {
      continue;
    }
    const data = asRecord(event.data);
    if (data?.isAttachIframe !== true || !Array.isArray(data.adds)) continue;
    for (const value of data.adds) {
      const addition = asRecord(value);
      const node = asRecord(addition?.node);
      const parentId = addition?.parentId;
      if (node?.type === 0 && Number.isSafeInteger(parentId)) {
        parentIds.add(parentId as number);
      }
    }
  }
  return parentIds;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export interface CaptureManifest {
  generatedAt: string;
  appUrl: string;
  captureMode: "offline" | "browser";
  remoteAssets: "not-fetched" | "browser-preflight-per-frame";
  promptProvenancePath?: string;
  frames: ManifestFrame[];
  failures: ManifestFailure[];
  skipped: SkippedExample[];
}

/**
 * The planned frames a stopped run never got to, as failures, so a manifest
 * from a run that stopped early cannot pass for a smaller complete one.
 */
export function unattemptedFailures(
  items: readonly PlanItem[],
  frames: readonly ManifestFrame[],
  failures: readonly ManifestFailure[],
  reason: string,
): ManifestFailure[] {
  const key = (item: { nodeKey: string; exampleIndex: number }) =>
    `${item.nodeKey}\u0000${item.exampleIndex}`;
  const accounted = new Set([...frames, ...failures].map(key));
  return items
    .filter((item) => !accounted.has(key(item)))
    .map((item) => ({
      nodeKey: item.nodeKey,
      exampleIndex: item.exampleIndex,
      recordingId: item.recordingId,
      offsetMs: item.offsetMs,
      reason,
      sourceEventAt: item.sourceEventAt,
      replayAt: null,
    }));
}

export function buildManifest(input: {
  generatedAt: string;
  appUrl: string;
  captureMode: "offline" | "browser";
  promptProvenancePath?: string;
  frames: ManifestFrame[];
  failures: ManifestFailure[];
  skipped: SkippedExample[];
  outDir: string;
}): CaptureManifest {
  const order = (a: { nodeKey: string; exampleIndex: number }, b: typeof a) =>
    a.nodeKey < b.nodeKey
      ? -1
      : a.nodeKey > b.nodeKey
        ? 1
        : a.exampleIndex - b.exampleIndex;
  return {
    generatedAt: input.generatedAt,
    appUrl: input.appUrl,
    captureMode: input.captureMode,
    remoteAssets:
      input.captureMode === "browser"
        ? "browser-preflight-per-frame"
        : "not-fetched",
    ...(input.promptProvenancePath
      ? { promptProvenancePath: input.promptProvenancePath }
      : {}),
    frames: [...input.frames]
      .map((frame) => ({
        ...frame,
        localPath: path.resolve(input.outDir, frame.localPath),
      }))
      .sort(order),
    failures: [...input.failures].sort(order),
    skipped: input.skipped,
  };
}

/** The exit code: failing every frame is an error; a partial run is reported, not fatal. */
export function exitCodeFor(
  manifest: Pick<CaptureManifest, "frames" | "failures">,
): number {
  return manifest.frames.length === 0 && manifest.failures.length > 0 ? 1 : 0;
}

export function normalizeAppUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(
      `--app-url must be a URL like ${DEFAULT_APP_URL}, got "${raw}".`,
    );
  }
  if (url.protocol !== "https:" && !isLoopbackHost(url.hostname)) {
    throw new Error(
      "--app-url must use https:// so the token is not sent in cleartext.",
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function replayFrameUrlFromAgentLink(
  pageUrl: string,
  appUrl: string,
  recordingId: string,
): string {
  let link: URL;
  try {
    link = new URL(pageUrl);
  } catch {
    throw new Error("replay_link_invalid");
  }
  const app = new URL(appUrl);
  const basePath = app.pathname.replace(/\/+$/, "");
  const expectedPath = `${basePath}/sessions/${encodeURIComponent(recordingId)}`;
  if (
    link.username ||
    link.password ||
    link.hash ||
    link.origin !== app.origin ||
    link.pathname !== expectedPath ||
    !link.searchParams.get(SESSION_REPLAY_AGENT_ACCESS_PARAM) ||
    link.searchParams.size !== 1
  ) {
    throw new Error("replay_link_invalid");
  }
  link.searchParams.set("frame", "1");
  return link.toString();
}

export function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname);
}

export function stripBearer(token: string): string {
  return token.trim().replace(/^bearer\s+/i, "");
}

function unescapeToml(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * The bearer `agent-native connect --client codex` wrote for this app: an MCP
 * server table in Codex's config.toml whose url is on the app's origin and
 * whose `http_headers` carry `Authorization = "Bearer ..."`.
 */
export function codexBearerForApp(
  appUrl: string,
  toml: string,
): string | undefined {
  const origin = new URL(appUrl).origin;
  let url: string | undefined;
  let headers: string | undefined;
  let found: string | undefined;
  const flush = () => {
    if (found || !url || !headers || !URL.canParse(url)) return;
    if (new URL(url).origin !== origin) return;
    const match = headers.match(/"authorization"\s*=\s*"((?:\\.|[^"])*)"/i);
    if (match) found = stripBearer(unescapeToml(match[1]!));
  };
  for (const line of toml.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      flush();
      url = headers = undefined;
      continue;
    }
    const urlMatch = line.match(/^\s*url\s*=\s*"((?:\\.|[^"])*)"/);
    if (urlMatch) url = unescapeToml(urlMatch[1]!);
    if (/^\s*http_headers\s*=/.test(line)) headers = line;
  }
  flush();
  return found;
}

export function connectCommand(appUrl: string): string {
  return `npx -y @agent-native/core@latest connect ${appUrl} --client codex`;
}

export function unauthenticatedMessage(appUrl: string): string {
  return [
    `Not authenticated to ${appUrl}. journey:capture only reads the deployed app, never a local database.`,
    `Run:  ${connectCommand(appUrl)}`,
    "then re-run this command: it reads the bearer that command writes to ~/.codex/config.toml.",
    "Or pass --token <bearer> / set AGENT_NATIVE_TOKEN to a bearer for that app.",
  ].join("\n");
}

/**
 * A short, single-line reason from a Playwright or page error: no stack, no
 * "page.evaluate:" prefix, and no URL query string. Navigation errors quote
 * the frame URL, whose query carries the recording's `agent_access` token, and
 * a reason is written to manifest.json.
 */
export function reasonFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const first = message
    .split("\n")[0]!
    .replace(/(https?:\/\/[^\s"'?#]*)\?[^\s"'#]*/gi, "$1?[redacted]")
    .replace(/^page\.\w+:\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim();
  return first.slice(0, 200) || "unknown_error";
}
