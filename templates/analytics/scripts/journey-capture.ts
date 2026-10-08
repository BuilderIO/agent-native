#!/usr/bin/env tsx
/**
 * journey:capture - render onboarding journey frames from a JourneyTree.
 *
 * Reads the tree JSON that the `get-onboarding-journey` MCP tool returns, mints
 * a short-lived tokenized replay link per recording on the DEPLOYED Analytics
 * app, opens each recording once in headless Chromium, seeks to every offset,
 * and writes a PNG per frame plus manifest.json. It never reads a local
 * database.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { isScreenshotSize, pngDimensions } from "../shared/png";
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
paths resolve from the directory you ran the command in.

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

Needs Playwright with Chromium (npx playwright install chromium) and a deployed
Analytics app new enough to serve /sessions/:id?frame=1.

manifest.json: { generatedAt, appUrl, frames: [{ nodeKey, exampleIndex, recordingId,
offsetMs, width, height, localPath, capturedAt, route?, attachmentRef? }],
failures: [{ nodeKey, exampleIndex, recordingId, offsetMs, reason }], skipped: [...] }.
Exit code is 1 when no frame was captured, 2 when authentication is missing or rejected.`;

class AuthError extends Error {}

interface BrowserPage {
  goto(url: string, options: Record<string, unknown>): Promise<unknown>;
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
  const response = await fetch(`${appUrl}/_agent-native/actions/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  if (response.status === 401 || response.status === 403) {
    throw new AuthError(
      `${unauthenticatedMessage(appUrl)}\n(${action} answered HTTP ${response.status}; the token may be expired or for another app.)`,
    );
  }
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }
  if (!response.ok || !json) {
    const detail =
      typeof json?.error === "string"
        ? json.error
        : typeof json?.message === "string"
          ? json.message
          : body.slice(0, 200);
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

  let frameUrl: string;
  try {
    const link = await callAppAction(
      ctx.appUrl,
      ctx.token,
      "create-session-replay-agent-link",
      { recordingId: plan.recordingId },
    );
    if (typeof link.url !== "string" || !URL.canParse(link.url)) {
      throw new Error("the app returned no replay link");
    }
    const minted = new URL(link.url);
    // Keep the app URL's origin (and the minted path, which carries any base
    // path); the app may not know its own public origin behind a proxy.
    const url = new URL(minted.pathname + minted.search, ctx.appUrl);
    url.searchParams.set("frame", "1");
    frameUrl = url.toString();
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return failAll(`link_failed: ${reasonFromError(error)}`);
  }

  // The viewport comes from the tree file and was recorded by a client, so a
  // size no screenshot could have never reaches the browser.
  const first = plan.items[0]!.viewport;
  if (first && !isScreenshotSize(first.width, first.height)) {
    return failAll("viewport_out_of_range");
  }
  let context: BrowserContext;
  try {
    context = await ctx.browser.newContext({
      viewport: { width: first?.width ?? 1280, height: first?.height ?? 800 },
      deviceScaleFactor: 1,
      acceptDownloads: false,
    });
  } catch (error) {
    return failAll(`render_failed: ${reasonFromError(error)}`);
  }
  try {
    const page = await context.newPage();
    await page.goto(frameUrl, {
      waitUntil: "domcontentloaded",
      timeout: ctx.timeoutMs,
    });
    try {
      await page.waitForFunction(
        () => {
          const frame = (window as any).__anReplayFrame;
          return Boolean(frame && frame.status !== "loading");
        },
        undefined,
        { timeout: ctx.timeoutMs },
      );
    } catch {
      return failAll(
        "frame_not_ready: the replay frame did not load in time; the deployed app may predate /sessions/:id?frame=1",
      );
    }
    const state = await page.evaluate<{ status: string; reason?: string }>(
      () => {
        const frame = (window as any).__anReplayFrame;
        return { status: frame.status, reason: frame.reason };
      },
    );
    if (state.status !== "ready") {
      return failAll(`replay_unavailable: ${state.reason ?? "unknown"}`);
    }

    for (const item of plan.items) {
      const fail = (reason: string) =>
        ctx.failures.push({
          nodeKey: item.nodeKey,
          exampleIndex: item.exampleIndex,
          recordingId: plan.recordingId,
          offsetMs: item.offsetMs,
          reason,
        });
      try {
        const captured = await page.evaluate<{
          width: number;
          height: number;
          route: string;
          capturedAt: string;
          png: string;
        }>(
          (offsetMs) => (window as any).__anReplayFrame.capture(offsetMs),
          item.offsetMs,
        );
        if (!aspectInRange(captured.width, captured.height, ctx)) {
          fail("aspect_out_of_range");
          continue;
        }
        const bytes = Buffer.from(captured.png, "base64");
        const dimensions = pngDimensions(bytes);
        if (
          !dimensions ||
          dimensions.width !== captured.width ||
          dimensions.height !== captured.height
        ) {
          fail("screenshot_invalid");
          continue;
        }
        // With --upload a frame without its attachmentRef is a failure, not a
        // frame: nothing is written or listed for it.
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
                png: captured.png,
              },
            );
            if (typeof uploaded.attachmentRef !== "string") {
              throw new Error("the app returned no attachmentRef");
            }
            attachmentRef = uploaded.attachmentRef;
          } catch (error) {
            if (error instanceof AuthError) throw error;
            fail(`upload_failed: ${reasonFromError(error)}`);
            continue;
          }
        }
        const fileName = frameFileName(
          item.nodeKey,
          item.exampleIndex,
          ctx.usedNames,
        );
        await writeFile(path.join(ctx.outDir, fileName), bytes);
        ctx.frames.push({
          nodeKey: item.nodeKey,
          exampleIndex: item.exampleIndex,
          recordingId: plan.recordingId,
          offsetMs: item.offsetMs,
          width: captured.width,
          height: captured.height,
          localPath: fileName,
          capturedAt: captured.capturedAt,
          ...(captured.route ? { route: captured.route } : {}),
          ...(attachmentRef ? { attachmentRef } : {}),
        });
      } catch (error) {
        if (error instanceof AuthError) throw error;
        fail(reasonFromError(error));
      }
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    failAll(`render_failed: ${reasonFromError(error)}`);
  } finally {
    await context.close();
  }
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
    browser = await chromium.launch({ headless: true });
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
