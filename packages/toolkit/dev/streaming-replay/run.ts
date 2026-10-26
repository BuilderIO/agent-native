/**
 * Runs the streaming replay harness in headless Chromium against a running
 * dev server, so frame timing does not depend on a visible browser window.
 *
 *   pnpm exec tsx dev/streaming-replay/run.ts --out ../../.tmp/replay.json
 *
 * Options:
 *   --origin <url>        Dev server (default http://localhost:3440)
 *   --path <path>         Page to load the harness on (default /home)
 *   --timelines <list>    Comma list of steady,bursty,very-fast,stall-flood,
 *                         recorded,history,user-scroll (default: all)
 *   --thread <id> --run <id>  Stored run to replay as "recorded"
 *   --reduced-motion      Emulate prefers-reduced-motion: reduce
 *   --screenshot <dir>    Save mid-stream screenshots per timeline
 *   --screenshot-at <ms>  Comma list of times after load (default 5000)
 *   --out <file>          Write the results as JSON
 *   --samples             Include every frame sample in the JSON
 *   --count-code-tokens   Count highlighted code per token span instead of
 *                         per word
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Page } from "playwright";

import type { ReplayOptions } from "./harness.js";
import type { SyntheticTimelineKind } from "./timelines.js";

const here = dirname(fileURLToPath(import.meta.url));
const harnessPath = resolve(here, "harness.tsx");

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv.at(index + 1);
  if (value === undefined) throw new Error(`--${name} needs a value.`);
  return value;
}

const origin = option("origin") ?? "http://localhost:3440";
const pagePath = option("path") ?? "/home";
const timelines = (
  option("timelines") ??
  "steady,bursty,very-fast,stall-flood,recorded,history,user-scroll"
).split(",");
const threadId = option("thread");
const runId = option("run");
const screenshotDir = option("screenshot");
const out = option("out");
const screenshotTimes = (option("screenshot-at") ?? "5000")
  .split(",")
  .map(Number);
const includeSamples = process.argv.includes("--samples");
const reducedMotion = process.argv.includes("--reduced-motion");
const codeWordCounting = process.argv.includes("--count-code-tokens")
  ? ("text-nodes" as const)
  : ("units" as const);

async function openHarness(page: Page): Promise<void> {
  await page.goto(`${origin}${pagePath}`, {
    waitUntil: "domcontentloaded",
    timeout: 180_000,
  });
  const localDev = page.getByRole("button", { name: /continue as local dev/i });
  // The chat composer only renders once the app shell and its styles load.
  const composer = page.locator("[contenteditable='true']").first();
  await composer.or(localDev).first().waitFor({ timeout: 90_000 });
  if (await localDev.isVisible()) {
    await localDev.click();
    await composer.waitFor({ timeout: 90_000 });
  }
  // The app can still redirect (restoring the last thread) after it renders.
  for (let url = ""; url !== page.url(); ) {
    url = page.url();
    await page.waitForTimeout(3_000);
  }
  await page.evaluate(
    (path) => import(/* @vite-ignore */ `/@fs${path}`),
    harnessPath,
  );
}

type TimelineSource =
  | { kind: "recorded"; threadId: string; runId: string }
  | { kind: "synthetic"; name: SyntheticTimelineKind };

function timelineSource(name: string): TimelineSource {
  if (name !== "recorded" && name !== "user-scroll") {
    return { kind: "synthetic", name: name as SyntheticTimelineKind };
  }
  if (!threadId || !runId) throw new Error(`${name} needs --thread and --run.`);
  return { kind: "recorded", threadId, runId };
}

async function runTimeline(page: Page, name: string): Promise<unknown> {
  // A fresh page per timeline, so one replay's leftovers never skew the next.
  await openHarness(page);
  if (name === "history") {
    return page.evaluate(() => {
      const replay = window.streamingReplay;
      if (!replay)
        throw new Error("The streaming replay harness is not loaded.");
      return replay.measureHistoryLoad();
    });
  }
  const source = timelineSource(name);
  const extra: Partial<ReplayOptions> = {
    includeSamples,
    codeWordCounting,
    ...(name === "user-scroll"
      ? { userScroll: { at: 3_000, pixels: 240 }, jumpToLatestAt: 6_000 }
      : {}),
  };
  // Times count from when the replay is handed to the page, which includes
  // mounting the transcript.
  const screenshot = screenshotDir
    ? Promise.all(
        screenshotTimes.map((at) =>
          page
            .waitForTimeout(at)
            .then(() =>
              page.screenshot({
                path: resolve(
                  screenshotDir,
                  screenshotTimes.length > 1
                    ? `${name}-${at}.png`
                    : `${name}.png`,
                ),
              }),
            )
            .catch((error: unknown) =>
              console.warn(`No screenshot for ${name} at ${at}ms:`, error),
            ),
        ),
      )
    : Promise.resolve();
  const result = await page.evaluate(
    async ({ source, extra }) => {
      const replay = window.streamingReplay;
      if (!replay)
        throw new Error("The streaming replay harness is not loaded.");
      const timeline =
        source.kind === "recorded"
          ? await replay.captureRecordedTimeline({
              threadId: source.threadId,
              runId: source.runId,
              name: "recorded",
            })
          : replay.syntheticTimeline(source.name);
      return replay.runReplay({ timeline, ...extra });
    },
    { source, extra },
  );
  await screenshot;
  return result;
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
  });
  page.setDefaultTimeout(120_000);
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const results: Record<string, unknown> = {};
  try {
    for (const name of timelines) {
      for (let attempt = 1; ; attempt += 1) {
        try {
          results[name] = await runTimeline(page, name);
          break;
        } catch (error) {
          // A dev server reloads the page when watched files change.
          const interrupted =
            error instanceof Error &&
            /Execution context was destroyed|Timeout \d+ms exceeded/.test(
              error.message,
            );
          if (!interrupted || attempt === 3) throw error;
          console.warn(`${name}: the page reloaded or stalled; retrying.`);
        }
      }
      const { samples: _samples, ...summary } = results[name] as {
        samples?: unknown;
      };
      console.log(name, JSON.stringify(summary));
    }
  } finally {
    await browser.close();
  }
  if (out) {
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), `${JSON.stringify(results, null, 2)}\n`);
  }
}

await main();
