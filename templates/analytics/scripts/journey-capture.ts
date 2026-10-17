#!/usr/bin/env tsx
/**
 * journey:capture - render onboarding journey frames from a JourneyTree.
 *
 * Reads the tree JSON that the `get-onboarding-journey` MCP tool returns, mints
 * a short-lived scoped replay link per recording on the Analytics app, reads
 * authorized replay chunks into memory, and renders them with the local rrweb
 * player in headless Chromium. Frames are native browser screenshots; the
 * command never reads a local database or saves raw replay events.
 */
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  Agent as HttpAgent,
  request as httpRequest,
  type IncomingHttpHeaders,
  type RequestOptions,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { normalizeJourneyPath } from "../shared/journey-path.js";
import { isScreenshotSize, pngDimensions } from "../shared/png";
import {
  buildReplayViewportTimeline,
  normalizeReplayEvents,
  resolveReplayOffsetFromRecordingStart,
  replayAvailabilityErrorKey,
  replayInitialViewportDimensions,
  replayRouteAtOffset,
  replayViewportDimensionsAtTime,
  type AnyReplayEvent,
} from "../shared/replay-playback.js";
import { SESSION_REPLAY_AGENT_ACCESS_PARAM } from "../shared/session-replay-agent-access.js";
import {
  auditReplayIframeContent,
  type ReplayIframeAudit,
} from "./journey-capture-iframe-audit";
import {
  isReplayDnsLookupFailure,
  isReplayRequestAllowed,
  replayBrowserLaunchOptions,
  resolvePinnedAddresses,
  startReplaySocksRelay,
  type ReplaySocksRelay,
} from "./journey-capture-network";
import {
  aspectInRange,
  buildManifest,
  codexBearerForApp,
  DEFAULT_APP_URL,
  exitCodeFor,
  frameFileName,
  groupByRecording,
  normalizeAppUrl,
  parseTree,
  planCapture,
  replayAtFromRecordingStart,
  replayFrameUrlFromAgentLink,
  replayIframeParentIdsAt,
  reasonFromError,
  stripBearer,
  TreeFormatError,
  unattemptedFailures,
  unauthenticatedMessage,
  isLoopbackHost,
  writeCaptureOutputs,
  type ManifestFailure,
  type ManifestFrame,
  type RecordingPlan,
} from "./journey-capture-plan";
import { sanitizePromptProvenanceCandidates } from "./journey-capture-provenance";

export { isReplayRequestAllowed } from "./journey-capture-network";

const HELP = `journey:capture - render onboarding journey frames from a JourneyTree

Usage:
  pnpm --filter analytics journey:capture --tree tree.json --out ./frames [options]

The tree is the JSON returned by the get-onboarding-journey MCP tool. Relative
paths resolve from the directory you ran the command in. Replay events are read
through a short-lived recording-scoped link and remain in memory.

Options:
  --tree <file>          JourneyTree JSON (required)
  --out <dir>            Output directory for PNGs and manifest.json (default ./frames)
  --per-node <n>         Frames per node (default 2, max 10)
  --concurrency <n>      Recordings rendered in parallel (default 3, max 8)
  --min-aspect <ratio>   Skip examples whose viewport width/height is below this
  --max-aspect <ratio>   Skip examples whose viewport width/height is above this
  --app-url <url>        Deployed Analytics app (default ${DEFAULT_APP_URL}, or AGENT_NATIVE_ANALYTICS_URL)
  --token <bearer>       Bearer for that app (default AGENT_NATIVE_TOKEN, then Codex's config.toml)
  --upload               Store each PNG in the app's private storage and put an attachmentRef in the manifest (a frame that fails to upload is a failure, not a frame)
  --capture-mode <mode>  offline (default) or browser, which checks recorded assets through a bounded local network relay
  --extract-prompts      Browser mode only: save bounded visible user-role text locally; redact credentials and omit SQL/base64 payloads
  --timeout-ms <ms>      Per recording load / per frame limit (default 60000)
  --dry-run              Print the plan (recordings, offsets, viewports) and render nothing
  --help

Authenticate (nothing is read from a local database):
  npx -y @agent-native/core@latest connect ${DEFAULT_APP_URL} --client codex
This writes a bearer into ~/.codex/config.toml, which this command reads. For
another client, pass --token or set AGENT_NATIVE_TOKEN.

Needs Playwright with Chromium (npx playwright install chromium) and the local
@rrweb/replay package included by the Analytics workspace.

manifest.json: { generatedAt, appUrl, captureMode, frames: [{ nodeKey,
exampleIndex, recordingId, offsetMs, sourceEventAt, replayAt, width, height,
localPath, capturedAt, assetStatus, route?, attachmentRef? }], remoteAssets,
failures: [{ nodeKey, exampleIndex, recordingId, offsetMs, sourceEventAt,
replayAt, reason, assetStatus?, code?, diagnostics? }], skipped: [...],
promptProvenancePath?, promptProvenanceError? }.
Browser captures use the recording-scoped frame URL in an empty browser context.
Each recording loads once through the largest requested offset, then seeks all
requested offsets. Browser mode caps the manifest at 4 MiB, capture prefixes at
2,000 chunks, 100,000 events and 64 MiB of chunk data, and each chunk response
at 12 MiB. Assets that cannot
pass the frame's bounded same-origin/CORS preflight fail that frame explicitly.
Chromium uses a per-run loopback SOCKS tunnel that resolves and pins public
destinations, permits the exact app origin, and blocks WebSockets. Chromium
continues to handle TLS and CORS. Cross-origin requests are GET/HEAD only and
have authorization, proxy-authorization, and referrer headers removed; requests
carrying cookies are blocked, and Origin is preserved for CORS. The Analytics
bearer is sent only to app actions, never to recorded origins. Chromium's
resolver exception is restricted to the exact loopback SOCKS listener.
--extract-prompts writes only bounded, redacted user-role text to
prompt-provenance.json, omitting SQL and base64 payloads; that sidecar is
local-only and is never uploaded. It records screenshot/upload success or
failure alongside each observed prompt snapshot. If the sidecar cannot be
written, the manifest records promptProvenanceError and the run exits nonzero.
New output directories use mode 0700; existing directories must already be
private. Each output file uses mode 0600.
Exit code is 1 when no frame was captured or the requested provenance sidecar
could not be written; 2 when authentication is missing or rejected.`;

class AuthError extends Error {}

export interface BrowserPage {
  goto(url: string, options: Record<string, unknown>): Promise<unknown>;
  setContent(html: string, options?: Record<string, unknown>): Promise<void>;
  addScriptTag(options: Record<string, unknown>): Promise<unknown>;
  addStyleTag(options: Record<string, unknown>): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  screenshot(options: Record<string, unknown>): Promise<Uint8Array>;
  waitForFunction(
    fn: () => unknown,
    arg: unknown,
    options: Record<string, unknown>,
  ): Promise<unknown>;
  evaluate<T>(fn: (arg: any) => unknown, arg?: unknown): Promise<T>;
}
export interface BrowserRoute {
  request(): {
    url(): string;
    method(): string;
    allHeaders(): Promise<Record<string, string>>;
  };
  abort(): Promise<void>;
  continue(options?: {
    headers?: Record<string, string | undefined>;
  }): Promise<void>;
}
export interface BrowserWebSocketRoute {
  close(): void;
}
export interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  route(
    url: string,
    handler: (route: BrowserRoute) => Promise<void>,
  ): Promise<void>;
  unroute(
    url: string,
    handler: (route: BrowserRoute) => Promise<void>,
  ): Promise<void>;
  routeWebSocket(
    url: string,
    handler: (route: BrowserWebSocketRoute) => void,
  ): Promise<void>;
  clearCookies(): Promise<void>;
  close(): Promise<void>;
}
export interface Browser {
  newContext(options: Record<string, unknown>): Promise<BrowserContext>;
  close(): Promise<void>;
}

export interface ReplayNetworkPolicy {
  assertHealthy(): Promise<void>;
  close(): Promise<void>;
}

async function importChromium(): Promise<{
  launch(options: Record<string, unknown>): Promise<Browser>;
}> {
  for (const specifier of [
    "playwright",
    "playwright-core",
    "@playwright/test",
  ]) {
    try {
      const module = (await import(/* @vite-ignore */ specifier)) as {
        chromium?: any;
      };
      if (module.chromium) return module.chromium;
      // coercion-ok: a missing package is reported once, below, after every candidate has been tried.
    } catch {
      // Try the next package that ships the same API.
    }
  }
  throw new Error(
    "Playwright is not installed. From the agent-native checkout run `pnpm install`; elsewhere run `npm i -D playwright`. Then `npx playwright install chromium`.",
  );
}

function codexConfigPath(): string {
  const home = process.env.CODEX_HOME?.trim();
  return path.join(home || path.join(os.homedir(), ".codex"), "config.toml");
}

async function resolveToken(
  flag: string | undefined,
  appUrl: string,
): Promise<string | undefined> {
  const explicit = flag ?? process.env.AGENT_NATIVE_TOKEN;
  if (explicit?.trim()) return stripBearer(explicit);
  try {
    return codexBearerForApp(appUrl, await readFile(codexConfigPath(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function callAppAction(
  appUrl: string,
  token: string | undefined,
  action: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, any>> {
  const response = await requestAppResponse(
    `${appUrl}/_agent-native/actions/${action}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(input),
      timeoutMs: 60_000,
      maxBytes: MAX_APP_ACTION_RESPONSE_BYTES,
      signal,
    },
  );
  if (response.status === 401 || response.status === 403) {
    throw new AuthError(
      `${unauthenticatedMessage(appUrl)}\n(${action} answered HTTP ${response.status}; the token may be expired or for another app.)`,
    );
  }
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(response.bodyText);
  } catch {
    json = null;
  }
  if (response.status < 200 || response.status >= 300 || !json) {
    const detail =
      typeof json?.error === "string"
        ? json.error
        : typeof json?.message === "string"
          ? json.message
          : response.bodyText.slice(0, 200);
    throw new Error(`${action} failed (HTTP ${response.status}): ${detail}`);
  }
  return json.result && typeof json.result === "object" ? json.result : json;
}

export interface RunContext {
  appUrl: string;
  token: string | undefined;
  signal: AbortSignal;
  browser: Browser;
  outDir: string;
  timeoutMs: number;
  upload: boolean;
  captureMode: "offline" | "browser";
  extractPrompts: boolean;
  minAspect?: number;
  maxAspect?: number;
  usedNames: Set<string>;
  frames: ManifestFrame[];
  failures: ManifestFailure[];
  provenanceSnapshots: PromptProvenanceSnapshot[];
  provenanceFailures: PromptProvenanceFailure[];
  provenanceOmittedSnapshots: number;
  provenanceInFlight: number;
}

export interface PromptProvenanceSnapshot {
  nodeKey: string;
  exampleIndex: number;
  recordingId: string;
  treeSourceEventAt: string | null;
  observedSeek: {
    requestedOffsetMs: number;
    observedOffsetMs: number;
    playheadOffsetMs: number;
    observedAt: string;
  };
  captureOutcome: { status: "captured" } | { status: "failed"; reason: string };
  messages: ReturnType<typeof sanitizePromptProvenanceCandidates>["messages"];
  extractorTruncation: {
    truncatedMessages: boolean;
    truncatedCharacters: boolean;
  };
  truncation: ReturnType<
    typeof sanitizePromptProvenanceCandidates
  >["truncation"];
}

export interface PromptProvenanceFailure {
  nodeKey: string;
  exampleIndex: number;
  recordingId: string;
  treeSourceEventAt: string | null;
  requestedOffsetMs: number;
  observedAt: string;
  captureOutcome: { status: "captured" } | { status: "failed"; reason: string };
  reason: string;
}

const moduleRequire = createRequire(import.meta.url);
const MAX_CAPTURE_EVENTS = 100_000;
const MAX_CAPTURE_EVENT_BYTES = 64 * 1024 * 1024;
const MAX_CAPTURE_CHUNKS = 2_000;
const MAX_CAPTURE_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_CAPTURE_CHUNK_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_APP_ACTION_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_BROWSER_FRAME_BYTES = 24 * 1024 * 1024;
const MAX_PROMPT_PROVENANCE_SNAPSHOTS = 200;
const PROMPT_PROVENANCE_FILE = "prompt-provenance.json";

function reservePromptProvenanceSnapshot(ctx: RunContext): boolean {
  if (
    ctx.provenanceSnapshots.length +
      ctx.provenanceFailures.length +
      ctx.provenanceInFlight >=
    MAX_PROMPT_PROVENANCE_SNAPSHOTS
  ) {
    ctx.provenanceOmittedSnapshots += 1;
    return false;
  }
  ctx.provenanceInFlight += 1;
  return true;
}

function recordTimedOutPromptProvenance(
  ctx: RunContext,
  plan: RecordingPlan,
  item: RecordingPlan["items"][number],
  reason: string,
): void {
  if (!reservePromptProvenanceSnapshot(ctx)) return;
  ctx.provenanceFailures.push({
    nodeKey: item.nodeKey,
    exampleIndex: item.exampleIndex,
    recordingId: plan.recordingId,
    treeSourceEventAt: item.sourceEventAt,
    requestedOffsetMs: item.offsetMs,
    observedAt: new Date().toISOString(),
    captureOutcome: { status: "failed", reason },
    reason,
  });
  ctx.provenanceInFlight -= 1;
}

export async function preparePrivateOutputDirectory(
  outDir: string,
  base: string,
): Promise<void> {
  const resolved = path.resolve(outDir);
  const protectedPaths = new Set([
    path.parse(resolved).root,
    path.resolve(base),
    path.resolve(os.homedir()),
    path.resolve(os.tmpdir()),
  ]);
  if (
    [...protectedPaths].some(
      (protectedPath) =>
        protectedPath === resolved ||
        protectedPath.startsWith(`${resolved}${path.sep}`),
    )
  ) {
    throw new Error("output_directory_too_broad");
  }
  let metadata;
  try {
    metadata = await lstat(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(resolved, { recursive: true, mode: 0o700 });
    metadata = await lstat(resolved);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("output_directory_invalid");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("output_directory_permissions_unsafe");
  }
}

async function removePrivateOutputFile(filePath: string): Promise<void> {
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("output_file_invalid");
    }
    await rm(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function removeStaleRunMetadata(outDir: string): Promise<void> {
  await Promise.all([
    removePrivateOutputFile(path.join(outDir, "manifest.json")),
    removePrivateOutputFile(path.join(outDir, PROMPT_PROVENANCE_FILE)),
  ]);
}

async function writePrivateOutputFile(
  filePath: string,
  contents: string | Uint8Array,
): Promise<void> {
  try {
    const metadata = await lstat(filePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("output_file_invalid");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(filePath, contents, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

export async function writePromptProvenanceSidecar(
  outDir: string,
  generatedAt: string,
  snapshots: PromptProvenanceSnapshot[],
  failures: PromptProvenanceFailure[],
  omittedSnapshots: number,
  plannedSnapshots: number,
): Promise<string> {
  const filePath = path.join(outDir, PROMPT_PROVENANCE_FILE);
  await writePrivateOutputFile(
    filePath,
    JSON.stringify(
      {
        generatedAt,
        interpretation:
          "Visible user-role message text in the materialized replay DOM at the observed seek. It is not tied to an exact source event or attempt ID.",
        sourceEventTimestampField: "treeSourceEventAt",
        limits: {
          snapshots: MAX_PROMPT_PROVENANCE_SNAPSHOTS,
          messagesPerSnapshot: 12,
          charactersPerMessage: 2_000,
          charactersPerSnapshot: 8_000,
        },
        snapshots,
        failures,
        coverage: {
          plannedSnapshots,
          recordedSnapshots: snapshots.length,
          failedSnapshots: failures.length,
          omittedSnapshots,
          unrecordedSnapshots: Math.max(
            0,
            plannedSnapshots -
              snapshots.length -
              failures.length -
              omittedSnapshots,
          ),
        },
      },
      null,
      2,
    ) + "\n",
  );
  return filePath;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(
        typeof signal.reason === "string" ? signal.reason : "run_aborted",
      );
}

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export async function requestAppResponse(
  urlValue: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
    maxBytes: number;
    signal?: AbortSignal;
  },
): Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  bodyText: string;
}> {
  if (options.signal?.aborted) throw abortReason(options.signal);
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("app_request_url_invalid");
  }
  let request: ReturnType<typeof httpRequest> | undefined;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      request?.destroy();
      reject(new Error("app_request_timeout"));
    }, options.timeoutMs);
  });
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (!options.signal) return;
    onAbort = () => {
      request?.destroy();
      reject(abortReason(options.signal!));
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal.aborted) onAbort();
  });

  try {
    const response = (async () => {
      const pinnedAddresses = await resolvePinnedAddresses(url);
      if (timedOut) throw new Error("app_request_timeout");
      if (options.signal?.aborted) throw abortReason(options.signal);
      const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
      const pinnedLookup: NonNullable<RequestOptions["lookup"]> = (
        _hostname,
        lookupOptions,
        callback,
      ) => {
        if (lookupOptions.all) callback(null, pinnedAddresses);
        else {
          const [pinnedAddress] = pinnedAddresses;
          callback(null, pinnedAddress!.address, pinnedAddress!.family);
        }
      };

      return await new Promise<{
        status: number;
        headers: IncomingHttpHeaders;
        bodyText: string;
      }>((resolve, reject) => {
        const isHttps = url.protocol === "https:";
        const transportOptions: RequestOptions & {
          autoSelectFamily: boolean;
        } = {
          method: options.method ?? "GET",
          headers: {
            ...options.headers,
            "accept-encoding": "identity",
          },
          agent: isHttps
            ? new HttpsAgent({ keepAlive: false })
            : new HttpAgent({ keepAlive: false }),
          lookup: pinnedLookup,
          autoSelectFamily: true,
          ...(isHttps && isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0
            ? {
                servername: url.hostname.replace(/^\[|\]$/g, ""),
                rejectUnauthorized: true,
              }
            : {}),
        };
        request = transport(url, transportOptions, (response) => {
          const parts: Buffer[] = [];
          let byteLength = 0;
          response.on("error", () => {
            reject(
              byteLength > options.maxBytes
                ? new Error("app_response_too_large")
                : new Error("app_response_read_failed"),
            );
          });
          response.on("aborted", () =>
            reject(new Error("app_response_read_failed")),
          );
          response.on("close", () => {
            if (!response.complete) {
              reject(new Error("app_response_read_failed"));
            }
          });
          const declaredLength = Number(
            headerValue(response.headers, "content-length"),
          );
          if (
            Number.isFinite(declaredLength) &&
            declaredLength > options.maxBytes
          ) {
            reject(new Error("app_response_too_large"));
            response.destroy();
            return;
          }
          response.on("data", (part: Buffer | string) => {
            const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
            byteLength += bytes.byteLength;
            if (byteLength > options.maxBytes) {
              reject(new Error("app_response_too_large"));
              response.destroy();
              return;
            }
            parts.push(bytes);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              bodyText: Buffer.concat(parts, byteLength).toString("utf8"),
            });
          });
        });
        request.on("error", () =>
          reject(
            new Error(timedOut ? "app_request_timeout" : "app_request_failed"),
          ),
        );
        request.end(options.body);
      });
    })();
    return await Promise.race([response, timeout, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener("abort", onAbort);
  }
}

function localReplayAssets(): { scriptPath: string; stylePath: string } {
  const packageEntry = moduleRequire.resolve("@rrweb/replay");
  const packageDist = path.dirname(packageEntry);
  return {
    scriptPath: path.join(packageDist, "replay.umd.cjs"),
    stylePath: moduleRequire.resolve("@rrweb/replay/dist/style.css"),
  };
}

function tokenizedManifestUrl(
  contextUrl: string,
  appUrl: string,
  recordingId: string,
): string {
  let context: URL;
  try {
    context = new URL(contextUrl);
  } catch {
    throw new Error("replay_link_invalid");
  }
  const app = new URL(appUrl);
  const suffix = "/api/session-replay/agent-context.json";
  const expectedPath = `${app.pathname.replace(/\/+$/, "")}${suffix}`;
  const token = context.searchParams.get(SESSION_REPLAY_AGENT_ACCESS_PARAM);
  if (
    context.origin !== app.origin ||
    context.pathname !== expectedPath ||
    context.searchParams.get("id") !== recordingId ||
    !token ||
    context.searchParams.size !== 2
  ) {
    throw new Error("replay_link_invalid");
  }
  const basePath = app.pathname.replace(/\/+$/, "");
  const manifest = new URL(
    `${basePath}/api/session-replay/recordings/${encodeURIComponent(recordingId)}/manifest`,
    app.origin,
  );
  manifest.searchParams.set(SESSION_REPLAY_AGENT_ACCESS_PARAM, token);
  return manifest.toString();
}

function safeChunkUrl(
  bytesPath: unknown,
  appUrl: string,
  recordingId: string,
  seq: number,
  accessToken: string,
): string {
  if (typeof bytesPath !== "string") throw new Error("replay_manifest_invalid");
  const app = new URL(appUrl);
  let chunkUrl: URL;
  try {
    chunkUrl = new URL(bytesPath, appUrl);
  } catch {
    throw new Error("replay_manifest_invalid");
  }
  const basePath = app.pathname.replace(/\/+$/, "");
  if (
    basePath &&
    chunkUrl.origin === app.origin &&
    chunkUrl.pathname.startsWith("/api/session-replay/recordings/")
  ) {
    chunkUrl.pathname = `${basePath}${chunkUrl.pathname}`;
  }
  const expectedPath = `${basePath}/api/session-replay/recordings/${encodeURIComponent(recordingId)}/chunks/${encodeURIComponent(String(seq))}`;
  if (
    chunkUrl.origin !== app.origin ||
    chunkUrl.pathname !== expectedPath ||
    chunkUrl.searchParams.get(SESSION_REPLAY_AGENT_ACCESS_PARAM) !==
      accessToken ||
    chunkUrl.searchParams.size !== 1
  ) {
    throw new Error("replay_manifest_invalid");
  }
  return chunkUrl.toString();
}

async function fetchReplayJson(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<{ data: unknown; headers: IncomingHttpHeaders; bodyText: string }> {
  const response = await requestAppResponse(url, {
    headers: { accept: "application/json" },
    timeoutMs,
    maxBytes,
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    throw new AuthError("The recording-scoped replay link was rejected.");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`replay_http_${response.status}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(response.bodyText);
  } catch {
    throw new Error("replay_response_invalid");
  }
  return { data, headers: response.headers, bodyText: response.bodyText };
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function eventsFromChunkText(value: unknown): unknown[] {
  if (typeof value !== "string") throw new Error("replay_chunk_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("replay_chunk_invalid");
  }
  if (Array.isArray(parsed)) return parsed;
  const payload = record(parsed);
  if (Array.isArray(payload?.events)) return payload.events;
  throw new Error("replay_chunk_invalid");
}

export async function loadReplayEvents(
  contextUrl: string,
  appUrl: string,
  recordingId: string,
  maxRecordingOffsetMs: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ events: AnyReplayEvent[]; recordingStartedAtMs: number }> {
  const manifestUrl = tokenizedManifestUrl(contextUrl, appUrl, recordingId);
  const accessToken = new URL(contextUrl).searchParams.get(
    SESSION_REPLAY_AGENT_ACCESS_PARAM,
  );
  if (!accessToken) throw new Error("replay_link_invalid");
  const manifestResponse = await fetchReplayJson(
    manifestUrl,
    timeoutMs,
    MAX_CAPTURE_MANIFEST_BYTES,
    signal,
  );
  const manifest = record(manifestResponse.data);
  const recording = record(manifest?.recording);
  const chunks = manifest?.chunks;
  if (
    recording?.id !== recordingId ||
    !Array.isArray(chunks) ||
    chunks.length === 0 ||
    chunks.length > MAX_CAPTURE_CHUNKS ||
    !Number.isSafeInteger(recording.eventCount) ||
    recording.eventCount < 0 ||
    !Number.isSafeInteger(recording.totalBytes) ||
    recording.totalBytes < 0 ||
    recording.chunkCount !== chunks.length ||
    typeof recording.startedAt !== "string"
  ) {
    throw new Error("replay_manifest_invalid");
  }
  const recordingStartedAtMs = Date.parse(recording.startedAt);
  if (!Number.isSafeInteger(recordingStartedAtMs)) {
    throw new Error("replay_manifest_invalid");
  }

  let declaredEvents = 0;
  let declaredBytes = 0;
  for (const [index, value] of chunks.entries()) {
    const chunk = record(value);
    if (
      !chunk ||
      !Number.isSafeInteger(chunk.seq) ||
      chunk.seq < 0 ||
      !Number.isSafeInteger(chunk.eventCount) ||
      chunk.eventCount < 0 ||
      !Number.isSafeInteger(chunk.byteLength) ||
      chunk.byteLength <= 0 ||
      typeof chunk.checksum !== "string" ||
      !chunk.checksum
    ) {
      throw new Error("replay_manifest_invalid");
    }
    if (chunk.seq !== index) {
      throw new Error("replay_manifest_incomplete");
    }
    declaredEvents += chunk.eventCount;
    declaredBytes += chunk.byteLength;
  }
  if (
    !Number.isSafeInteger(declaredEvents) ||
    !Number.isSafeInteger(declaredBytes) ||
    declaredEvents !== recording.eventCount ||
    declaredBytes !== recording.totalBytes
  ) {
    throw new Error("replay_manifest_incomplete");
  }

  if (!Number.isFinite(maxRecordingOffsetMs) || maxRecordingOffsetMs < 0) {
    throw new Error("replay_offset_invalid");
  }
  const targetTimestamp = recordingStartedAtMs + maxRecordingOffsetMs;
  if (!Number.isFinite(targetTimestamp)) {
    throw new Error("replay_offset_invalid");
  }

  const events: AnyReplayEvent[] = [];
  let actualBytes = 0;
  let declaredPrefixEvents = 0;
  let declaredPrefixBytes = 0;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const value of chunks) {
    const chunk = record(value)!;
    if (
      declaredPrefixEvents + chunk.eventCount > MAX_CAPTURE_EVENTS ||
      declaredPrefixBytes + chunk.byteLength > MAX_CAPTURE_EVENT_BYTES
    ) {
      throw new Error("replay_prefix_too_large");
    }
    if (chunk.byteLength > MAX_CAPTURE_CHUNK_RESPONSE_BYTES) {
      throw new Error("replay_chunk_too_large");
    }
    declaredPrefixEvents += chunk.eventCount;
    declaredPrefixBytes += chunk.byteLength;

    const chunkUrl = safeChunkUrl(
      chunk.bytesPath,
      appUrl,
      recordingId,
      chunk.seq,
      accessToken,
    );
    const remainingBytes = MAX_CAPTURE_EVENT_BYTES - actualBytes;
    const chunkResponseLimit = Math.min(
      MAX_CAPTURE_CHUNK_RESPONSE_BYTES,
      remainingBytes,
    );
    let chunkResponse: Awaited<ReturnType<typeof fetchReplayJson>>;
    try {
      chunkResponse = await fetchReplayJson(
        chunkUrl,
        timeoutMs,
        chunkResponseLimit,
        signal,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "app_response_too_large"
      ) {
        throw new Error(
          remainingBytes < MAX_CAPTURE_CHUNK_RESPONSE_BYTES
            ? "replay_prefix_too_large"
            : "replay_chunk_too_large",
        );
      }
      throw error;
    }
    if (
      headerValue(chunkResponse.headers, "x-session-replay-seq") !==
        String(chunk.seq) ||
      headerValue(chunkResponse.headers, "x-session-replay-checksum") !==
        chunk.checksum
    ) {
      throw new Error("replay_chunk_incomplete");
    }
    const chunkPayload = record(chunkResponse.data);
    const eventText =
      typeof chunkPayload?.json === "string"
        ? chunkPayload.json
        : typeof chunkResponse.data === "string"
          ? chunkResponse.data
          : Array.isArray(chunkResponse.data) ||
              Array.isArray(chunkPayload?.events)
            ? chunkResponse.bodyText
            : undefined;
    if (typeof eventText !== "string") {
      throw new Error("replay_chunk_invalid");
    }
    if (
      !/^[\da-f]{64}$/i.test(chunk.checksum) ||
      createHash("sha256").update(eventText, "utf8").digest("hex") !==
        chunk.checksum.toLowerCase()
    ) {
      throw new Error("replay_chunk_checksum_mismatch");
    }
    const byteLength = Buffer.byteLength(eventText, "utf8");
    if (byteLength !== chunk.byteLength) {
      throw new Error("replay_chunk_incomplete");
    }
    const chunkEvents = eventsFromChunkText(eventText);
    if (chunkEvents.length !== chunk.eventCount) {
      throw new Error("replay_chunk_incomplete");
    }
    actualBytes += byteLength;
    if (actualBytes > MAX_CAPTURE_EVENT_BYTES) {
      throw new Error("replay_prefix_too_large");
    }
    for (const value of chunkEvents) {
      const event = record(value);
      if (
        !event ||
        typeof event.timestamp !== "number" ||
        !Number.isFinite(event.timestamp) ||
        !Number.isInteger(event.type) ||
        event.timestamp < previousTimestamp
      ) {
        throw new Error("replay_event_invalid");
      }
      previousTimestamp = event.timestamp;
      events.push(event);
      if (events.length > MAX_CAPTURE_EVENTS) {
        throw new Error("replay_prefix_too_large");
      }
    }
    if (previousTimestamp > targetTimestamp) {
      break;
    }
  }
  const normalized = normalizeReplayEvents(events);
  if (normalized.length !== events.length)
    throw new Error("replay_event_invalid");
  if (replayAvailabilityErrorKey(normalized)) {
    throw new Error("replay_unavailable");
  }
  return { events: normalized, recordingStartedAtMs };
}

function browserFailureReason(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    (error as { name?: unknown }).name === "ReplayScreenshotAssetError"
  ) {
    return "assets_not_capturable";
  }
  return reasonFromError(error);
}

type BrowserFrameCapture = {
  offsetMs: number;
  playheadOffsetMs: number;
  width: number;
  height: number;
  route: string;
  capturedAt: string;
  png: string;
};

type BrowserFrameCaptureReply =
  | { ok: true; value: BrowserFrameCapture }
  | { ok: false; reason: string };

type BrowserPromptReply =
  | {
      ok: true;
      value: {
        observedOffsetMs: number;
        playheadOffsetMs: number;
        observedAt: string;
        messages: unknown[];
        truncatedMessages: boolean;
        truncatedCharacters: boolean;
      };
    }
  | { ok: false; reason: string };

export async function installReplayNetworkPolicy(
  context: BrowserContext,
  appUrl: string,
  signal: AbortSignal,
  checkRequest: typeof isReplayRequestAllowed = isReplayRequestAllowed,
): Promise<ReplayNetworkPolicy> {
  const inFlight = new Set<Promise<void>>();
  let policyError: unknown;
  const appOrigin = new URL(appUrl).origin;
  const allowedCrossOriginHeaders = new Set([
    "accept",
    "accept-encoding",
    "accept-language",
    "cache-control",
    "if-modified-since",
    "if-none-match",
    "origin",
    "pragma",
    "range",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "user-agent",
  ]);
  const routeHandler = async (route: BrowserRoute) => {
    const work = (async () => {
      const request = route.request();
      const requestUrl = request.url();
      if (signal.aborted || !(await checkRequest(requestUrl, appUrl))) {
        await route.abort();
        return;
      }
      if (new URL(requestUrl).origin !== appOrigin) {
        if (!["GET", "HEAD"].includes(request.method().toUpperCase())) {
          await route.abort();
          return;
        }
        const originalHeaders = await request.allHeaders();
        if (originalHeaders.cookie || originalHeaders.cookie2) {
          await route.abort();
          return;
        }
        const headers = Object.fromEntries(
          Object.entries(originalHeaders).filter(([name]) =>
            allowedCrossOriginHeaders.has(name.toLowerCase()),
          ),
        );
        await route.continue({ headers });
        return;
      }
      await route.continue();
    })();
    inFlight.add(work);
    try {
      await work;
    } catch (error) {
      if (!isReplayDnsLookupFailure(error)) policyError ??= error;
      await route.abort().catch(() => undefined);
    } finally {
      inFlight.delete(work);
    }
  };
  try {
    await context.route("**/*", routeHandler);
    await context.routeWebSocket("**/*", (websocket) => websocket.close());
  } catch (error) {
    await context.unroute("**/*", routeHandler);
    throw error;
  }

  return {
    async assertHealthy() {
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
      if (policyError) {
        throw new Error(
          `browser_network_policy_failed: ${reasonFromError(policyError)}`,
        );
      }
    },
    async close() {
      await context.unroute("**/*", routeHandler);
    },
  };
}

export async function captureBrowserRecording(
  ctx: RunContext,
  plan: RecordingPlan,
  pageUrl: string,
): Promise<void> {
  const failureFor = (
    item: RecordingPlan["items"][number],
    reason: string,
    recordingStartedAtMs?: number,
    assetStatus?: ManifestFailure["assetStatus"],
  ): ManifestFailure => ({
    nodeKey: item.nodeKey,
    exampleIndex: item.exampleIndex,
    recordingId: plan.recordingId,
    offsetMs: item.offsetMs,
    reason,
    sourceEventAt: item.sourceEventAt,
    replayAt:
      recordingStartedAtMs === undefined
        ? null
        : replayAtFromRecordingStart(recordingStartedAtMs, item.offsetMs),
    ...(assetStatus ? { assetStatus } : {}),
  });
  const failAll = (reason: string, recordingStartedAtMs?: number) => {
    for (const item of plan.items) {
      ctx.failures.push(failureFor(item, reason, recordingStartedAtMs));
    }
  };

  let context: BrowserContext;
  try {
    context = await ctx.browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      storageState: { cookies: [], origins: [] },
    });
  } catch (error) {
    if (ctx.signal.aborted) throw abortReason(ctx.signal);
    failAll(`browser_context_failed: ${reasonFromError(error)}`);
    return;
  }

  let page: BrowserPage | undefined;
  let networkPolicy: ReplayNetworkPolicy | undefined;
  let recordingStartedAtMs: number | undefined;
  try {
    page = await context.newPage();
    networkPolicy = await installReplayNetworkPolicy(
      context,
      ctx.appUrl,
      ctx.signal,
    );
    await withTimeout(
      page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: ctx.timeoutMs,
      }),
      ctx.timeoutMs,
    );
    await withTimeout(
      page.waitForFunction(
        () => {
          const state = (window as any).__anReplayFrame;
          return state?.status === "ready" || state?.status === "error";
        },
        null,
        { timeout: ctx.timeoutMs },
      ),
      ctx.timeoutMs,
    );
    const ready = await page.evaluate<
      | { status: "ready"; recordingStartedAt: string }
      | { status: "error"; reason: string }
      | { status: "loading" }
    >(() => {
      const state = (window as any).__anReplayFrame;
      if (state?.status === "error") {
        return { status: "error", reason: state.reason };
      }
      if (state?.status === "ready") {
        return {
          status: "ready",
          recordingStartedAt: state.recordingStartedAt,
        };
      }
      return { status: "loading" };
    });
    await networkPolicy.assertHealthy();
    if (ready.status === "error") {
      failAll(`browser_replay_failed: ${reasonFromError(ready.reason)}`);
      return;
    }
    if (ready.status !== "ready") {
      failAll("browser_replay_not_ready");
      return;
    }
    recordingStartedAtMs = Date.parse(ready.recordingStartedAt);
    if (!Number.isSafeInteger(recordingStartedAtMs)) {
      failAll("replay_start_time_unavailable");
      return;
    }
    await context.clearCookies();

    for (let itemIndex = 0; itemIndex < plan.items.length; itemIndex += 1) {
      const item = plan.items[itemIndex]!;
      let captureFailureReason: string | undefined;
      let terminalCaptureFailure: string | undefined;
      const itemFailure = (reason: string, assetFailed = false) => {
        captureFailureReason ??= reason;
        ctx.failures.push(
          failureFor(
            item,
            reason,
            recordingStartedAtMs,
            assetFailed ? "preflight_failed" : undefined,
          ),
        );
      };
      let capture: BrowserFrameCapture | undefined;
      try {
        const reply = await withTimeout(
          page.evaluate<BrowserFrameCaptureReply>(async (offsetMs) => {
            const state = (window as any).__anReplayFrame;
            if (state?.status !== "ready") {
              return { ok: false, reason: "replay_frame_not_ready" };
            }
            try {
              return { ok: true, value: await state.capture(offsetMs) };
            } catch (error) {
              if (
                error &&
                typeof error === "object" &&
                (error as { name?: unknown }).name ===
                  "ReplayScreenshotAssetError"
              ) {
                return { ok: false, reason: "assets_not_capturable" };
              }
              const message =
                error instanceof Error ? error.message : String(error);
              return {
                ok: false,
                reason: message
                  .split("\n")[0]!
                  .replace(
                    /(https?:\/\/[^\s"'?#]*)\?[^\s"'#]*/gi,
                    "$1?[redacted]",
                  )
                  .slice(0, 200),
              };
            }
          }, item.offsetMs),
          ctx.timeoutMs,
        );
        await networkPolicy.assertHealthy();
        if (!reply.ok) {
          itemFailure(reply.reason, reply.reason === "assets_not_capturable");
        } else {
          capture = reply.value;
          if (
            capture.offsetMs !== item.offsetMs ||
            !Number.isFinite(capture.playheadOffsetMs) ||
            !isScreenshotSize(capture.width, capture.height) ||
            !aspectInRange(capture.width, capture.height, ctx) ||
            typeof capture.capturedAt !== "string" ||
            !Number.isFinite(Date.parse(capture.capturedAt)) ||
            typeof capture.png !== "string" ||
            capture.png.length > Math.ceil((MAX_BROWSER_FRAME_BYTES * 4) / 3) ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
              capture.png,
            )
          ) {
            itemFailure("screenshot_invalid");
          } else {
            const bytes = Buffer.from(capture.png, "base64");
            const pngSize = pngDimensions(bytes);
            if (
              bytes.byteLength > MAX_BROWSER_FRAME_BYTES ||
              bytes.toString("base64") !== capture.png ||
              !pngSize ||
              pngSize.width !== capture.width ||
              pngSize.height !== capture.height
            ) {
              itemFailure("screenshot_invalid");
            } else {
              const fileName = frameFileName(
                item.nodeKey,
                item.exampleIndex,
                ctx.usedNames,
              );
              const filePath = path.join(ctx.outDir, fileName);
              await writePrivateOutputFile(filePath, bytes);
              let attachmentRef: string | undefined;
              if (ctx.upload) {
                try {
                  const uploaded = await callAppAction(
                    ctx.appUrl,
                    ctx.token,
                    "upload-journey-frame",
                    {
                      recordingId: plan.recordingId,
                      offsetMs: item.offsetMs,
                      png: capture.png,
                    },
                    ctx.signal,
                  );
                  if (typeof uploaded.attachmentRef !== "string") {
                    throw new Error("the app returned no attachmentRef");
                  }
                  attachmentRef = uploaded.attachmentRef;
                } catch (error) {
                  await removePrivateOutputFile(filePath);
                  if (error instanceof AuthError) throw error;
                  if (ctx.signal.aborted) throw abortReason(ctx.signal);
                  itemFailure(`upload_failed: ${reasonFromError(error)}`);
                }
              }
              if (!captureFailureReason) {
                ctx.frames.push({
                  nodeKey: item.nodeKey,
                  exampleIndex: item.exampleIndex,
                  recordingId: plan.recordingId,
                  offsetMs: item.offsetMs,
                  width: capture.width,
                  height: capture.height,
                  localPath: fileName,
                  capturedAt: capture.capturedAt,
                  assetStatus: "preflighted",
                  sourceEventAt: item.sourceEventAt,
                  replayAt: replayAtFromRecordingStart(
                    recordingStartedAtMs,
                    item.offsetMs,
                  ),
                  ...(normalizeJourneyPath(capture.route)
                    ? { route: normalizeJourneyPath(capture.route)! }
                    : {}),
                  ...(attachmentRef ? { attachmentRef } : {}),
                });
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof AuthError) throw error;
        if (ctx.signal.aborted) throw abortReason(ctx.signal);
        const reason = browserFailureReason(error);
        itemFailure(reason);
        if (error instanceof CaptureTimeout) terminalCaptureFailure = reason;
      }

      if (terminalCaptureFailure) {
        const remainingReason =
          "capture_timeout: an earlier frame did not finish";
        for (const later of plan.items.slice(itemIndex + 1)) {
          ctx.failures.push(
            failureFor(later, remainingReason, recordingStartedAtMs),
          );
        }
        if (ctx.extractPrompts) {
          recordTimedOutPromptProvenance(
            ctx,
            plan,
            item,
            terminalCaptureFailure,
          );
          for (const later of plan.items.slice(itemIndex + 1)) {
            recordTimedOutPromptProvenance(ctx, plan, later, remainingReason);
          }
        }
        break;
      }

      if (ctx.extractPrompts) {
        if (!reservePromptProvenanceSnapshot(ctx)) continue;
        const observedAt = new Date().toISOString();
        let extractionTimedOut = false;
        try {
          const reply = await withTimeout(
            page.evaluate<BrowserPromptReply>(async (offsetMs) => {
              const state = (window as any).__anReplayFrame;
              if (state?.status !== "ready") {
                return { ok: false, reason: "replay_frame_not_ready" };
              }
              try {
                return {
                  ok: true,
                  value: await state.extractUserMessages(offsetMs),
                };
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                return {
                  ok: false,
                  reason: message
                    .split("\n")[0]!
                    .replace(
                      /(https?:\/\/[^\s"'?#]*)\?[^\s"'#]*/gi,
                      "$1?[redacted]",
                    )
                    .slice(0, 200),
                };
              }
            }, item.offsetMs),
            ctx.timeoutMs,
          );
          await networkPolicy.assertHealthy();
          if (!reply.ok) throw new Error(reply.reason);
          const sanitized = sanitizePromptProvenanceCandidates(
            reply.value.messages,
          );
          ctx.provenanceSnapshots.push({
            nodeKey: item.nodeKey,
            exampleIndex: item.exampleIndex,
            recordingId: plan.recordingId,
            treeSourceEventAt: item.sourceEventAt,
            observedSeek: {
              requestedOffsetMs: item.offsetMs,
              observedOffsetMs: reply.value.observedOffsetMs,
              playheadOffsetMs: reply.value.playheadOffsetMs,
              observedAt: reply.value.observedAt,
            },
            captureOutcome: captureFailureReason
              ? { status: "failed", reason: captureFailureReason }
              : { status: "captured" },
            messages: sanitized.messages,
            extractorTruncation: {
              truncatedMessages: reply.value.truncatedMessages,
              truncatedCharacters: reply.value.truncatedCharacters,
            },
            truncation: sanitized.truncation,
          });
        } catch (error) {
          ctx.provenanceFailures.push({
            nodeKey: item.nodeKey,
            exampleIndex: item.exampleIndex,
            recordingId: plan.recordingId,
            treeSourceEventAt: item.sourceEventAt,
            requestedOffsetMs: item.offsetMs,
            observedAt,
            captureOutcome: captureFailureReason
              ? { status: "failed", reason: captureFailureReason }
              : { status: "captured" },
            reason: browserFailureReason(error),
          });
          if (ctx.signal.aborted) throw abortReason(ctx.signal);
          extractionTimedOut = error instanceof CaptureTimeout;
        } finally {
          ctx.provenanceInFlight -= 1;
        }
        if (extractionTimedOut) {
          const remainingReason =
            "capture_timeout: an earlier frame did not finish";
          for (const later of plan.items.slice(itemIndex + 1)) {
            ctx.failures.push(
              failureFor(later, remainingReason, recordingStartedAtMs),
            );
            recordTimedOutPromptProvenance(ctx, plan, later, remainingReason);
          }
          break;
        }
      }
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (ctx.signal.aborted) throw abortReason(ctx.signal);
    failAll(
      `browser_capture_failed: ${reasonFromError(error)}`,
      recordingStartedAtMs,
    );
  } finally {
    try {
      await networkPolicy?.close();
    } finally {
      await context.close();
    }
  }
}

async function renderRecording(ctx: RunContext, plan: RecordingPlan) {
  const failureFor = (
    item: RecordingPlan["items"][number],
    reason: string,
    recordingStartedAtMs?: number,
    extra: Pick<ManifestFailure, "code" | "diagnostics"> = {},
  ): ManifestFailure => ({
    nodeKey: item.nodeKey,
    exampleIndex: item.exampleIndex,
    recordingId: plan.recordingId,
    offsetMs: item.offsetMs,
    reason,
    sourceEventAt: item.sourceEventAt,
    replayAt:
      recordingStartedAtMs === undefined
        ? null
        : replayAtFromRecordingStart(recordingStartedAtMs, item.offsetMs),
    ...extra,
  });
  const failAll = (reason: string, recordingStartedAtMs?: number) => {
    for (const item of plan.items) {
      ctx.failures.push(failureFor(item, reason, recordingStartedAtMs));
    }
  };

  let contextUrl: string | undefined;
  let frameUrl: string | undefined;
  try {
    const link = await callAppAction(
      ctx.appUrl,
      ctx.token,
      "create-session-replay-agent-link",
      { recordingId: plan.recordingId },
      ctx.signal,
    );
    if (ctx.captureMode === "browser") {
      if (typeof link.url !== "string") {
        throw new Error("the app returned no replay page link");
      }
      frameUrl = replayFrameUrlFromAgentLink(
        link.url,
        ctx.appUrl,
        plan.recordingId,
        plan.items.reduce(
          (maxOffset, item) => Math.max(maxOffset, item.offsetMs),
          0,
        ),
      );
    } else {
      if (
        typeof link.contextUrl !== "string" ||
        !URL.canParse(link.contextUrl)
      ) {
        throw new Error("the app returned no replay API link");
      }
      contextUrl = link.contextUrl;
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (ctx.signal.aborted) throw abortReason(ctx.signal);
    return failAll(`link_failed: ${reasonFromError(error)}`);
  }

  if (ctx.captureMode === "browser") {
    if (!frameUrl) return failAll("replay_link_invalid");
    await captureBrowserRecording(ctx, plan, frameUrl);
    return;
  }
  if (!contextUrl) return failAll("replay_link_invalid");

  let replay: Awaited<ReturnType<typeof loadReplayEvents>>;
  try {
    const maxRecordingOffsetMs = plan.items.reduce(
      (maxOffset, item) => Math.max(maxOffset, item.offsetMs),
      0,
    );
    replay = await loadReplayEvents(
      contextUrl,
      ctx.appUrl,
      plan.recordingId,
      maxRecordingOffsetMs,
      ctx.timeoutMs,
      ctx.signal,
    );
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (ctx.signal.aborted) throw abortReason(ctx.signal);
    return failAll(`replay_load_failed: ${reasonFromError(error)}`);
  }
  const { events, recordingStartedAtMs } = replay;
  const initial = replayInitialViewportDimensions(events);
  const timeline = buildReplayViewportTimeline(events);
  if (!initial || timeline.length === 0) {
    return failAll("replay_viewport_unavailable", recordingStartedAtMs);
  }
  if (
    !timeline.every((change) => isScreenshotSize(change.width, change.height))
  ) {
    return failAll("viewport_out_of_range", recordingStartedAtMs);
  }

  let assets: { scriptPath: string; stylePath: string };
  try {
    assets = localReplayAssets();
  } catch {
    return failAll("replay_renderer_unavailable", recordingStartedAtMs);
  }
  let context: BrowserContext;
  try {
    context = await ctx.browser.newContext({
      viewport: { width: initial.width, height: initial.height },
      deviceScaleFactor: 1,
      acceptDownloads: false,
      // Recorded DOM can name arbitrary hosts, so its renderer stays offline.
      offline: true,
      serviceWorkers: "block",
    });
  } catch (error) {
    if (ctx.signal.aborted) throw abortReason(ctx.signal);
    return failAll(
      `render_failed: ${reasonFromError(error)}`,
      recordingStartedAtMs,
    );
  }
  let page: BrowserPage | undefined;
  try {
    page = await context.newPage();
    await page.setContent(
      '<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body><div id="stage"><div id="stage-root" class="an-replay-stage-root"></div></div></body></html>',
      { waitUntil: "domcontentloaded", timeout: ctx.timeoutMs },
    );
    await page.addStyleTag({ path: assets.stylePath });
    await page.addScriptTag({ path: assets.scriptPath });
    const replayInfo = await withTimeout(
      page.evaluate<{ totalTimeMs: number }>(
        async ({ events, initial }) => {
          const stage = document.getElementById("stage");
          const root = document.getElementById("stage-root");
          const Replayer = (window as any).rrwebReplay?.Replayer;
          if (!stage || !root || !Replayer) {
            throw new Error("replay_renderer_unavailable");
          }
          document.documentElement.style.margin = "0";
          document.documentElement.style.overflow = "hidden";
          document.body.style.margin = "0";
          document.body.style.overflow = "hidden";
          stage.style.position = "fixed";
          stage.style.left = "0";
          stage.style.top = "0";
          root.style.position = "relative";
          root.style.overflow = "hidden";
          root.style.width = `${initial.width}px`;
          root.style.height = `${initial.height}px`;
          root.style.setProperty("--an-replay-cursor-scale", "1");
          const replayer = new Replayer(events, {
            root,
            speed: 1,
            skipInactive: false,
            showWarning: false,
            showDebug: false,
            mouseTail: false,
            triggerFocus: true,
            insertStyleRules: [],
          });
          replayer.iframe?.setAttribute?.("referrerpolicy", "no-referrer");
          const totalTimeMs = Number(replayer.getMetaData?.().totalTime ?? 0);
          try {
            replayer.play?.(0);
          } catch {
            replayer.pause?.(0);
          }
          replayer.pause?.(0);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          (window as any).__anJourneyCapture = { replayer, totalTimeMs };
          return { totalTimeMs };
        },
        { events, initial },
      ),
      ctx.timeoutMs,
    );
    if (!Number.isFinite(replayInfo.totalTimeMs)) {
      return failAll("replay_duration_unavailable", recordingStartedAtMs);
    }

    for (const [index, item] of plan.items.entries()) {
      const fail = (
        reason: string,
        extra: Pick<ManifestFailure, "code" | "diagnostics"> = {},
      ) =>
        ctx.failures.push(
          failureFor(item, reason, recordingStartedAtMs, extra),
        );
      try {
        const offsetResolution = resolveReplayOffsetFromRecordingStart(
          events,
          recordingStartedAtMs,
          item.offsetMs,
        );
        if (!offsetResolution) {
          fail("replay_offset_invalid");
          continue;
        }
        if (offsetResolution.range === "before") {
          fail("offset_before_replay_start");
          continue;
        }
        if (offsetResolution.range === "after") {
          fail("offset_out_of_range");
          continue;
        }
        const { playheadOffsetMs } = offsetResolution;
        if (playheadOffsetMs > replayInfo.totalTimeMs) {
          fail("offset_out_of_range");
          continue;
        }
        const dimensions = replayViewportDimensionsAtTime(
          timeline,
          playheadOffsetMs,
        );
        if (
          !dimensions ||
          !isScreenshotSize(dimensions.width, dimensions.height)
        ) {
          fail("viewport_unavailable");
          continue;
        }
        if (!aspectInRange(dimensions.width, dimensions.height, ctx)) {
          fail("aspect_out_of_range");
          continue;
        }
        await page.setViewportSize(dimensions);
        await withTimeout(
          page.evaluate(
            async ({ playheadOffsetMs, dimensions }) => {
              const state = (window as any).__anJourneyCapture;
              const stage = document.getElementById("stage");
              const root = document.getElementById("stage-root");
              if (!state || !stage || !root) {
                throw new Error("replay_stage_unavailable");
              }
              state.replayer.pause(playheadOffsetMs);
              state.replayer.handleResize?.(dimensions);
              stage.style.width = `${dimensions.width}px`;
              stage.style.height = `${dimensions.height}px`;
              root.style.width = `${dimensions.width}px`;
              root.style.height = `${dimensions.height}px`;
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              );
              const iframe = state.replayer.iframe as
                | HTMLIFrameElement
                | undefined;
              const replayDocument = iframe?.contentDocument;
              if (!iframe || !replayDocument) {
                throw new Error("replay_frame_missing");
              }
              await replayDocument.fonts?.ready;
              await Promise.all(
                Array.from(replayDocument.images, (image) =>
                  image.decode().catch(() => undefined),
                ),
              );
            },
            { playheadOffsetMs, dimensions },
          ),
          ctx.timeoutMs,
        );
        const recordedIframeParentIds = replayIframeParentIdsAt(
          events,
          recordingStartedAtMs + item.offsetMs,
        );
        const iframeAudit = await withTimeout(
          page.evaluate<ReplayIframeAudit>(auditReplayIframeContent, {
            dimensions,
            recordedIframeParentIds: [...recordedIframeParentIds],
          }),
          ctx.timeoutMs,
        );
        if ((iframeAudit.unverifiableIframeCount ?? 0) > 0) {
          fail(
            "Iframe visibility could not be verified because projection, clipping, masks, or filters could hide it.",
            {
              code: "replay_iframe_visibility_unverifiable",
              diagnostics: iframeAudit,
            },
          );
          continue;
        }
        if (iframeAudit.unavailableIframeCount > 0) {
          fail("Visible iframe content is missing from the recorded replay.", {
            code: "replay_iframe_content_unavailable",
            diagnostics: iframeAudit,
          });
          continue;
        }
        const bytes = Buffer.from(
          await withTimeout(
            page.screenshot({
              type: "png",
              scale: "css",
              clip: {
                x: 0,
                y: 0,
                width: dimensions.width,
                height: dimensions.height,
              },
              animations: "disabled",
            }),
            ctx.timeoutMs,
          ),
        );
        const pngSize = pngDimensions(bytes);
        if (
          !pngSize ||
          pngSize.width !== dimensions.width ||
          pngSize.height !== dimensions.height
        ) {
          fail("screenshot_invalid");
          continue;
        }
        const capturedAt = new Date().toISOString();
        const route = normalizeJourneyPath(
          replayRouteAtOffset(events, playheadOffsetMs),
        );
        const capturedPng = bytes.toString("base64");
        // The file is written before the upload, so a disk failure cannot
        // leave a stored private frame nobody holds a ref to. With --upload a
        // frame without its attachmentRef is a failure, not a frame: its file
        // is removed again and it is not listed.
        const fileName = frameFileName(
          item.nodeKey,
          item.exampleIndex,
          ctx.usedNames,
        );
        const filePath = path.join(ctx.outDir, fileName);
        await writePrivateOutputFile(filePath, bytes);
        let attachmentRef: string | undefined;
        if (ctx.upload) {
          try {
            const uploaded = await callAppAction(
              ctx.appUrl,
              ctx.token,
              "upload-journey-frame",
              {
                recordingId: plan.recordingId,
                offsetMs: item.offsetMs,
                png: capturedPng,
              },
              ctx.signal,
            );
            if (typeof uploaded.attachmentRef !== "string") {
              throw new Error("the app returned no attachmentRef");
            }
            attachmentRef = uploaded.attachmentRef;
          } catch (error) {
            await rm(filePath, { force: true });
            if (error instanceof AuthError) throw error;
            if (ctx.signal.aborted) throw abortReason(ctx.signal);
            fail(`upload_failed: ${reasonFromError(error)}`);
            continue;
          }
        }
        ctx.frames.push({
          nodeKey: item.nodeKey,
          exampleIndex: item.exampleIndex,
          recordingId: plan.recordingId,
          offsetMs: item.offsetMs,
          width: dimensions.width,
          height: dimensions.height,
          localPath: fileName,
          capturedAt,
          assetStatus: "not_fetched",
          sourceEventAt: item.sourceEventAt,
          replayAt: replayAtFromRecordingStart(
            recordingStartedAtMs,
            item.offsetMs,
          ),
          ...(route ? { route } : {}),
          ...(attachmentRef ? { attachmentRef } : {}),
        });
      } catch (error) {
        if (error instanceof AuthError) throw error;
        if (ctx.signal.aborted) throw abortReason(ctx.signal);
        fail(reasonFromError(error));
        if (error instanceof CaptureTimeout) {
          // The page has one playhead and it is stuck, so no later frame of
          // this recording can be captured.
          for (const later of plan.items.slice(index + 1)) {
            ctx.failures.push(
              failureFor(
                later,
                "capture_timeout: an earlier frame did not finish",
                recordingStartedAtMs,
              ),
            );
          }
          break;
        }
      }
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (ctx.signal.aborted) throw abortReason(ctx.signal);
    failAll(`render_failed: ${reasonFromError(error)}`, recordingStartedAtMs);
  } finally {
    if (page) {
      await page
        .evaluate(() => {
          (window as any).__anJourneyCapture?.replayer?.destroy?.();
          (window as any).__anJourneyCapture = undefined;
        })
        .catch(() => undefined);
    }
    await context.close();
  }
}

class CaptureTimeout extends Error {}

/** Rejects with CaptureTimeout when `work` has not settled within `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(new CaptureTimeout(`capture_timeout: no frame within ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | undefined;
  // A worker never rejects: the first failure stops new work, every worker
  // drains, and only then is it rethrown, so the caller still holds every
  // result the in-flight recordings produced.
  const worker = async () => {
    while (!failure && !signal?.aborted && next < items.length) {
      const item = items[next++]!;
      try {
        await work(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  if (failure) throw failure.error;
  if (signal?.aborted) throw abortReason(signal);
}

export function signalExitCode(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129;
}

export function createCaptureSignalHandler(
  controller: AbortController,
  closeBrowser: () => Promise<void>,
  onFirstSignal: (signal: NodeJS.Signals) => void,
  onSecondSignal: (signal: NodeJS.Signals) => void,
): (signal: NodeJS.Signals) => void {
  let firstSignal: NodeJS.Signals | undefined;
  return (signal) => {
    if (firstSignal) {
      onSecondSignal(signal);
      return;
    }
    firstSignal = signal;
    onFirstSignal(signal);
    controller.abort(new Error(`run_stopped: ${signal}`));
    void closeBrowser();
  };
}

function intOption(
  value: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function ratioOption(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      tree: { type: "string" },
      out: { type: "string" },
      "per-node": { type: "string" },
      concurrency: { type: "string" },
      "min-aspect": { type: "string" },
      "max-aspect": { type: "string" },
      "app-url": { type: "string" },
      token: { type: "string" },
      upload: { type: "boolean" },
      "capture-mode": { type: "string" },
      "extract-prompts": { type: "boolean" },
      "timeout-ms": { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (!values.tree) {
    console.error("--tree <file> is required.\n\n" + HELP);
    return 2;
  }
  const captureMode = values["capture-mode"] ?? "offline";
  if (captureMode !== "offline" && captureMode !== "browser") {
    console.error("--capture-mode must be offline or browser.");
    return 2;
  }
  const extractPrompts = values["extract-prompts"] === true;
  if (extractPrompts && captureMode !== "browser") {
    console.error("--extract-prompts requires --capture-mode browser.");
    return 2;
  }
  // pnpm --filter runs scripts from the package directory.
  const base = process.env.INIT_CWD || process.cwd();
  const resolve = (p: string) => path.resolve(base, p);
  const perNode = intOption(values["per-node"], "--per-node", 2, 1, 10);
  const concurrency = intOption(values.concurrency, "--concurrency", 3, 1, 8);
  const timeoutMs = intOption(
    values["timeout-ms"],
    "--timeout-ms",
    60_000,
    1_000,
    600_000,
  );
  const minAspect = ratioOption(values["min-aspect"], "--min-aspect");
  const maxAspect = ratioOption(values["max-aspect"], "--max-aspect");
  const appUrl = normalizeAppUrl(
    values["app-url"] ??
      process.env.AGENT_NATIVE_ANALYTICS_URL ??
      DEFAULT_APP_URL,
  );

  let tree;
  try {
    tree = parseTree(JSON.parse(await readFile(resolve(values.tree), "utf8")));
  } catch (error) {
    console.error(
      error instanceof TreeFormatError
        ? error.message
        : `Could not read the tree JSON at ${values.tree}: ${reasonFromError(error)}`,
    );
    return 2;
  }
  const { items, skipped } = planCapture(tree, {
    perNode,
    minAspect,
    maxAspect,
  });
  const plans = groupByRecording(items);
  console.error(
    `Plan: ${items.length} frames across ${plans.length} recordings (${skipped.length} examples skipped).`,
  );

  if (values["dry-run"]) {
    console.log(
      JSON.stringify(
        {
          appUrl,
          captureMode,
          extractPrompts,
          recordings: plans.map((plan) => ({
            recordingId: plan.recordingId,
            frames: plan.items.map((item) => ({
              nodeKey: item.nodeKey,
              exampleIndex: item.exampleIndex,
              offsetMs: item.offsetMs,
              viewport: item.viewport,
            })),
          })),
          skipped,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const outDir = resolve(values.out ?? "frames");
  await preparePrivateOutputDirectory(outDir, base);
  const manifestPath = path.join(outDir, "manifest.json");
  const promptProvenancePath = path.join(outDir, PROMPT_PROVENANCE_FILE);
  // A manifest left by an earlier run would describe old frames as this run's
  // output if the run exits before it writes its own.
  await removeStaleRunMetadata(outDir);
  const generatedAt = new Date().toISOString();
  const writeManifest = async (
    frames: ManifestFrame[],
    failures: ManifestFailure[],
    sidecarWriteFailed = false,
  ) => {
    const manifest = buildManifest({
      generatedAt,
      appUrl,
      captureMode,
      ...(extractPrompts && !sidecarWriteFailed
        ? { promptProvenancePath }
        : {}),
      ...(extractPrompts && sidecarWriteFailed
        ? { promptProvenanceError: "sidecar_write_failed" as const }
        : {}),
      outDir,
      frames,
      failures,
      skipped,
    });
    await writePrivateOutputFile(
      manifestPath,
      JSON.stringify(manifest, null, 2) + "\n",
    );
    return manifest;
  };
  const writePromptProvenance = async (ctx?: RunContext) => {
    if (!extractPrompts) return;
    await writePromptProvenanceSidecar(
      outDir,
      generatedAt,
      ctx?.provenanceSnapshots ?? [],
      ctx?.provenanceFailures ?? [],
      ctx?.provenanceOmittedSnapshots ?? 0,
      items.length,
    );
  };

  if (!items.length) {
    const output = await writeCaptureOutputs(
      writePromptProvenance,
      (sidecarWriteFailed) => writeManifest([], [], sidecarWriteFailed),
    );
    if (output.sidecarWriteFailed) {
      console.error(
        "Prompt provenance sidecar write failed; see promptProvenanceError in the capture manifest.",
      );
    }
    console.error(
      `Nothing to render: no example has a recording and an offset (see "skipped" in ${manifestPath}). Re-run get-onboarding-journey with a window that has replays.`,
    );
    return 1;
  }

  const token = await resolveToken(values.token, appUrl);
  if (!token && !isLoopbackHost(new URL(appUrl).hostname)) {
    console.error(unauthenticatedMessage(appUrl));
    return 2;
  }

  const chromium = await importChromium();
  let replayRelay: ReplaySocksRelay | undefined;
  if (captureMode === "browser") {
    try {
      replayRelay = await startReplaySocksRelay(appUrl);
    } catch (error) {
      console.error(
        `Browser replay network relay could not start (${reasonFromError(error)}).`,
      );
      return 1;
    }
  }
  let browser: Browser;
  try {
    // The run handles Ctrl-C itself (below) so it can write its manifest.
    browser = await chromium.launch({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      ...(replayRelay ? replayBrowserLaunchOptions(replayRelay.server) : {}),
    });
  } catch (error) {
    try {
      await replayRelay?.close();
    } catch (closeError) {
      console.error(
        `Browser replay network relay did not close cleanly (${reasonFromError(closeError)}).`,
      );
    }
    console.error(
      `Chromium could not start (${reasonFromError(error)}). Run: npx playwright install chromium`,
    );
    return 1;
  }
  const abortController = new AbortController();
  const ctx: RunContext = {
    appUrl,
    token,
    signal: abortController.signal,
    browser,
    outDir,
    timeoutMs,
    upload: values.upload === true,
    captureMode,
    extractPrompts,
    minAspect,
    maxAspect,
    usedNames: new Set(),
    frames: [],
    failures: [],
    provenanceSnapshots: [],
    provenanceFailures: [],
    provenanceOmittedSnapshots: 0,
    provenanceInFlight: 0,
  };
  let requestedSignal: NodeJS.Signals | undefined;
  let captureResourceCloseError: unknown;
  let browserClosePromise: Promise<void> | undefined;
  const closeBrowser = () => {
    browserClosePromise ??= Promise.allSettled(
      [
        () => browser.close(),
        ...(replayRelay ? [() => replayRelay!.close()] : []),
      ].map((close) => Promise.resolve().then(close)),
    ).then((results) => {
      const rejected = results.find((result) => result.status === "rejected");
      captureResourceCloseError =
        rejected?.status === "rejected" ? rejected.reason : undefined;
    });
    return browserClosePromise;
  };
  const handleCaptureSignal = createCaptureSignalHandler(
    abortController,
    closeBrowser,
    (signal) => {
      requestedSignal = signal;
    },
    (signal) => process.exit(signalExitCode(signal)),
  );
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const signalHandlers = signals.map((signal) => {
    const handler = () => {
      handleCaptureSignal(signal);
    };
    process.on(signal, handler);
    return { signal, handler };
  });
  let stopped: { error: unknown } | undefined;
  try {
    await runPool(
      plans,
      concurrency,
      async (plan) => {
        await renderRecording(ctx, plan);
        const failed = ctx.failures.filter(
          (failure) => failure.recordingId === plan.recordingId,
        ).length;
        console.error(
          `Finished ${plan.recordingId}: ${plan.items.length - failed} of ${plan.items.length} frames.`,
        );
      },
      abortController.signal,
    );
  } catch (error) {
    stopped = { error };
  }

  // Whatever stopped the run, the frames and uploads it already produced get a
  // manifest, and every planned frame it never reached is listed as a failure.
  const stoppedReason = requestedSignal
    ? `run_stopped: ${requestedSignal}`
    : stopped
      ? stopped.error instanceof AuthError
        ? "run_stopped: authentication failed"
        : `run_stopped: ${reasonFromError(stopped.error)}`
      : undefined;
  if (stoppedReason) {
    ctx.failures.push(
      ...unattemptedFailures(items, ctx.frames, ctx.failures, stoppedReason),
    );
  }
  let manifest;
  try {
    const output = await writeCaptureOutputs(
      () => writePromptProvenance(ctx),
      (sidecarWriteFailed) =>
        writeManifest(ctx.frames, ctx.failures, sidecarWriteFailed),
    );
    manifest = output.manifest;
    if (output.sidecarWriteFailed) {
      console.error(
        "Prompt provenance sidecar write failed; see promptProvenanceError in the capture manifest.",
      );
    }
  } finally {
    await closeBrowser();
    for (const { signal, handler } of signalHandlers) {
      process.off(signal, handler);
    }
  }
  if (captureResourceCloseError) {
    console.error(
      `Browser capture resources did not close cleanly (${reasonFromError(captureResourceCloseError)}).`,
    );
    return 1;
  }
  if (requestedSignal) {
    console.error(
      `${requestedSignal}: the run stopped early; ${manifest.frames.length} frames captured before it are in ${manifestPath}, and the frames it never reached are listed under "failures".`,
    );
    return requestedSignal === "SIGINT"
      ? 130
      : requestedSignal === "SIGTERM"
        ? 143
        : 129;
  }
  if (stopped) {
    const { error } = stopped;
    console.error(
      `${error instanceof AuthError ? error.message : `journey:capture stopped on an unexpected error: ${reasonFromError(error)}`}\nThe run stopped early; ${manifest.frames.length} frames captured before it are in ${manifestPath}, and the frames it never reached are listed under "failures".`,
    );
    return error instanceof AuthError ? 2 : 1;
  }
  console.log(
    JSON.stringify({
      manifest: manifestPath,
      frames: manifest.frames.length,
      failures: manifest.failures.length,
      skipped: manifest.skipped.length,
    }),
  );
  if (manifest.failures.length) {
    console.error(
      `${manifest.failures.length} frames failed; see "failures" in the manifest.`,
    );
  }
  return exitCodeFor(manifest);
}

// The dev server imports every file under scripts/, so only a direct run
// executes the command.
function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(
    entrypoint &&
    import.meta.url === pathToFileURL(path.resolve(entrypoint)).href,
  );
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
