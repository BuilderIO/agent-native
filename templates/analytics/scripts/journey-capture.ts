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
import { lookup as dnsLookup } from "node:dns/promises";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  Agent as HttpAgent,
  request as httpRequest,
  type IncomingHttpHeaders,
  type RequestOptions,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { createRequire } from "node:module";
import { BlockList, isIP } from "node:net";
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
  reasonFromError,
  stripBearer,
  TreeFormatError,
  unattemptedFailures,
  unauthenticatedMessage,
  isLoopbackHost,
  type ManifestFailure,
  type ManifestFrame,
  type RecordingPlan,
} from "./journey-capture-plan";

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
  --timeout-ms <ms>      Per recording load / per frame limit (default 60000)
  --dry-run              Print the plan (recordings, offsets, viewports) and render nothing
  --help

Authenticate (nothing is read from a local database):
  npx -y @agent-native/core@latest connect ${DEFAULT_APP_URL} --client codex
This writes a bearer into ~/.codex/config.toml, which this command reads. For
another client, pass --token or set AGENT_NATIVE_TOKEN.

Needs Playwright with Chromium (npx playwright install chromium) and the local
@rrweb/replay package included by the Analytics workspace.

manifest.json: { generatedAt, appUrl, frames: [{ nodeKey, exampleIndex, recordingId,
offsetMs, width, height, localPath, capturedAt, route?, attachmentRef? }],
remoteAssets: "not-fetched", failures: [{ nodeKey, exampleIndex, recordingId,
offsetMs, reason }], skipped: [...] }.
Exit code is 1 when no frame was captured, 2 when authentication is missing or rejected.`;

class AuthError extends Error {}

interface BrowserPage {
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
interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}
interface Browser {
  newContext(options: Record<string, unknown>): Promise<BrowserContext>;
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

interface RunContext {
  appUrl: string;
  token: string | undefined;
  browser: Browser;
  outDir: string;
  timeoutMs: number;
  upload: boolean;
  minAspect?: number;
  maxAspect?: number;
  usedNames: Set<string>;
  frames: ManifestFrame[];
  failures: ManifestFailure[];
}

const moduleRequire = createRequire(import.meta.url);
const MAX_CAPTURE_EVENTS = 100_000;
const MAX_CAPTURE_EVENT_BYTES = 64 * 1024 * 1024;
const MAX_CAPTURE_CHUNKS = 2_000;
const MAX_CAPTURE_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_CAPTURE_CHUNK_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_APP_ACTION_RESPONSE_BYTES = 4 * 1024 * 1024;

const nonPublicIpv4 = new BlockList();
for (const [range, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  nonPublicIpv4.addSubnet(range, prefix, "ipv4");
}

const globalUnicastIpv6 = new BlockList();
globalUnicastIpv6.addSubnet("2000::", 3, "ipv6");
const nonPublicIpv6 = new BlockList();
for (const [range, prefix] of [
  ["2001:2::", 48],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  nonPublicIpv6.addSubnet(range, prefix, "ipv6");
}

const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet("127.0.0.0", 8, "ipv4");
loopbackAddresses.addSubnet("::1", 128, "ipv6");

function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonPublicIpv4.check(address, "ipv4");
  return (
    family === 6 &&
    globalUnicastIpv6.check(address, "ipv6") &&
    !nonPublicIpv6.check(address, "ipv6")
  );
}

function isLoopbackAddress(address: string): boolean {
  const family = isIP(address);
  return (
    (family === 4 || family === 6) &&
    loopbackAddresses.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

async function resolvePinnedAddresses(
  url: URL,
): Promise<Array<{ address: string; family: number }>> {
  if (url.username || url.password) {
    throw new Error("app_request_url_invalid");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const normalizedHost = hostname.replace(/\.$/, "");
  const isLoopbackApp = isLoopbackHost(normalizedHost);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopbackApp)
  ) {
    throw new Error("app_request_url_invalid");
  }
  if (
    !isLoopbackApp &&
    (normalizedHost.endsWith(".localhost") ||
      normalizedHost.endsWith(".local") ||
      normalizedHost.endsWith(".internal") ||
      normalizedHost.endsWith(".test") ||
      normalizedHost.endsWith(".invalid") ||
      normalizedHost.endsWith(".example"))
  ) {
    throw new Error("app_network_target_blocked");
  }

  let addresses: Array<{ address: string; family: number }>;
  const family = isIP(normalizedHost);
  if (family) {
    addresses = [{ address: normalizedHost, family }];
  } else {
    try {
      addresses = await dnsLookup(normalizedHost, {
        all: true,
        verbatim: true,
      });
    } catch {
      throw new Error("app_dns_lookup_failed");
    }
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) =>
      isLoopbackApp ? !isLoopbackAddress(address) : !isPublicIpAddress(address),
    )
  ) {
    throw new Error("app_network_target_blocked");
  }
  return addresses;
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
  },
): Promise<{
  status: number;
  headers: IncomingHttpHeaders;
  bodyText: string;
}> {
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

  try {
    const response = (async () => {
      const pinnedAddresses = await resolvePinnedAddresses(url);
      if (timedOut) throw new Error("app_request_timeout");
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
    return await Promise.race([response, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
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
): Promise<{ data: unknown; headers: IncomingHttpHeaders; bodyText: string }> {
  const response = await requestAppResponse(url, {
    headers: { accept: "application/json" },
    timeoutMs,
    maxBytes,
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
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (let start = 0; start < chunks.length; start += 8) {
    const batch = chunks
      .slice(start, start + 8)
      .map((value, index) => ({ chunk: record(value)!, index: start + index }));
    const batchEvents = new Array<unknown[]>(batch.length);
    await runPool(batch, 4, async ({ chunk, index }) => {
      const chunkUrl = safeChunkUrl(
        chunk.bytesPath,
        appUrl,
        recordingId,
        chunk.seq,
        accessToken,
      );
      const chunkResponse = await fetchReplayJson(
        chunkUrl,
        timeoutMs,
        MAX_CAPTURE_CHUNK_RESPONSE_BYTES,
      );
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
      batchEvents[index - start] = chunkEvents;
    });

    for (const chunkEvents of batchEvents) {
      for (const value of chunkEvents!) {
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

async function renderRecording(ctx: RunContext, plan: RecordingPlan) {
  const failAll = (reason: string) => {
    for (const item of plan.items) {
      ctx.failures.push({
        nodeKey: item.nodeKey,
        exampleIndex: item.exampleIndex,
        recordingId: plan.recordingId,
        offsetMs: item.offsetMs,
        reason,
      });
    }
  };

  let contextUrl: string;
  try {
    const link = await callAppAction(
      ctx.appUrl,
      ctx.token,
      "create-session-replay-agent-link",
      { recordingId: plan.recordingId },
    );
    if (typeof link.contextUrl !== "string" || !URL.canParse(link.contextUrl)) {
      throw new Error("the app returned no replay API link");
    }
    contextUrl = link.contextUrl;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return failAll(`link_failed: ${reasonFromError(error)}`);
  }

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
    );
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return failAll(`replay_load_failed: ${reasonFromError(error)}`);
  }
  const { events, recordingStartedAtMs } = replay;
  const initial = replayInitialViewportDimensions(events);
  const timeline = buildReplayViewportTimeline(events);
  if (!initial || timeline.length === 0) {
    return failAll("replay_viewport_unavailable");
  }
  if (
    !timeline.every((change) => isScreenshotSize(change.width, change.height))
  ) {
    return failAll("viewport_out_of_range");
  }

  let assets: { scriptPath: string; stylePath: string };
  try {
    assets = localReplayAssets();
  } catch {
    return failAll("replay_renderer_unavailable");
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
    return failAll(`render_failed: ${reasonFromError(error)}`);
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
      return failAll("replay_duration_unavailable");
    }

    for (const [index, item] of plan.items.entries()) {
      const fail = (reason: string) =>
        ctx.failures.push({
          nodeKey: item.nodeKey,
          exampleIndex: item.exampleIndex,
          recordingId: plan.recordingId,
          offsetMs: item.offsetMs,
          reason,
        });
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
        await writeFile(filePath, bytes);
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
            );
            if (typeof uploaded.attachmentRef !== "string") {
              throw new Error("the app returned no attachmentRef");
            }
            attachmentRef = uploaded.attachmentRef;
          } catch (error) {
            await rm(filePath, { force: true });
            if (error instanceof AuthError) throw error;
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
          ...(route ? { route } : {}),
          ...(attachmentRef ? { attachmentRef } : {}),
        });
      } catch (error) {
        if (error instanceof AuthError) throw error;
        fail(reasonFromError(error));
        if (error instanceof CaptureTimeout) {
          // The page has one playhead and it is stuck, so no later frame of
          // this recording can be captured.
          for (const later of plan.items.slice(index + 1)) {
            ctx.failures.push({
              nodeKey: later.nodeKey,
              exampleIndex: later.exampleIndex,
              recordingId: plan.recordingId,
              offsetMs: later.offsetMs,
              reason: "capture_timeout: an earlier frame did not finish",
            });
          }
          break;
        }
      }
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    failAll(`render_failed: ${reasonFromError(error)}`);
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

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | undefined;
  // A worker never rejects: the first failure stops new work, every worker
  // drains, and only then is it rethrown, so the caller still holds every
  // result the in-flight recordings produced.
  const worker = async () => {
    while (!failure && next < items.length) {
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
  await mkdir(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "manifest.json");
  // A manifest left by an earlier run would describe old frames as this run's
  // output if the run exits before it writes its own.
  await rm(manifestPath, { force: true });
  const generatedAt = new Date().toISOString();
  const writeManifest = async (
    frames: ManifestFrame[],
    failures: ManifestFailure[],
  ) => {
    const manifest = buildManifest({
      generatedAt,
      appUrl,
      outDir,
      frames,
      failures,
      skipped,
    });
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  };

  if (!items.length) {
    await writeManifest([], []);
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
  let browser: Browser;
  try {
    // The run handles Ctrl-C itself (below) so it can write its manifest.
    browser = await chromium.launch({
      headless: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  } catch (error) {
    console.error(
      `Chromium could not start (${reasonFromError(error)}). Run: npx playwright install chromium`,
    );
    return 1;
  }
  const ctx: RunContext = {
    appUrl,
    token,
    browser,
    outDir,
    timeoutMs,
    upload: values.upload === true,
    minAspect,
    maxAspect,
    usedNames: new Set(),
    frames: [],
    failures: [],
  };
  // Frames already uploaded exist only in memory until the manifest is
  // written, so an interrupt writes it before exiting. A second signal falls
  // through to the default and ends the process.
  const signals = ["SIGINT", "SIGTERM"] as const;
  const onSignal = (signal: NodeJS.Signals) => {
    const failures = [
      ...ctx.failures,
      ...unattemptedFailures(
        items,
        ctx.frames,
        ctx.failures,
        `run_stopped: ${signal}`,
      ),
    ];
    writeManifest([...ctx.frames], failures).then(
      () => {
        console.error(
          `${signal}: the run stopped early; ${ctx.frames.length} frames captured so far are in ${manifestPath}, and the frames it never reached are listed under "failures".`,
        );
        process.exit(signal === "SIGINT" ? 130 : 143);
      },
      (error) => {
        console.error(
          `${signal}: the run stopped early and its manifest could not be written (${reasonFromError(error)}).`,
        );
        process.exit(1);
      },
    );
  };
  for (const signal of signals) process.once(signal, onSignal);
  let stopped: { error: unknown } | undefined;
  try {
    await runPool(plans, concurrency, async (plan) => {
      await renderRecording(ctx, plan);
      const failed = ctx.failures.filter(
        (failure) => failure.recordingId === plan.recordingId,
      ).length;
      console.error(
        `Finished ${plan.recordingId}: ${plan.items.length - failed} of ${plan.items.length} frames.`,
      );
    });
  } catch (error) {
    stopped = { error };
  } finally {
    for (const signal of signals) process.off(signal, onSignal);
  }

  // Whatever stopped the run, the frames and uploads it already produced get a
  // manifest, and every planned frame it never reached is listed as a failure.
  const stoppedReason = stopped
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
    manifest = await writeManifest(ctx.frames, ctx.failures);
  } finally {
    await browser.close();
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
