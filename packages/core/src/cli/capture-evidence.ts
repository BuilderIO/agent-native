import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type {
  Browser,
  BrowserContext,
  BrowserType,
  Page,
  Response,
} from "playwright";

import { loadOptionalPeer } from "../shared/optional-peer.js";
import {
  EVIDENCE_INIT_SCRIPT,
  RENDER_CAPABILITY_SCRIPT,
} from "./capture-evidence-page.js";
import {
  isPrivateAddress,
  sha256,
  sliceScript,
  sliceStylesheet,
  type SliceResult,
} from "./capture-evidence-source.js";

export type OpStatus =
  | "ok"
  | "partial"
  | "unsupported"
  | "not-applicable"
  | "timeout"
  | "error"
  | "skipped";

export type Outcome = "complete" | "partial" | "failed";

export interface ViewportSpec {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface CaptureEvidenceOptions {
  url: string;
  selector?: string;
  viewports: ViewportSpec[];
  outDir: string;
  destination?: string;
  totalBudgetMs: number;
  opBudgetMs: number;
  observeMs: number;
  observeIntervalMs: number;
  maxRequests: number;
  maxResources: number;
  maxResourceBytes: number;
  maxTotalBytes: number;
  sliceBytes: number;
  maxSliceTotalBytes: number;
  forceFallback: boolean;
  allowPrivateNetwork: boolean;
  importPlaywright?: () => Promise<{ chromium: BrowserType }>;
}

export interface OperationRecord {
  name: string;
  viewport?: string | undefined;
  status: OpStatus;
  startedAtMs: number;
  ms: number;
  budgetMs: number;
  detail?: string | undefined;
}

type Json = Record<string, unknown>;

export interface EvidenceManifest {
  schemaVersion: 1;
  kind: "capture-evidence";
  untrustedContent: true;
  outcome: Outcome;
  manifestPath: string;
  request: Json;
  timing: { startedAt: string; finishedAt: string; totalMs: number };
  environment: Json;
  capability: Json;
  viewports: Json[];
  resources: Json;
  sourceSlices: Json[];
  dependencySlice: Json[];
  operations: OperationRecord[];
  uncertainty: string[];
  cleanup: Json;
}

const DEFAULTS = {
  totalBudgetMs: 60_000,
  opBudgetMs: 15_000,
  observeMs: 1_200,
  observeIntervalMs: 100,
  maxRequests: 400,
  maxResources: 40,
  maxResourceBytes: 2_000_000,
  maxTotalBytes: 8_000_000,
  sliceBytes: 8_000,
  maxSliceTotalBytes: 64_000,
};
const MAX_LISTED_RESOURCES = 200;
const SYSTEM_CHROME = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

const USAGE = `Usage: agent-native capture-evidence --url <public-url> [options]

One bounded browser session that writes an evidence manifest for an effect on a
public page. Raw captures and source slices go to --out, never into the app.

  --url <url>               Public http(s) page (required)
  --selector <css>          Effect/selection root (default: whole page)
  --viewport <WxH[@dpr]>    Repeatable (default 1440x900@1)
  --destination <path>      App source dir; --out must not be inside it
  --out <dir>               Evidence dir (default: OS temp dir)
  --total-budget-ms <n>     Whole run (default ${DEFAULTS.totalBudgetMs})
  --op-budget-ms <n>        Each operation (default ${DEFAULTS.opBudgetMs})
  --observe-ms <n>          Timed motion observation, 0 disables (default ${DEFAULTS.observeMs})
  --max-requests <n>        Requests allowed in total (default ${DEFAULTS.maxRequests})
  --max-resources <n>       Script/style/data bodies hashed (default ${DEFAULTS.maxResources})
  --max-resource-bytes <n>  Per-body cap (default ${DEFAULTS.maxResourceBytes})
  --max-total-bytes <n>     All bodies (default ${DEFAULTS.maxTotalBytes})
  --force-fallback          Launch without WebGL to measure the static fallback
  --allow-private-network   Allow loopback/private hosts (local fixtures)
  --json                    Print the full manifest instead of a summary

Exit code: 0 complete, 2 partial, 1 failed.`;

export class CaptureEvidenceUsageError extends Error {}

function readFlag(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new CaptureEvidenceUsageError(`${name} needs a value`);
  }
  return value;
}

function boundedInt(
  raw: string,
  name: string,
  min: number,
  max: number,
): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new CaptureEvidenceUsageError(
      `${name} must be an integer from ${min} to ${max}`,
    );
  }
  return n;
}

export function parseViewport(raw: string): ViewportSpec {
  const match = /^(\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/.exec(raw);
  if (!match) {
    throw new CaptureEvidenceUsageError(
      `Invalid --viewport "${raw}"; use WIDTHxHEIGHT or WIDTHxHEIGHT@DPR`,
    );
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  const deviceScaleFactor = match[3] ? Number(match[3]) : 1;
  if (width < 200 || width > 4000 || height < 200 || height > 4000) {
    throw new CaptureEvidenceUsageError(
      `--viewport ${raw}: width and height must be 200-4000`,
    );
  }
  if (deviceScaleFactor < 1 || deviceScaleFactor > 4) {
    throw new CaptureEvidenceUsageError(`--viewport ${raw}: DPR must be 1-4`);
  }
  return { width, height, deviceScaleFactor };
}

export function viewportLabel(v: ViewportSpec): string {
  return `${v.width}x${v.height}@${v.deviceScaleFactor}`;
}

export function parseCaptureEvidenceArgs(
  args: string[],
): { options: CaptureEvidenceOptions; json: boolean } | { help: true } {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const opts: CaptureEvidenceOptions = {
    url: "",
    viewports: [],
    outDir: "",
    forceFallback: false,
    allowPrivateNetwork: false,
    ...DEFAULTS,
  };
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const [flag = "", inline] = (args[i] ?? "").split(/=(.*)/s, 2);
    const value = (): string => {
      if (inline !== undefined) return inline;
      const v = readFlag(args, i, flag);
      i++;
      return v;
    };
    switch (flag) {
      case "--url":
        opts.url = value();
        break;
      case "--selector":
        opts.selector = value();
        break;
      case "--viewport":
        opts.viewports.push(parseViewport(value()));
        break;
      case "--destination":
        opts.destination = value();
        break;
      case "--out":
        opts.outDir = value();
        break;
      case "--total-budget-ms":
        opts.totalBudgetMs = boundedInt(value(), flag, 1_000, 300_000);
        break;
      case "--op-budget-ms":
        opts.opBudgetMs = boundedInt(value(), flag, 500, 120_000);
        break;
      case "--observe-ms":
        opts.observeMs = boundedInt(value(), flag, 0, 10_000);
        break;
      case "--max-requests":
        opts.maxRequests = boundedInt(value(), flag, 1, 2_000);
        break;
      case "--max-resources":
        opts.maxResources = boundedInt(value(), flag, 0, 200);
        break;
      case "--max-resource-bytes":
        opts.maxResourceBytes = boundedInt(value(), flag, 1_000, 20_000_000);
        break;
      case "--max-total-bytes":
        opts.maxTotalBytes = boundedInt(value(), flag, 1_000, 100_000_000);
        break;
      case "--force-fallback":
        opts.forceFallback = true;
        break;
      case "--allow-private-network":
        opts.allowPrivateNetwork = true;
        break;
      case "--json":
        json = true;
        break;
      default:
        throw new CaptureEvidenceUsageError(`Unknown option ${flag}`);
    }
  }
  if (!opts.url) throw new CaptureEvidenceUsageError("--url is required");
  if (opts.viewports.length === 0) {
    opts.viewports.push({ width: 1440, height: 900, deviceScaleFactor: 1 });
  }
  if (opts.viewports.length > 6) {
    throw new CaptureEvidenceUsageError("At most 6 --viewport values");
  }
  return { options: opts, json };
}

function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CaptureEvidenceUsageError(`Invalid --url "${raw}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CaptureEvidenceUsageError("--url must be http or https");
  }
  if (url.username || url.password) {
    throw new CaptureEvidenceUsageError("--url must not embed credentials");
  }
  return url;
}

function assertOutsideDestination(outDir: string, destination?: string): void {
  if (!destination) return;
  const rel = path.relative(path.resolve(destination), path.resolve(outDir));
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    throw new CaptureEvidenceUsageError(
      "--out must be outside --destination so raw captures never land in app source",
    );
  }
}

function firstLine(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return (text.split("\n")[0] ?? "").slice(0, 300);
}

function pngSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return undefined;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function launchChromium(
  chromium: BrowserType,
  forceFallback: boolean,
): Promise<{ browser: Browser; executable: string }> {
  const args: string[] = [];
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    args.push("--no-sandbox");
  }
  if (forceFallback) args.push("--disable-gpu", "--disable-3d-apis");
  try {
    return {
      browser: await chromium.launch({ headless: true, args }),
      executable: "playwright-managed",
    };
  } catch (err) {
    if (!/Executable doesn't exist|playwright install/i.test(firstLine(err))) {
      throw err;
    }
    const failures: string[] = [];
    for (const executablePath of SYSTEM_CHROME) {
      if (!fs.existsSync(executablePath)) continue;
      try {
        return {
          browser: await chromium.launch({
            headless: true,
            args,
            executablePath,
          }),
          executable: executablePath,
        };
      } catch (fallbackErr) {
        failures.push(`${executablePath}: ${firstLine(fallbackErr)}`);
      }
    }
    throw new Error(
      `${firstLine(err)}${failures.length ? `; system browsers failed (${failures.join("; ")})` : "; no system Chrome/Chromium found"}`,
      { cause: err },
    );
  }
}

interface ResourceRecord {
  url: string;
  resourceType: string;
  status: number;
  contentType?: string | undefined;
  contentLength?: number | undefined;
  firstSeenMs: number;
  seenInViewports: string[];
  bodyStatus:
    | "not-fetched"
    | "hashed"
    | "skipped-type"
    | "skipped-size"
    | "skipped-budget"
    | "unavailable";
  bytes?: number | undefined;
  sha256?: string | undefined;
  text?: string | undefined;
}

type HostVerdict = "public" | "private" | "unresolved";

interface OpResult<T> {
  value?: T | undefined;
  status?: OpStatus | undefined;
  detail?: string | undefined;
}

const SOURCE_TYPES = new Set(["script", "stylesheet"]);
const DATA_TYPE = /json|glsl|shader|text\/plain|javascript|css|xml/i;

export async function captureEvidence(
  options: CaptureEvidenceOptions,
): Promise<EvidenceManifest> {
  const startedAt = Date.now();
  const t0 = performance.now();
  const elapsed = (): number => performance.now() - t0;
  const deadline = t0 + options.totalBudgetMs;
  const target = assertPublicUrl(options.url);
  assertOutsideDestination(options.outDir, options.destination);
  fs.mkdirSync(path.join(options.outDir, "captures"), { recursive: true });
  fs.mkdirSync(path.join(options.outDir, "slices"), { recursive: true });

  const operations: OperationRecord[] = [];
  const uncertainty: string[] = [];
  const viewportResults: Json[] = [];
  const registry = new Map<string, ResourceRecord>();
  const pendingResponses = new Map<
    string,
    { response: Response; record: ResourceRecord }
  >();
  const blocked = {
    privateHosts: new Set<string>(),
    unresolvedHosts: new Set<string>(),
    overRequestCap: 0,
  };
  const hostVerdicts = new Map<string, Promise<HostVerdict>>();
  let requestCount = 0;
  let bodyBytes = 0;
  let bodiesHashed = 0;

  async function runOp<T>(
    name: string,
    viewport: string | undefined,
    fn: () => Promise<OpResult<T>>,
    budgetOverride?: number,
  ): Promise<OpResult<T>> {
    const startedAtMs = elapsed();
    const remaining = deadline - performance.now();
    const budgetMs = Math.max(
      0,
      Math.min(budgetOverride ?? options.opBudgetMs, remaining),
    );
    const record: OperationRecord = {
      name,
      viewport,
      status: "skipped",
      startedAtMs: Math.round(startedAtMs),
      ms: 0,
      budgetMs: Math.round(budgetMs),
    };
    operations.push(record);
    if (budgetMs < 50) {
      record.detail = "total budget exhausted before this operation started";
      return { status: "skipped", detail: record.detail };
    }
    let timer: NodeJS.Timeout | undefined;
    const pending = fn();
    pending.catch(() => undefined);
    try {
      const result = await Promise.race([
        pending,
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), budgetMs);
        }),
      ]);
      if (result === "timeout") {
        record.status = "timeout";
        record.detail = `exceeded ${Math.round(budgetMs)} ms`;
        return { status: "timeout", detail: record.detail };
      }
      record.status = result.status ?? "ok";
      record.detail = result.detail;
      return result;
    } catch (err) {
      const timedOut = err instanceof Error && err.name === "TimeoutError";
      record.status = timedOut ? "timeout" : "error";
      record.detail = firstLine(err);
      return { status: record.status, detail: record.detail };
    } finally {
      if (timer) clearTimeout(timer);
      record.ms = Math.round(elapsed() - startedAtMs);
    }
  }

  let browser: Browser | undefined;
  let executable = "unknown";
  const openContexts = new Set<BrowserContext>();
  let browserVersion = "unknown";
  let capability: Json = { status: "not-probed" };
  let userAgent: string | undefined;

  const classifyHost = (host: string): Promise<HostVerdict> => {
    let verdict = hostVerdicts.get(host);
    if (!verdict) {
      verdict = (async () => {
        const bare = host.replace(/^\[|\]$/g, "");
        if (net.isIP(bare)) {
          return isPrivateAddress(bare) ? "private" : "public";
        }
        if (bare === "localhost" || bare.endsWith(".localhost")) {
          return "private";
        }
        try {
          const found = await dns.lookup(bare, { all: true });
          return found.some((f) => isPrivateAddress(f.address))
            ? "private"
            : "public";
        } catch {
          return "unresolved";
        }
      })();
      hostVerdicts.set(host, verdict);
    }
    return verdict;
  };

  try {
    const { chromium } = await loadOptionalPeer(
      "playwright",
      () => options.importPlaywright?.() ?? import("playwright"),
    );
    const launched = await runOp(
      "launch-browser",
      undefined,
      async () => {
        const result = await launchChromium(chromium, options.forceFallback);
        return { value: result };
      },
      30_000,
    );
    if (launched.value) {
      browser = launched.value.browser;
      executable = launched.value.executable;
      browserVersion = browser.version();
    }

    if (browser) {
      const activeBrowser: Browser = browser;
      const probe = await runOp(
        "probe-render-capability",
        undefined,
        async () => {
          const context = await activeBrowser.newContext();
          openContexts.add(context);
          try {
            const page = await context.newPage();
            const facts = (await page.evaluate(
              RENDER_CAPABILITY_SCRIPT,
            )) as Json;
            return { value: facts };
          } finally {
            openContexts.delete(context);
            await context.close().catch(() => undefined);
          }
        },
      );
      if (probe.value) {
        const webgl2 = probe.value.webgl2 as Json;
        const webgl = probe.value.webgl as Json;
        const live = webgl2?.available ? webgl2 : webgl;
        capability = {
          status: live?.available ? "webgl-available" : "webgl-unavailable",
          forcedFallback: options.forceFallback,
          softwareRenderer: live?.available ? live.software : undefined,
          ...probe.value,
        };
        if (live?.software) {
          uncertainty.push(
            "WebGL is software-rendered (e.g. SwiftShader); timing, precision and visual output may differ from a GPU browser.",
          );
        }
        if (!live?.available) {
          uncertainty.push(
            "WebGL is unavailable in this browser, so GPU effects can only be observed as their static fallback.",
          );
        }
      } else {
        capability = { status: "unknown", detail: probe.detail };
      }
    }

    for (const [index, viewport] of options.viewports.entries()) {
      if (!browser) break;
      const label = viewportLabel(viewport);
      const result: Json = {
        requested: { ...viewport, label },
        actual: undefined,
        navigation: undefined,
        selection: undefined,
        effect: undefined,
        motion: undefined,
        captures: [] as Json[],
        reusedEvidenceFrom:
          index > 0 && options.viewports[0]
            ? viewportLabel(options.viewports[0])
            : undefined,
      };
      viewportResults.push(result);
      if (deadline - performance.now() < 100) {
        operations.push({
          name: "viewport",
          viewport: label,
          status: "skipped",
          startedAtMs: Math.round(elapsed()),
          ms: 0,
          budgetMs: 0,
          detail: "total budget exhausted",
        });
        continue;
      }

      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.deviceScaleFactor,
        serviceWorkers: "block",
        acceptDownloads: false,
        permissions: [],
        locale: "en-US",
        colorScheme: "light",
        reducedMotion: "no-preference",
      });
      openContexts.add(context);
      await context.addInitScript(EVIDENCE_INIT_SCRIPT);
      await context.route("**/*", async (route) => {
        const requestUrl = route.request().url();
        if (/^(data|blob|about):/.test(requestUrl)) return route.continue();
        requestCount++;
        if (requestCount > options.maxRequests) {
          blocked.overRequestCap++;
          return route.abort("blockedbyclient");
        }
        if (!options.allowPrivateNetwork) {
          const host = new URL(requestUrl).hostname;
          const verdict = await classifyHost(host);
          if (verdict !== "public") {
            (verdict === "private"
              ? blocked.privateHosts
              : blocked.unresolvedHosts
            ).add(host);
            return route.abort("blockedbyclient");
          }
        }
        return route.continue();
      });
      const page: Page = await context.newPage();
      context.on("page", (popup) => {
        if (popup !== page) void popup.close().catch(() => undefined);
      });
      context.on("response", (response) => {
        const url = (response.url().split("#")[0] ?? "").slice(0, 600);
        if (/^(data|blob):/.test(url)) return;
        const headers = response.headers();
        const length = Number(headers["content-length"]);
        let record = registry.get(url);
        if (!record) {
          const created: ResourceRecord = {
            url,
            resourceType: response.request().resourceType(),
            status: response.status(),
            contentType: headers["content-type"]?.slice(0, 100),
            contentLength: Number.isFinite(length) ? length : undefined,
            firstSeenMs: Math.round(elapsed()),
            seenInViewports: [],
            bodyStatus: "not-fetched",
          };
          registry.set(url, created);
          pendingResponses.set(url, { response, record: created });
          record = created;
        }
        if (!record.seenInViewports.includes(label)) {
          record.seenInViewports.push(label);
        }
      });
      page.on(
        "dialog",
        (dialog) => void dialog.dismiss().catch(() => undefined),
      );

      const nav = await runOp("navigate", label, async () => {
        const response = await page.goto(target.href, {
          waitUntil: "domcontentloaded",
          timeout: Math.max(
            500,
            Math.min(options.opBudgetMs, deadline - performance.now()),
          ),
        });
        const status = response?.status();
        return {
          value: { status, finalUrl: page.url() },
          status: status && status >= 400 ? "partial" : "ok",
          detail: status && status >= 400 ? `HTTP ${status}` : undefined,
        };
      });
      result.navigation = {
        ...(nav.value ?? {}),
        status: nav.value?.status,
        outcome: nav.status,
        detail: nav.detail,
      };

      if (nav.value) {
        const selector = options.selector;
        const ready = await runOp("wait-ready", label, async () => {
          await page.waitForFunction(
            `window.__anEvidence.ready(${JSON.stringify(selector ?? null)}).ready`,
            undefined,
            {
              timeout: Math.max(
                500,
                Math.min(options.opBudgetMs, deadline - performance.now()) -
                  100,
              ),
              polling: 50,
            },
          );
          const reason = (await page.evaluate(
            `window.__anEvidence.ready(${JSON.stringify(selector ?? null)}).reason`,
          )) as string;
          return { value: reason, detail: reason };
        });
        let readyReason = ready.value;
        if (!readyReason) {
          readyReason = (await page
            .evaluate(
              `window.__anEvidence.ready(${JSON.stringify(selector ?? null)}).reason`,
            )
            .catch(() => "unknown")) as string;
        }
        (result.navigation as Json).readiness = {
          outcome: ready.status,
          reason: readyReason,
        };

        const probed = await runOp("probe-selection", label, async () => {
          const value = (await page.evaluate(
            `window.__anEvidence.probe(${JSON.stringify(selector ?? null)})`,
          )) as Json;
          return value.selectionPresent
            ? { value }
            : {
                value,
                status: "partial" as const,
                detail:
                  "selector matched no element (selection absent, not an unsupported probe)",
              };
        });
        const probe = probed.value;
        if (probe) {
          const env = (await page
            .evaluate("window.__anEvidence.environment()")
            .catch(() => undefined)) as Json | undefined;
          result.actual = env && {
            innerWidth: env.innerWidth,
            innerHeight: env.innerHeight,
            devicePixelRatio: env.devicePixelRatio,
            visualViewportScale: env.visualViewportScale,
          };
          if (!userAgent && env) userAgent = String(env.userAgent);
          result.selection = {
            present: probe.selectionPresent,
            matchCount: probe.matchCount,
            selector: selector ?? "(whole page)",
            element: probe.element,
            ancestors: probe.ancestors,
            layers: probe.layers,
            source: "dom+cssom",
          };
          result.animations = {
            source: "web-animations-api",
            items: probe.animations,
          };
          result.page = probe.page;
          const gpu = classifyGpu(probe);
          await runOp("classify-gpu", label, async () => ({
            value: gpu,
            status: gpu.opStatus,
            detail: gpu.reason,
          }));
          result.effect = {
            kinds: effectKinds(probe, gpu.status),
            gpu: {
              status: gpu.status,
              reason: gpu.reason,
              canvases: probe.canvases,
              source: "webgl-prototype-hooks",
              confidence: "observed-calls-only",
            },
          };
          if (!selector) {
            uncertainty.push(
              "No --selector was given, so animations and canvases are page-wide rather than one selected effect.",
            );
          }
          result.sliceTerms = probe.sliceTerms;
        }

        if (options.observeMs > 0 && probe?.selectionPresent) {
          const observed = await runOp(
            "observe-motion",
            label,
            async () => {
              const value = (await page.evaluate(
                `window.__anEvidence.observe(${JSON.stringify(selector ?? null)}, ${options.observeMs}, ${options.observeIntervalMs})`,
              )) as Json;
              return { value };
            },
            options.observeMs + 3_000,
          );
          if (observed.value) {
            const m = observed.value;
            result.motion = {
              ...m,
              live: Boolean(
                (m.rafTicks as number) > 0 ||
                m.animationsAdvancing ||
                (m.draws as number) > 0,
              ),
              source: "timed-in-page-samples",
            };
          }
        }

        await runOp("screenshots", label, async () => {
          const captures = result.captures as Json[];
          const pageShot = await page.screenshot({
            timeout: Math.max(
              500,
              Math.min(options.opBudgetMs, deadline - performance.now()) - 100,
            ),
          });
          captures.push(
            writeCapture(
              options.outDir,
              `vp-${label}-page.png`,
              "viewport",
              pageShot,
              label,
            ),
          );
          const actual = result.actual as Json | undefined;
          const px = pngSize(pageShot);
          if (actual && px) actual.screenshotPx = px;
          if (selector && probe?.selectionPresent) {
            // A clipped page shot: element screenshots wait for the element to
            // stop moving, which never happens for a looping animation.
            const box = (await page.evaluate(
              `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); const x = Math.max(0, r.x), y = Math.max(0, r.y); return { x, y, width: Math.min(innerWidth, r.right) - x, height: Math.min(innerHeight, r.bottom) - y }; })()`,
            )) as { x: number; y: number; width: number; height: number };
            if (box.width >= 1 && box.height >= 1) {
              const shot = await page.screenshot({ clip: box, timeout: 4_000 });
              captures.push(
                writeCapture(
                  options.outDir,
                  `vp-${label}-selection.png`,
                  "selection",
                  shot,
                  label,
                ),
              );
            } else {
              return {
                value: captures.length,
                status: "partial" as const,
                detail:
                  "selection is outside the viewport; only the viewport capture was taken",
              };
            }
          }
          return { value: captures.length };
        });

        if (index === 0) {
          await runOp("collect-inline-sources", label, async () => {
            const items = (await page.evaluate(
              `window.__anEvidence.inlineSources(${options.maxResourceBytes}, 20)`,
            )) as Array<{
              type: string;
              index: number;
              length: number;
              text: string;
            }>;
            for (const item of items) {
              const url = `inline:${item.type}#${item.index}`;
              registry.set(url, {
                url,
                resourceType: item.type,
                status: 200,
                firstSeenMs: Math.round(elapsed()),
                seenInViewports: [label],
                bodyStatus: "hashed",
                bytes: item.length,
                sha256: sha256(item.text),
                text: item.text,
              });
            }
            return { value: items.length };
          });
        }

        await runOp("collect-resources", label, async () => {
          const wait = Math.max(0, deadline - performance.now());
          const queue = [...pendingResponses.entries()]
            .map(([, pending]) => pending)
            .sort(
              (a, b) =>
                Number(SOURCE_TYPES.has(b.record.resourceType)) -
                Number(SOURCE_TYPES.has(a.record.resourceType)),
            );
          pendingResponses.clear();
          const stopAt =
            performance.now() + Math.min(options.opBudgetMs, wait) - 200;
          let truncatedByBudget = false;
          for (const { response, record } of queue) {
            const textLike =
              SOURCE_TYPES.has(record.resourceType) ||
              ((record.resourceType === "fetch" ||
                record.resourceType === "xhr" ||
                record.resourceType === "other") &&
                DATA_TYPE.test(record.contentType ?? ""));
            if (!textLike) {
              record.bodyStatus = "skipped-type";
              continue;
            }
            if (
              bodiesHashed >= options.maxResources ||
              bodyBytes >= options.maxTotalBytes ||
              performance.now() > stopAt
            ) {
              record.bodyStatus = "skipped-budget";
              truncatedByBudget = true;
              continue;
            }
            if ((record.contentLength ?? 0) > options.maxResourceBytes) {
              record.bodyStatus = "skipped-size";
              continue;
            }
            try {
              const body = await response.body();
              if (body.length > options.maxResourceBytes) {
                record.bodyStatus = "skipped-size";
                record.bytes = body.length;
                continue;
              }
              if (bodyBytes + body.length > options.maxTotalBytes) {
                record.bodyStatus = "skipped-budget";
                truncatedByBudget = true;
                continue;
              }
              bodyBytes += body.length;
              bodiesHashed++;
              record.bytes = body.length;
              record.sha256 = sha256(body);
              record.text = body.toString("utf8");
              record.bodyStatus = "hashed";
            } catch {
              record.bodyStatus = "unavailable";
            }
          }
          return truncatedByBudget
            ? {
                value: queue.length,
                status: "partial" as const,
                detail:
                  "resource body limits reached; remaining bodies not hashed",
              }
            : { value: queue.length };
        });
      }

      await context.close().catch(() => undefined);
      openContexts.delete(context);
    }
  } catch (err) {
    operations.push({
      name: "session",
      status: "error",
      startedAtMs: Math.round(elapsed()),
      ms: 0,
      budgetMs: 0,
      detail: firstLine(err),
    });
  }

  const cleanup = await closeEverything(browser, openContexts);

  const { slices, dependencySlice } = buildSourceSlices(
    registry,
    viewportResults,
    options,
  );
  const listed = [...registry.values()];
  const resources = {
    requestsObserved: requestCount,
    requestCap: options.maxRequests,
    blocked: {
      overRequestCap: blocked.overRequestCap,
      privateOrLoopbackHosts: [...blocked.privateHosts],
      unresolvedHosts: [...blocked.unresolvedHosts],
    },
    bodiesHashed,
    bodyBytes,
    listedTruncated: listed.length > MAX_LISTED_RESOURCES,
    items: listed.slice(0, MAX_LISTED_RESOURCES).map((r) => ({
      url: r.url,
      resourceType: r.resourceType,
      status: r.status,
      contentType: r.contentType,
      contentLength: r.contentLength,
      bodyStatus: r.bodyStatus,
      bytes: r.bytes,
      sha256: r.sha256,
      firstSeenMs: r.firstSeenMs,
      seenInViewports: r.seenInViewports,
    })),
  };
  if (blocked.overRequestCap > 0) {
    uncertainty.push(
      `${blocked.overRequestCap} request(s) were aborted after the ${options.maxRequests}-request cap; the page may be missing assets.`,
    );
  }
  if (blocked.unresolvedHosts.size > 0) {
    uncertainty.push(
      "Requests to hosts that did not resolve in DNS were blocked: " +
        [...blocked.unresolvedHosts].join(", "),
    );
  }
  if (blocked.privateHosts.size > 0) {
    uncertainty.push(
      "Requests to loopback/private hosts were blocked; the page may be missing assets that depend on them.",
    );
  }

  for (const v of viewportResults) delete v.sliceTerms;
  const outcome = computeOutcome(operations, viewportResults);
  if (outcome !== "complete") {
    uncertainty.push(
      "Some operations did not finish cleanly; check operations[] and per-viewport effect.gpu before relying on absent fields.",
    );
  }

  const manifestPath = path.join(options.outDir, "manifest.json");
  const manifest: EvidenceManifest = {
    schemaVersion: 1,
    kind: "capture-evidence",
    untrustedContent: true,
    outcome,
    manifestPath,
    request: {
      url: target.href,
      selector: options.selector ?? null,
      viewports: options.viewports.map((v) => ({
        ...v,
        label: viewportLabel(v),
      })),
      forceFallback: options.forceFallback,
      observeMs: options.observeMs,
      budgets: {
        totalMs: options.totalBudgetMs,
        perOperationMs: options.opBudgetMs,
        maxRequests: options.maxRequests,
        maxResources: options.maxResources,
        maxResourceBytes: options.maxResourceBytes,
        maxTotalBytes: options.maxTotalBytes,
        sliceBytes: options.sliceBytes,
        maxSliceTotalBytes: options.maxSliceTotalBytes,
      },
    },
    timing: {
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      totalMs: Math.round(elapsed()),
    },
    environment: {
      browser: "chromium",
      version: browserVersion,
      executable,
      headless: true,
      platform: `${os.platform()}-${os.arch()}`,
      userAgent,
    },
    capability,
    viewports: viewportResults,
    resources,
    sourceSlices: slices,
    dependencySlice,
    operations,
    uncertainty,
    cleanup,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

function writeCapture(
  outDir: string,
  fileName: string,
  kind: string,
  data: Buffer,
  viewport: string,
): Json {
  const file = path.join("captures", fileName);
  fs.writeFileSync(path.join(outDir, file), data);
  const size = pngSize(data);
  const hash = sha256(data);
  return {
    handle: `capture:${hash.slice(0, 16)}`,
    kind,
    viewport,
    path: file,
    sha256: hash,
    bytes: data.length,
    widthPx: size?.width,
    heightPx: size?.height,
    capturedAt: new Date().toISOString(),
  };
}

interface GpuClass {
  status: string;
  reason: string;
  opStatus: OpStatus;
}

function classifyGpu(probe: Json): GpuClass {
  const canvases = (probe.canvases as Json[]) ?? [];
  const page = (probe.page as Json) ?? {};
  if (canvases.length === 0) {
    if (
      (page.offscreenCanvases as number) > 0 ||
      (page.webgpuRequests as number) > 0
    ) {
      return {
        status: "introspection-unsupported",
        reason:
          "page uses WebGPU or OffscreenCanvas outside the selection; GPU facts cannot be read",
        opStatus: "unsupported",
      };
    }
    return {
      status: "not-applicable",
      reason: "no canvas in the selection",
      opStatus: "not-applicable",
    };
  }
  const contexts = canvases.map((c) => String(c.context));
  if (
    contexts.includes("offscreen-transferred") ||
    (page.webgpuRequests as number) > 0
  ) {
    return {
      status: "introspection-unsupported",
      reason:
        "canvas is rendered by a worker (OffscreenCanvas) or WebGPU; uniforms are not introspectable here",
      opStatus: "unsupported",
    };
  }
  const live = canvases.filter((c) => (c.draws as number) > 0);
  if (live.length > 0) {
    const hasUniforms = live.some(
      (c) => Object.keys((c.uniforms as Json) ?? {}).length > 0,
    );
    return hasUniforms
      ? {
          status: "live",
          reason: "draw calls and uniform writes observed",
          opStatus: "ok",
        }
      : {
          status: "live-uniforms-empty",
          reason:
            "draw calls observed but no uniform writes were captured; not treated as a complete GPU capture",
          opStatus: "partial",
        };
  }
  if (contexts.includes("webgl-unavailable")) {
    return {
      status: "static-fallback",
      reason:
        "the page asked for a WebGL context and did not get one; this is its non-GPU fallback, not the live effect",
      opStatus: "unsupported",
    };
  }
  if (contexts.some((c) => c !== "none-observed")) {
    return {
      status: "context-without-draws",
      reason:
        "WebGL context exists but no draw call happened before the readiness deadline",
      opStatus: "partial",
    };
  }
  return {
    status: "context-not-observed",
    reason:
      "canvas has no WebGL context observed (2D/bitmaprenderer canvas, or the context was created before hooks ran)",
    opStatus: "unsupported",
  };
}

function effectKinds(probe: Json, gpuStatus: string): string[] {
  const kinds: string[] = [];
  const animations = (probe.animations as Json[]) ?? [];
  if (animations.some((a) => a.kind === "CSSAnimation"))
    kinds.push("css-animation");
  if (animations.some((a) => a.kind === "CSSTransition"))
    kinds.push("css-transition");
  if (animations.some((a) => a.kind === "Animation"))
    kinds.push("web-animation");
  if (gpuStatus === "live" || gpuStatus === "live-uniforms-empty")
    kinds.push("gpu-live");
  else if (gpuStatus !== "not-applicable") kinds.push(`gpu-${gpuStatus}`);
  if (kinds.length === 0) kinds.push("static-or-script-driven-dom");
  return kinds;
}

function computeOutcome(
  operations: OperationRecord[],
  viewports: Json[],
): Outcome {
  const probed = viewports.some(
    (v) => (v.selection as Json | undefined)?.present === true,
  );
  if (!probed) return "failed";
  const clean = operations.every(
    (o) => o.status === "ok" || o.status === "not-applicable",
  );
  return clean ? "complete" : "partial";
}

function buildSourceSlices(
  registry: Map<string, ResourceRecord>,
  viewports: Json[],
  options: CaptureEvidenceOptions,
): { slices: Json[]; dependencySlice: Json[] } {
  const termsSource = viewports.find((v) => v.sliceTerms)?.sliceTerms as
    | {
        classNames: string[];
        ids: string[];
        animationNames: string[];
        uniformNames: string[];
      }
    | undefined;
  if (!termsSource) return { slices: [], dependencySlice: [] };
  const weighted = new Map<string, number>();
  const add = (list: string[], weight: number): void => {
    for (const t of list)
      weighted.set(t, Math.max(weighted.get(t) ?? 0, weight));
  };
  add(termsSource.animationNames, 5);
  add(termsSource.uniformNames, 4);
  add(termsSource.ids, 3);
  add(termsSource.classNames.slice(0, 30), 1);
  for (const token of (options.selector ?? "").match(/[#.][\w-]{3,}/g) ?? []) {
    weighted.set(token.slice(1), 3);
  }
  const terms = [...weighted.keys()];
  const hasCanvas = viewports.some(
    (v) =>
      (
        ((v.effect as Json | undefined)?.gpu as Json | undefined)?.canvases as
          | unknown[]
          | undefined
      )?.length,
  );
  const scriptTerms = hasCanvas
    ? [...terms, "getContext", "getUniformLocation"]
    : terms;

  const scored: Array<{
    record: ResourceRecord;
    result: SliceResult;
    score: number;
    kind: string;
  }> = [];
  for (const record of registry.values()) {
    if (record.bodyStatus !== "hashed" || record.text === undefined) continue;
    const isCss = record.resourceType === "stylesheet";
    const result = isCss
      ? sliceStylesheet(record.text, terms, options.sliceBytes)
      : sliceScript(record.text, scriptTerms, 240, options.sliceBytes);
    const score = result.matchedTerms.reduce(
      (sum, t) => sum + (weighted.get(t) ?? 0.5),
      0,
    );
    if (score > 0) {
      scored.push({
        record,
        result,
        score,
        kind: isCss
          ? "stylesheet"
          : record.resourceType === "script"
            ? "script"
            : "data",
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  const slices: Json[] = [];
  const dependencySlice: Json[] = [];
  let used = 0;
  let n = 0;
  for (const { record, result, score, kind } of scored) {
    const sliceText = result.slices
      .map(
        (s) =>
          `/* chars ${s.start}-${s.end}, lines ${s.startLine}-${s.endLine} */\n${s.text}`,
      )
      .join("\n\n");
    const bytes = Buffer.byteLength(sliceText);
    if (used + bytes > options.maxSliceTotalBytes) {
      dependencySlice.push({
        url: record.url,
        role: kind,
        score,
        matchedTerms: result.matchedTerms,
        sliceStatus: "omitted-slice-budget",
      });
      continue;
    }
    used += bytes;
    const file = path.join(
      "slices",
      `${++n}-${(record.sha256 ?? "").slice(0, 12)}.txt`,
    );
    fs.writeFileSync(path.join(options.outDir, file), sliceText);
    slices.push({
      resourceUrl: record.url,
      resourceType: record.resourceType,
      resourceSha256: record.sha256,
      resourceBytes: record.bytes,
      score,
      matchedTerms: result.matchedTerms,
      hits: result.hits,
      unit: "utf16-chars",
      ranges: result.slices.map((s) => ({
        start: s.start,
        end: s.end,
        startLine: s.startLine,
        endLine: s.endLine,
      })),
      file,
      fileSha256: sha256(sliceText),
      truncated: result.truncated,
    });
    dependencySlice.push({
      url: record.url,
      role: kind,
      score,
      matchedTerms: result.matchedTerms,
      sliceStatus: "written",
      file,
    });
  }
  const unrelated = [...registry.values()].filter(
    (r) => r.bodyStatus === "hashed" && !scored.some((s) => s.record === r),
  ).length;
  if (unrelated > 0) {
    dependencySlice.push({
      omittedUnrelatedResources: unrelated,
      reason: "no slice term matched; bodies hashed but not exposed",
    });
  }
  return { slices, dependencySlice };
}

async function closeEverything(
  browser: Browser | undefined,
  contexts: Set<BrowserContext>,
): Promise<Json> {
  const started = performance.now();
  const withTimeout = async (p: Promise<unknown>): Promise<boolean> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        p.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 5_000);
        }),
      ]);
    } catch {
      // coercion-ok: false is reported as browserClosed=false in the manifest
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const leftover = [...contexts];
  let contextsClosed = 0;
  for (const c of leftover) {
    if (await withTimeout(c.close())) contextsClosed++;
    contexts.delete(c);
  }
  let browserClosed = true;
  if (browser) {
    browserClosed = await withTimeout(browser.close());
    browserClosed = browserClosed && !browser.isConnected();
  }
  return {
    browserClosed,
    leftoverContextsClosed: contextsClosed,
    leftoverContextsFound: leftover.length,
    ms: Math.round(performance.now() - started),
  };
}

export async function runCaptureEvidence(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseCaptureEvidenceArgs>;
  try {
    parsed = parseCaptureEvidenceArgs(args);
  } catch (err) {
    console.error(firstLine(err));
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if ("help" in parsed) {
    console.log(USAGE);
    return;
  }
  const { options, json } = parsed;
  if (!options.outDir) {
    options.outDir = fs.mkdtempSync(path.join(os.tmpdir(), "an-evidence-"));
  }
  options.outDir = path.resolve(options.outDir);
  let manifest: EvidenceManifest;
  try {
    manifest = await captureEvidence(options);
  } catch (err) {
    console.error(firstLine(err));
    process.exitCode = 1;
    return;
  }
  if (json) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    console.log(
      JSON.stringify(
        {
          outcome: manifest.outcome,
          manifestPath: manifest.manifestPath,
          totalMs: manifest.timing.totalMs,
          operations: manifest.operations.map(
            (o) =>
              `${o.name}${o.viewport ? `[${o.viewport}]` : ""}:${o.status}`,
          ),
          uncertainty: manifest.uncertainty,
        },
        null,
        2,
      ),
    );
  }
  process.exitCode =
    manifest.outcome === "complete"
      ? 0
      : manifest.outcome === "partial"
        ? 2
        : 1;
}
