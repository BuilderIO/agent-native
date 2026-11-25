import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

import { chromium, type Page } from "@playwright/test";

import { pnpmCommand } from "../../../../scripts/lib/pnpm-command.ts";
import {
  BenchLockHeld,
  CHECKPOINT_LOAD_WAIT_MS,
  CONSTANTS,
  DEVICE_SCALE_FACTOR,
  IDLE_SAMPLE_MS,
  LONG_FRAME_MS,
  READY_STABLE_MS,
  READY_TIMEOUT_MS,
  SanityFailure,
  VIEWPORT,
  acquireBenchLock,
  findBrowserPid,
  median,
  measurePxPerTick,
  parseAsn,
  parseFrontApp,
  percentile,
  required,
  readBoardExtent,
  readCamera,
  readClearArea,
  readVisibleScreens,
  round,
  summarizeOsFocus,
  type ActionContext,
  type ActionResult,
  type CanvasBenchAction,
  type Checkpoint,
  type ClearArea,
  type FrontSample,
  type OsFocusSummary,
  type ScreenshotMode,
  type Sampled,
  type VisibleScreens,
} from "./lib.ts";

let seededDesignId: string | undefined;
async function deleteSeededDesign() {
  if (!seededDesignId) return;
  const id = seededDesignId;
  seededDesignId = undefined;
  await postAction("delete-design", { id });
}
async function deleteSeededDesignOrReport(): Promise<string | null> {
  const id = seededDesignId;
  try {
    await deleteSeededDesign();
    return null;
  } catch (error) {
    const message = `seeded design ${id} was NOT deleted, delete it manually: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    return message;
  }
}
const exitAfterCleanup = async () => {
  await deleteSeededDesignOrReport();
  process.exit(2);
};
process.on("uncaughtException", (error) => {
  console.error(error);
  void exitAfterCleanup();
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void exitAfterCleanup();
  });
}

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    design: { type: "string" },
    action: { type: "string", multiple: true },
    copies: { type: "string" },
    source: { type: "string" },
    runs: { type: "string", default: "3" },
    out: { type: "string" },
    headless: { type: "boolean", default: false },
    screenshots: { type: "string", default: "on-failure" },
    "keep-design": { type: "boolean", default: false },
    "reuse-design": { type: "boolean", default: false },
    video: { type: "boolean", default: false },
    "inject-jank": { type: "string" },
    "break-input": { type: "boolean", default: false },
  },
});
const rawBaseUrl = values["base-url"]?.replace(/\/$/, "");
if (!rawBaseUrl) {
  throw new Error(
    "--base-url is required; point it at a production build started with AUTH_DISABLED=1",
  );
}
const baseUrl: string = rawBaseUrl;
if (values.source !== undefined && values.copies !== undefined) {
  throw new Error("--source and --copies cannot be combined");
}
if (values.source !== undefined && values.design !== undefined) {
  throw new Error("--source and --design cannot be combined");
}
if (
  values.design !== undefined &&
  (values["keep-design"] || values["reuse-design"])
) {
  throw new Error(
    "--keep-design and --reuse-design cannot be combined with --design",
  );
}
const keepDesign = values["keep-design"];
const reuseDesign = values["reuse-design"];
const SCREENSHOT_MODES = ["on-failure", "always", "never"] as const;
if (!SCREENSHOT_MODES.includes(values.screenshots as ScreenshotMode)) {
  throw new Error(
    `--screenshots must be one of ${SCREENSHOT_MODES.join(", ")}, got ${values.screenshots}`,
  );
}
const screenshotMode = values.screenshots as ScreenshotMode;
const copies = Number(values.copies ?? "6");
const runs = Number(values.runs);
if (!Number.isInteger(copies) || copies < 1) {
  throw new Error(`--copies must be a positive integer, got ${values.copies}`);
}
if (!Number.isInteger(runs) || runs < 1) {
  throw new Error(`--runs must be a positive integer, got ${values.runs}`);
}
function parseInjectJank(
  value: string | undefined,
): { busyMs: number; everyMs: number } | null {
  if (value === undefined) return null;
  const match = /^(\d+)@(\d+)$/.exec(value);
  const busyMs = Number(match?.[1]);
  const everyMs = Number(match?.[2]);
  if (!match || busyMs < 1 || everyMs <= busyMs) {
    throw new Error(
      `--inject-jank must be <busyMs>@<everyMs> with everyMs > busyMs, got ${value}`,
    );
  }
  return { busyMs, everyMs };
}
const injectedJank = parseInjectJank(values["inject-jank"]);
const breakInput = values["break-input"];
const actionNames = [
  ...new Set(
    (values.action ?? ["pan"])
      .flatMap((value) => value.split(","))
      .map((name) => name.trim())
      .filter(Boolean),
  ),
];
if (!actionNames.length) throw new Error("--action needs at least one name");
const designRoot = fileURLToPath(new URL("../..", import.meta.url));
const outDir = (
  values.out ??
  fileURLToPath(new URL("../../../../.tmp/canvas-bench/", import.meta.url))
).replace(/\/$/, "");
const startedAt = new Date().toISOString();
const runDir = `${outDir}/${startedAt.replace(/[:.]/g, "-")}`;
const video = values.video;

async function loadAction(name: string): Promise<CanvasBenchAction> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new SanityFailure(`invalid action name "${name}"`);
  }
  let loaded: { default?: CanvasBenchAction };
  try {
    loaded = await import(`./actions/${name}.ts`);
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_MODULE_NOT_FOUND") {
      throw new SanityFailure(
        `unknown action "${name}": no scripts/canvas-bench/actions/${name}.ts`,
      );
    }
    throw error;
  }
  const action = loaded.default;
  if (!action || typeof action.run !== "function" || action.name !== name) {
    throw new SanityFailure(
      `actions/${name}.ts must default-export { name: "${name}", run }`,
    );
  }
  return action;
}
const actions: CanvasBenchAction[] = [];
try {
  for (const name of actionNames) actions.push(await loadAction(name));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}
const mutating = actions.filter((action) => action.mutatesDesign);
if (values.design !== undefined && mutating.length) {
  console.error(
    `${mutating.map((action) => action.name).join(", ")} saves changes to the design, so it runs only on a seeded or --source board, never on --design`,
  );
  process.exit(2);
}

try {
  acquireBenchLock(process.argv.slice(2).join(" "));
} catch (error) {
  if (!(error instanceof BenchLockHeld)) throw error;
  console.error(error.message);
  process.exit(2);
}

function readSourceDesign(): {
  id: string | null;
  title: string;
  contentHash: string;
} | null {
  if (values.source === undefined) return null;
  const raw = readFileSync(values.source);
  const parsed = JSON.parse(raw.toString("utf8")) as {
    id?: string;
    title?: string;
  };
  return {
    id: typeof parsed.id === "string" && parsed.id ? parsed.id : null,
    title: String(parsed.title ?? ""),
    contentHash: createHash("sha256").update(raw).digest("hex"),
  };
}

const sourceDesign = readSourceDesign();

const SEEDED_DESIGN_LINE = /^design (\S+) /m;

async function seedDesign(url: string): Promise<string> {
  let output: string;
  try {
    const pnpm = pnpmCommand([
      "exec",
      "tsx",
      "e2e/fixtures/seed-perf-stress-design.ts",
      "--base-url",
      url,
      ...(values.source !== undefined
        ? ["--source", values.source]
        : ["--copies", String(copies)]),
      "--title",
      "Canvas bench",
    ]);
    output = execFileSync(pnpm.command, pnpm.args, {
      cwd: designRoot,
      encoding: "utf8",
      shell: pnpm.shell,
    });
  } catch (error) {
    const stdout = String((error as { stdout?: unknown }).stdout ?? "");
    const id = SEEDED_DESIGN_LINE.exec(stdout)?.[1];
    const reason = error instanceof Error ? error.message : String(error);
    if (!id) {
      throw new Error(`seeding failed before a design was created: ${reason}`);
    }
    seededDesignId = id;
    let cleanup: string;
    try {
      await deleteSeededDesign();
      cleanup = "deleted";
    } catch (deleteError) {
      cleanup = `NOT deleted (${deleteError instanceof Error ? deleteError.message : deleteError}); delete it manually`;
    }
    throw new Error(
      `seeding failed after creating design ${id} "Canvas bench": ${cleanup}.\n${reason}`,
    );
  }
  const id = SEEDED_DESIGN_LINE.exec(output)?.[1];
  if (!id) throw new Error(`seeding printed no design id:\n${output}`);
  seededDesignId = id;
  return id;
}

async function postAction(name: string, input: unknown): Promise<unknown> {
  const response = await fetch(`${baseUrl}/_agent-native/actions/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-CSRF": "1",
      Connection: "close",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      `${name} failed: ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

let designId: string;
const invocationStartedAt = Date.now();
const seedStartedAt = Date.now();
const designCachePath = fileURLToPath(
  new URL("../../../../.tmp/canvas-bench/design-cache.json", import.meta.url),
);
type CachedDesign = {
  designId: string;
  screens: number;
  canvasFramesHash: string;
  createdAt: string;
};
const designCacheKey = `${baseUrl} ${
  sourceDesign ? `source:${sourceDesign.contentHash}` : `seed:copies=${copies}`
}`;
function readDesignCache(): Record<string, CachedDesign> {
  if (!existsSync(designCachePath)) return {};
  return JSON.parse(readFileSync(designCachePath, "utf8"));
}
function writeDesignCache(
  update: (cache: Record<string, CachedDesign>) => void,
) {
  const cache = readDesignCache();
  update(cache);
  mkdirSync(designCachePath.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(`${designCachePath}.tmp`, JSON.stringify(cache, null, 2));
  renameSync(`${designCachePath}.tmp`, designCachePath);
}

async function readDesignState(
  id: string,
): Promise<{ screens: number; canvasFramesHash: string } | null> {
  const response = await fetch(
    `${baseUrl}/_agent-native/actions/get-design?id=${encodeURIComponent(id)}&includeFileContent=false`,
    { headers: { Connection: "close" } },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `get-design failed: ${response.status} ${await response.text()}`,
    );
  }
  const design = (await response.json()) as {
    data?: string | null;
    files?: unknown[];
  };
  const data = design.data ? JSON.parse(design.data) : {};
  const frames = Object.entries(
    (data.canvasFrames ?? {}) as Record<string, Record<string, unknown>>,
  )
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([frameId, frame]) => [
      frameId,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
    ]);
  return {
    screens: frames.length,
    canvasFramesHash: createHash("sha256")
      .update(JSON.stringify(frames))
      .digest("hex"),
  };
}

let designReused = false;
let designCheckMs = 0;
const designReseeds: string[] = [];
async function seedAndMaybeKeep() {
  const id = await seedDesign(baseUrl);
  if (!keepDesign) return id;
  const state = await readDesignState(id);
  if (!state) throw new Error(`seeded design ${id} cannot be read back`);
  writeDesignCache((cache) => {
    cache[designCacheKey] = {
      designId: id,
      screens: state.screens,
      canvasFramesHash: state.canvasFramesHash,
      createdAt: new Date().toISOString(),
    };
  });
  seededDesignId = undefined;
  return id;
}
async function findReusableDesign(): Promise<string | null> {
  const cached = readDesignCache()[designCacheKey] as CachedDesign | undefined;
  if (!cached) return null;
  const state = await readDesignState(cached.designId);
  const problem = !state
    ? "no longer exists"
    : state.screens !== cached.screens
      ? `has ${state.screens} screens, expected ${cached.screens}`
      : state.canvasFramesHash !== cached.canvasFramesHash
        ? "screen positions drifted"
        : null;
  if (!problem) return cached.designId;
  console.warn(`cached design ${cached.designId} ${problem}; seeding fresh`);
  if (state) {
    await postAction("delete-design", { id: cached.designId });
  }
  writeDesignCache((cache) => {
    delete cache[designCacheKey];
  });
  designReseeds.push(`${cached.designId} ${problem}`);
  return null;
}

if (!values.design) {
  const reusable = reuseDesign ? await findReusableDesign() : null;
  if (reusable) {
    designReused = true;
    designId = reusable;
    console.log(`reusing design ${designId}`);
  } else {
    designId = await seedAndMaybeKeep();
  }
} else {
  designId = values.design;
}
class DesignNotFound extends Error {}
const readScreenCount = async (id: string) => {
  const state = await readDesignState(id);
  if (!state) throw new DesignNotFound(`design ${id} not found at ${baseUrl}`);
  return state.screens;
};
let screenCount: number;
try {
  screenCount = await readScreenCount(designId);
} catch (error) {
  if (!(error instanceof DesignNotFound)) throw error;
  console.error(error.message);
  await deleteSeededDesignOrReport();
  process.exit(2);
}
const seedMs = Date.now() - seedStartedAt;

const testHooksScript = (hooks: {
  jank: { busyMs: number; everyMs: number } | null;
  breakInput: boolean;
}) => {
  const isTop = window.top === window;
  const sampling = () => {
    try {
      return !!window.top?.__bench?.sampling;
    } catch {
      // coercion-ok: a cross-origin top window is not the sampling frame
      return false;
    }
  };
  if (hooks.jank && isTop) {
    const { busyMs, everyMs } = hooks.jank;
    setInterval(() => {
      if (!sampling()) return;
      const until = performance.now() + busyMs;
      while (performance.now() < until);
    }, everyMs);
  }
  if (hooks.breakInput) {
    for (const type of [
      "wheel",
      "pointerdown",
      "pointermove",
      "pointerup",
      "mousedown",
      "mousemove",
      "mouseup",
      "click",
    ]) {
      window.addEventListener(
        type,
        (event) => {
          if (!sampling()) return;
          event.preventDefault();
          event.stopImmediatePropagation();
        },
        { capture: true, passive: false },
      );
    }
  }
};

const initScript = () => {
  if (window.top !== window) return;
  const w = window as unknown as {
    __bench: {
      longFrames: number[];
      frames: number[];
      sampling: boolean;
      focus: { lostFocus: boolean; hidden: boolean; blurs: number };
      clearArea: () => ClearArea | null;
    };
  };
  w.__bench = {
    longFrames: [],
    frames: [],
    sampling: false,
    focus: { lostFocus: false, hidden: false, blurs: 0 },
    clearArea: () => {
      const surface = document.querySelector(
        "[data-multi-screen-canvas-surface]",
      );
      if (!surface) return null;
      const bounds = surface.getBoundingClientRect();
      const free = (x: number, y: number) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && surface.contains(hit);
      };
      const cx = (bounds.left + bounds.right) / 2;
      const cy = (bounds.top + bounds.bottom) / 2;
      if (!free(cx, cy)) return null;
      const STEP = 4;
      const walk = (
        from: number,
        limit: number,
        dir: 1 | -1,
        at: (v: number) => boolean,
      ) => {
        let v = from;
        while (dir * (limit - (v + dir * STEP)) >= 0 && at(v + dir * STEP)) {
          v += dir * STEP;
        }
        return dir * (limit - (v + dir * STEP)) < 0 ? limit : v;
      };
      const row = (x: number) => free(x, cy);
      const col = (y: number) => free(cx, y);
      return {
        left: walk(cx, bounds.left, -1, row),
        right: walk(cx, bounds.right, 1, row),
        top: walk(cy, bounds.top, -1, col),
        bottom: walk(cy, bounds.bottom, 1, col),
      };
    },
  };
  new PerformanceObserver((list) => {
    if (!w.__bench.sampling) return;
    for (const entry of list.getEntries()) {
      w.__bench.longFrames.push(entry.duration);
    }
  }).observe({ type: "long-animation-frame", buffered: false });

  w.__bench.focus = { lostFocus: false, hidden: false, blurs: 0 };
  addEventListener("blur", () => {
    if (!w.__bench.sampling) return;
    w.__bench.focus.blurs += 1;
    setTimeout(() => {
      if (!document.hasFocus()) w.__bench.focus.lostFocus = true;
    }, 0);
  });
  document.addEventListener("visibilitychange", () => {
    if (w.__bench.sampling && document.visibilityState !== "visible") {
      w.__bench.focus.hidden = true;
    }
  });
  let last: number | undefined;
  const tick = (now: number) => {
    if (w.__bench.sampling) {
      if (document.visibilityState !== "visible") w.__bench.focus.hidden = true;
      if (!document.hasFocus()) w.__bench.focus.lostFocus = true;
    }
    if (w.__bench.sampling && last !== undefined) {
      w.__bench.frames.push(now - last);
    }
    last = w.__bench.sampling ? now : undefined;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  document.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLIFrameElement) {
        event.target.setAttribute("data-bench-loaded", "");
      }
    },
    true,
  );
  addEventListener("message", (event) => {
    if (event.data?.type !== "agent-native:editor-chrome-ready") return;
    for (const frame of document.querySelectorAll("iframe")) {
      if (frame.contentWindow === event.source) {
        frame.setAttribute("data-bench-loaded", "");
      }
    }
  });
};

async function waitForReady(page: Page) {
  const giveUpAt = Date.now() + READY_TIMEOUT_MS;
  let stableSince: number | null = null;
  let last: VisibleScreens = { visible: 0, loaded: 0, screens: [] };
  while (Date.now() < giveUpAt) {
    let ready = false;
    try {
      last = await readVisibleScreens(page);
      ready =
        (await readCamera(page)) !== null &&
        last.visible > 0 &&
        last.loaded === last.visible;
    } catch (error) {
      if (!String(error).includes("Execution context was destroyed"))
        throw error;
    }
    if (!ready) stableSince = null;
    else if ((stableSince ??= Date.now()) <= Date.now() - READY_STABLE_MS) {
      return last;
    }
    await page.waitForTimeout(100);
  }
  const diagnostics = await page
    .evaluate((viewportWidth) => {
      const shells = [
        ...document.querySelectorAll("[data-screen-shell][data-frame-id]"),
      ].map((shell) => {
        const { left, top, width, height } = shell.getBoundingClientRect();
        return { left, top, width, height };
      });
      return {
        camera:
          document.querySelector<HTMLElement>(
            "[data-multi-screen-canvas-world]",
          )?.style.transform ?? null,
        clear: window.__bench?.clearArea() ?? null,
        shells: shells.length,
        nearest: shells
          .filter(
            (r) =>
              r.width > 0 &&
              r.left < 2 * viewportWidth &&
              r.left + r.width > -viewportWidth,
          )
          .slice(0, 6)
          .map((r) => [r.left, r.top, r.width, r.height].map(Math.round)),
      };
    }, VIEWPORT.width)
    .then(
      (state) => JSON.stringify(state),
      (error) =>
        `diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  throw new SanityFailure(
    `canvas never became ready: ${last.loaded}/${last.visible} visible screens loaded ${diagnostics}`,
  );
}

const IDLE_PROBE_GRACE_MS = 2000;
const measureIdleFrameMs = async (page: Page): Promise<number> => {
  const intervals = await page.evaluate(
    ({ duration, graceMs }) =>
      new Promise<number[] | null>((resolve) => {
        const intervals: number[] = [];
        let last: number | undefined;
        const begin = performance.now();
        const timeout = setTimeout(() => resolve(null), duration + graceMs);
        const tick = (now: number) => {
          if (last !== undefined) intervals.push(now - last);
          last = now;
          if (now - begin >= duration) {
            clearTimeout(timeout);
            resolve(intervals);
          } else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { duration: IDLE_SAMPLE_MS, graceMs: IDLE_PROBE_GRACE_MS },
  );
  if (!intervals?.length) {
    throw new SanityFailure(
      `idle probe got no animation frames within ${IDLE_SAMPLE_MS + IDLE_PROBE_GRACE_MS}ms (window hidden or minimized?)`,
    );
  }
  return median(intervals);
};

type PageFocus = { lostFocus: boolean; hidden: boolean };
type FocusState = PageFocus & {
  osFocusCheck: "checked" | "unavailable";
  osFocusReason: string | null;
  osFrontmostOther: boolean;
  osOtherApps: string[];
  osPolls: number;
};

const readFocus = async (page: Page): Promise<PageFocus> =>
  required(
    await page.evaluate(() => {
      const f = window.__bench?.focus;
      return f ? { lostFocus: f.lostFocus, hidden: f.hidden } : null;
    }),
    "harness focus state",
  );

const SAMPLER_STOP_TIMEOUT_MS = 2000;
const sampler = (page: Page) => ({
  async start() {
    const armed = await page.evaluate(() => {
      const bench = window.__bench;
      if (!bench) return false;
      bench.frames = [];
      bench.longFrames = [];
      bench.sampling = true;
      return true;
    });
    if (!armed)
      throw new SanityFailure("harness __bench sampler is not active");
  },
  async stop(): Promise<Sampled> {
    const sampled = await page.evaluate(async (waitMs) => {
      const bench = window.__bench;
      if (!bench) return null;
      const frames = (async () => {
        for (let i = 0; i < 2; i += 1) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return true;
      })();
      const timeout = new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), waitMs),
      );
      if (!(await Promise.race([frames, timeout]))) bench.focus.hidden = true;
      if (document.visibilityState !== "visible") bench.focus.hidden = true;
      if (!document.hasFocus()) bench.focus.lostFocus = true;
      bench.sampling = false;
      return {
        frames: bench.frames,
        longFrames: bench.longFrames,
      };
    }, SAMPLER_STOP_TIMEOUT_MS);
    return required(sampled, "harness __bench sampler");
  },
});

const OS_FOCUS_POLL_MS = 250;
const execFileAsync = promisify(execFile);
type OsFocusSetup =
  | { enabled: true; browserPid: number }
  | { enabled: false; reason: string };

const readFrontApp = async (): Promise<FrontSample> => {
  const asn = parseAsn((await execFileAsync("lsappinfo", ["front"])).stdout);
  if (!asn) return null;
  const [name, pid] = await Promise.all([
    execFileAsync("lsappinfo", ["info", "-only", "name", asn]),
    execFileAsync("lsappinfo", ["info", "-only", "pid", asn]),
  ]);
  return parseFrontApp(name.stdout, pid.stdout);
};

async function setupOsFocus(): Promise<OsFocusSetup> {
  if (process.platform !== "darwin") {
    return {
      enabled: false,
      reason: `unsupported platform ${process.platform}`,
    };
  }
  if (values.headless) {
    return { enabled: false, reason: "--headless has no window to focus" };
  }
  try {
    const ps = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,command="], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const browserPid = findBrowserPid(ps.stdout, process.pid);
    if (browserPid === null) {
      return {
        enabled: false,
        reason: "could not identify the browser process",
      };
    }
    if (!(await readFrontApp())) {
      return { enabled: false, reason: "lsappinfo output was unreadable" };
    }
    return { enabled: true, browserPid };
  } catch (error) {
    return {
      enabled: false,
      reason: `lsappinfo failed: ${error instanceof Error ? error.message : error}`,
    };
  }
}

function osFocusMonitor(setup: OsFocusSetup) {
  const samples: FrontSample[] = [];
  let timer: NodeJS.Timeout | undefined;
  let inflight: Promise<void> | undefined;
  const poll = () =>
    (inflight ??= readFrontApp()
      .catch((): FrontSample => null)
      .then((sample) => {
        samples.push(sample);
      })
      .finally(() => {
        inflight = undefined;
      }));
  return {
    start() {
      if (!setup.enabled || timer) return;
      void poll();
      timer = setInterval(() => void poll(), OS_FOCUS_POLL_MS);
    },
    async stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
      await inflight;
      await poll();
    },
    summary(): OsFocusSummary {
      if (!setup.enabled) return { check: "unavailable", reason: setup.reason };
      if (!samples.length) {
        return { check: "unavailable", reason: "no sampler window ran" };
      }
      return summarizeOsFocus(samples, setup.browserPid);
    },
  };
}

type ActionTimings = {
  contextNavigationMs: number;
  waitReadyMs: number | null;
  idleProbeMs: number | null;
  actionMs: number;
  sampledMs: number;
  checkpointMs: number;
  screenshotMs: number;
  contextCloseMs: number;
};
type ActionRun = {
  timings: ActionTimings;
  readyMs: number | null;
  idleFrameMs: number | null;
  idleHz: number | null;
  frameCount: number;
  frameIntervalsMs: number[];
  frameP50Ms: number | null;
  frameP95Ms: number | null;
  frameWorstMs: number | null;
  framesOver50Ms: number;
  longAnimationFrames: number[];
  longAnimationFrameCount: number;
  extra: ActionResult["extra"];
  checkpoints: Checkpoint[];
  video: string | null;
  focus: FocusState;
  focusValid: boolean;
};
type RunResult = { run: number; actions: Record<string, ActionRun> };
type ActionFailure = {
  run: number;
  action: string;
  message: string;
  screenshot: string | null;
};

const numericExtras = (extra: ActionResult["extra"]) =>
  Object.entries(extra).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
const fmtMs = (value: number | null) => (value === null ? "n/a" : `${value}ms`);
const fmt = (value: number | null) =>
  value === null ? "n/a" : String(round(value));

class DesignUnavailable extends Error {}
let designChecks = 0;
async function ensureDesignIntact() {
  if (!designReused || designChecks++ === 0) return;
  const checkStartedAt = Date.now();
  if (!(await findReusableDesign())) {
    designReused = false;
    try {
      designId = await seedAndMaybeKeep();
      screenCount = await readScreenCount(designId);
    } catch (error) {
      throw new DesignUnavailable(
        `the reused design changed and reseeding failed, so no design is left to measure: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  designCheckMs += Date.now() - checkStartedAt;
}

const failureScreenshots = new Map<string, string>();

async function measureAction(
  action: CanvasBenchAction,
  run: number,
): Promise<ActionRun> {
  const name = action.name;
  const label = `run ${run} [${name}]`;
  await ensureDesignIntact();
  const contextStartedAt = Date.now();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    ...(video ? { recordVideo: { dir: runDir, size: VIEWPORT } } : {}),
  });
  const page = await context.newPage();
  let videoPath: string | null = null;
  try {
    await page.addInitScript("globalThis.__name = (fn) => fn;");
    await page.addInitScript(initScript);
    if (injectedJank || breakInput) {
      await page.addInitScript(testHooksScript, {
        jank: injectedJank,
        breakInput,
      });
    }

    const designUrl = `${baseUrl}/design/${designId}`;
    const checkpoints: Checkpoint[] = [];
    const timings: ActionTimings = {
      contextNavigationMs: 0,
      waitReadyMs: null,
      idleProbeMs: null,
      actionMs: 0,
      sampledMs: 0,
      checkpointMs: 0,
      screenshotMs: 0,
      contextCloseMs: 0,
    };
    let sampledStartedAt = 0;
    const waitReady = async () => {
      return await waitForReady(page);
    };
    function fail(message: string): never {
      throw new SanityFailure(`${label}: ${message}`);
    }
    let pageFocus: PageFocus = { lostFocus: false, hidden: false };
    const focusRead = { done: false };
    const osFocus = osFocusMonitor(osFocusSetup);
    const ctx: ActionContext = {
      page,
      designId,
      designUrl,
      run,
      actionName: name,
      options: {
        baseUrl,
        copies,
        runs,
        headless: values.headless,
        screenshots: screenshotMode,
        video,
      },
      constants: CONSTANTS,
      readBoardExtent: () => readBoardExtent(page),
      clearArea: () => readClearArea(page),
      measurePxPerTick: () => measurePxPerTick(page),
      idleFrameMs: null,
      screenCount,
      sampler: {
        start: async () => {
          sampledStartedAt = Date.now();
          osFocus.start();
          await sampler(page).start();
        },
        stop: async () => {
          const sampled = await sampler(page).stop();
          await osFocus.stop();
          pageFocus = await readFocus(page);
          focusRead.done = true;
          timings.sampledMs += Date.now() - sampledStartedAt;
          return sampled;
        },
      },
      async checkpoint(checkpointLabel) {
        const checkpointStartedAt = Date.now();
        const giveUpAt = checkpointStartedAt + CHECKPOINT_LOAD_WAIT_MS;
        let state = await readVisibleScreens(page);
        while (
          (!state.visible || state.loaded < state.visible) &&
          Date.now() < giveUpAt
        ) {
          await page.waitForTimeout(100);
          state = await readVisibleScreens(page);
        }
        if (!state.visible) {
          console.log(
            `${label} ${checkpointLabel} diagnostics: ${JSON.stringify(
              await page.evaluate(() => ({
                clear: window.__bench?.clearArea() ?? null,
                shells: [
                  ...document.querySelectorAll(
                    "[data-screen-shell][data-frame-id]",
                  ),
                ].map((shell) => {
                  const r = shell
                    .querySelector("[data-screen-content]")
                    ?.getBoundingClientRect();
                  return (
                    r && [r.left, r.top, r.width, r.height].map(Math.round)
                  );
                }),
              })),
            )}`,
          );
        }
        let screenshot: string | null = null;
        const blank = !state.visible || state.loaded < state.visible;
        if (
          screenshotMode === "always" ||
          (screenshotMode === "on-failure" && blank)
        ) {
          screenshot = `${runDir}/run-${run}-${name}-${checkpointLabel}.png`;
          const screenshotStartedAt = Date.now();
          await page.screenshot({ path: screenshot });
          timings.screenshotMs += Date.now() - screenshotStartedAt;
        }
        timings.checkpointMs += Date.now() - checkpointStartedAt;
        checkpoints.push({ name: checkpointLabel, ...state, screenshot });
        console.log(
          `${label} ${checkpointLabel}: ${state.visible} visible, ${state.loaded} loaded, ${state.visible - state.loaded} blank [${state.screens.map((s) => s.name ?? s.frameId).join(", ")}]`,
        );
        return state;
      },
      waitReady,
      fail,
    };

    let readyMs: number | null = null;
    let idleFrameMs: number | null = null;
    if (!action.ownsNavigation) {
      const navigatedAt = Date.now();
      timings.contextNavigationMs = navigatedAt - contextStartedAt;
      await page.goto(designUrl, { waitUntil: "domcontentloaded" });
      timings.contextNavigationMs += Date.now() - navigatedAt;
      const readyStartedAt = Date.now();
      const ready = await waitReady();
      timings.waitReadyMs = Date.now() - readyStartedAt;
      readyMs = Date.now() - navigatedAt - READY_STABLE_MS;
      console.log(
        `${label} ready: ${ready.loaded}/${ready.visible} visible screens loaded of ${screenCount} in ${readyMs}ms`,
      );
      const area = await ctx.clearArea();
      if (!area) fail("no canvas area to aim the wheel at");
      await page.mouse.move(
        (area.left + area.right) / 2,
        (area.top + area.bottom) / 2,
      );

      const idleProbeStartedAt = Date.now();
      idleFrameMs = await measureIdleFrameMs(page);
      timings.idleProbeMs = Date.now() - idleProbeStartedAt;
      ctx.idleFrameMs = idleFrameMs;
      console.log(
        `${label} idle frame ${round(idleFrameMs)}ms (~${Math.round(1000 / idleFrameMs)}Hz)`,
      );
    }

    if (action.ownsNavigation) osFocus.start();
    const actionStartedAt = Date.now();
    const { frames, longFrames, extra } = await action.run(ctx);
    timings.actionMs = Date.now() - actionStartedAt;
    await osFocus.stop();
    if (!focusRead.done) pageFocus = await readFocus(page);
    const os = osFocus.summary();
    const focus: FocusState = {
      ...pageFocus,
      osFocusCheck: os.check,
      osFocusReason: os.check === "unavailable" ? os.reason : null,
      osFrontmostOther: os.check === "checked" && os.frontmostOther,
      osOtherApps: os.check === "checked" ? os.otherApps : [],
      osPolls: os.check === "checked" ? os.polls : 0,
    };
    const sorted = [...frames].sort((a, b) => a - b);
    const result: ActionRun = {
      timings,
      readyMs,
      idleFrameMs,
      idleHz: idleFrameMs === null ? null : 1000 / idleFrameMs,
      frameCount: frames.length,
      frameIntervalsMs: frames,
      frameP50Ms: frames.length ? percentile(sorted, 0.5) : null,
      frameP95Ms: frames.length ? percentile(sorted, 0.95) : null,
      frameWorstMs: frames.length ? percentile(sorted, 1) : null,
      framesOver50Ms: frames.filter((ms) => ms > LONG_FRAME_MS).length,
      longAnimationFrames: longFrames,
      longAnimationFrameCount: longFrames.length,
      extra,
      checkpoints,
      video: null,
      focus,
      focusValid: !focus.lostFocus && !focus.hidden,
    };
    if (!result.focusValid) {
      const what = [
        focus.lostFocus && "window lost focus",
        focus.hidden && "page was hidden",
      ]
        .filter(Boolean)
        .join(" and ");
      console.warn(
        `${label} WARNING ${what} during measurement, numbers not valid`,
      );
    }
    if (focus.osFrontmostOther) {
      console.warn(
        `${label} note: another app (${focus.osOtherApps.join(", ")}) was in front; the numbers are still valid`,
      );
    }
    console.log(
      `${label}: p50 ${fmt(result.frameP50Ms)}ms p95 ${fmt(result.frameP95Ms)}ms worst ${fmt(result.frameWorstMs)}ms >50ms ${result.framesOver50Ms} LoAF ${result.longAnimationFrameCount} ${numericExtras(
        extra,
      )
        .map(([key, value]) => `${key} ${Math.round(value)}`)
        .join(" ")} (${result.frameCount} frames)`,
    );
    console.log(
      `${label} timings: context+nav ${timings.contextNavigationMs}ms ready ${fmtMs(timings.waitReadyMs)} idle probe ${fmtMs(timings.idleProbeMs)} action ${timings.actionMs}ms (sampled ${timings.sampledMs}ms, checkpoints ${timings.checkpointMs}ms of which screenshots ${timings.screenshotMs}ms)`,
    );
    return result;
  } catch (error) {
    if (screenshotMode !== "never") {
      const path = `${runDir}/run-${run}-${name}-failure.png`;
      try {
        await page.screenshot({ path });
        failureScreenshots.set(`${run}:${name}`, path);
        console.log(`${label} failure screenshot: ${path}`);
      } catch (shotError) {
        console.warn(`${label} no failure screenshot: ${shotError}`);
      }
    }
    throw error;
  } finally {
    const recording = page.video();
    const closeStartedAt = Date.now();
    await context.close();
    closeMs.set(`${run}:${name}`, Date.now() - closeStartedAt);
    if (recording) {
      videoPath = `${runDir}/run-${run}-${name}.webm`;
      renameSync(await recording.path(), videoPath);
    }
    if (videoPath) console.log(`${label} video: ${videoPath}`);
    videoResults.set(`${run}:${name}`, videoPath);
  }
}

const browserLaunchStartedAt = Date.now();
const browser = await chromium.launch({
  channel: "chromium",
  headless: values.headless,
});
const browserLaunchMs = Date.now() - browserLaunchStartedAt;
const browserVersion = browser.version();
const osFocusSetup = await setupOsFocus();
if (!osFocusSetup.enabled) {
  console.warn(
    `WARNING: OS focus check unavailable (${osFocusSetup.reason}); only the in-page focus guard runs`,
  );
}

if (video) {
  console.warn(
    "WARNING: --video is a debug mode. Recording distorts frame timing; numbers from this run are NOT valid.",
  );
}

if (injectedJank) {
  console.warn(
    `WARNING: --inject-jank ${injectedJank.busyMs}@${injectedJank.everyMs} blocks the main thread on purpose. These numbers are a test of the benchmark, not a measurement.`,
  );
}
if (breakInput) {
  console.warn(
    "WARNING: --break-input swallows canvas input during sampling. Test-only: actions are expected to exit 2.",
  );
}

const results: RunResult[] = [];
const failures: ActionFailure[] = [];
const videoResults = new Map<string, string | null>();
const closeMs = new Map<string, number>();
let failure: unknown;
try {
  mkdirSync(runDir, { recursive: true });
  for (let run = 1; run <= runs; run += 1) {
    const result: RunResult = { run, actions: {} };
    for (const action of actions) {
      try {
        result.actions[action.name] = await measureAction(action, run);
      } catch (error) {
        if (error instanceof DesignUnavailable) throw error;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`run ${run} [${action.name}] FAILED: ${message}`);
        failures.push({
          run,
          action: action.name,
          message,
          screenshot: failureScreenshots.get(`${run}:${action.name}`) ?? null,
        });
      }
    }
    results.push(result);
  }
} catch (error) {
  failure = error;
}

const cleanupStartedAt = Date.now();
await browser.close();
const cleanupError = await deleteSeededDesignOrReport();
const cleanupMs = Date.now() - cleanupStartedAt;
const aborted = failure
  ? failure instanceof Error
    ? failure.message
    : String(failure)
  : null;
if (failure) console.error("canvas bench could not measure:", failure);
for (const result of results) {
  for (const [name, entry] of Object.entries(result.actions)) {
    entry.video = videoResults.get(`${result.run}:${name}`) ?? null;
    entry.timings.contextCloseMs = closeMs.get(`${result.run}:${name}`) ?? 0;
  }
}

const medianOf = (values: (number | null)[]) => {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? median(present) : null;
};
for (const action of actions) {
  const entries = results.flatMap(
    (result) => result.actions[action.name] ?? [],
  );
  if (!entries.length) continue;
  const extraKeys = [
    ...new Set(entries.flatMap((e) => numericExtras(e.extra).map(([k]) => k))),
  ];
  const extras = extraKeys
    .map((key) => {
      const value = medianOf(
        entries.map((e) =>
          typeof e.extra[key] === "number" ? (e.extra[key] as number) : null,
        ),
      );
      return `${key} ${value === null ? "n/a" : Math.round(value)}`;
    })
    .join(" ");
  const ready = medianOf(entries.map((e) => e.readyMs));
  const idle = medianOf(entries.map((e) => e.idleFrameMs));
  console.log(
    `median [${action.name}]: p50 ${fmt(medianOf(entries.map((e) => e.frameP50Ms)))}ms p95 ${fmt(medianOf(entries.map((e) => e.frameP95Ms)))}ms worst ${fmt(medianOf(entries.map((e) => e.frameWorstMs)))}ms >50ms ${median(entries.map((e) => e.framesOver50Ms))} LoAF ${median(entries.map((e) => e.longAnimationFrameCount))} ${extras} ready ${ready === null ? "n/a" : `${Math.round(ready)}ms`} idle ${idle === null ? "n/a" : `${round(idle)}ms`}`,
  );
}
const numbersInvalidReasons: string[] = [];
if (aborted) numbersInvalidReasons.push(`run aborted: ${aborted}`);
const focusWarnings: string[] = [];
if (video)
  numbersInvalidReasons.push("--video debug run distorts frame timing");
if (values.headless) {
  numbersInvalidReasons.push(
    "--headless: not representative of headed rendering",
  );
}
for (const result of results) {
  for (const [name, entry] of Object.entries(result.actions)) {
    if (entry.focus.lostFocus) {
      numbersInvalidReasons.push(`run ${result.run} [${name}]: lost focus`);
    }
    if (entry.focus.hidden) {
      numbersInvalidReasons.push(`run ${result.run} [${name}]: page hidden`);
    }
    if (entry.focus.osFrontmostOther) {
      focusWarnings.push(
        `run ${result.run} [${name}]: another app (${entry.focus.osOtherApps.join(", ")}) was in front`,
      );
    }
  }
}
const sumTimings = (key: keyof ActionTimings) =>
  results.reduce(
    (total, result) =>
      total +
      Object.values(result.actions).reduce(
        (sum, entry) => sum + (entry.timings[key] ?? 0),
        0,
      ),
    0,
  );
const timings = {
  seedMs,
  designCheckMs,
  browserLaunchMs,
  contextNavigationMs: sumTimings("contextNavigationMs"),
  waitReadyMs: sumTimings("waitReadyMs"),
  idleProbeMs: sumTimings("idleProbeMs"),
  actionMs: sumTimings("actionMs"),
  sampledMs: sumTimings("sampledMs"),
  checkpointMs: sumTimings("checkpointMs"),
  screenshotMs: sumTimings("screenshotMs"),
  contextCloseMs: sumTimings("contextCloseMs"),
  cleanupMs,
  totalMs: Date.now() - invocationStartedAt,
};
console.log(
  `timings: ${Object.entries(timings)
    .map(([key, value]) => `${key.replace(/Ms$/, "")} ${value}ms`)
    .join(", ")}`,
);
const outPath = `${runDir}/canvas-bench.json`;
writeFileSync(
  outPath,
  JSON.stringify(
    {
      timestamp: startedAt,
      debug: video,
      injectedJank,
      breakInput,
      timings,
      designReused: designReused && !designReseeds.length,
      designKept: keepDesign,
      designReseeds,
      screenshots: screenshotMode,
      failures,
      aborted,
      cleanupError,
      numbersValid: numbersInvalidReasons.length === 0,
      numbersInvalidReasons,
      focusWarnings,
      osFocusCheck: osFocusSetup.enabled ? "enabled" : "unavailable",
      osFocusReason: osFocusSetup.enabled ? null : osFocusSetup.reason,
      browserPid: osFocusSetup.enabled ? osFocusSetup.browserPid : null,
      browser: {
        channel: "chromium",
        version: browserVersion,
        headless: values.headless,
      },
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      designId,
      screenCount,
      copies: sourceDesign || values.design !== undefined ? null : copies,
      source: sourceDesign,
      actionNames,
      constants: CONSTANTS,
      runs: results,
    },
    null,
    2,
  ),
);
if (numbersInvalidReasons.length) {
  console.warn(
    `WARNING: numbers are not valid (numbersValid: false): ${numbersInvalidReasons.join("; ")}`,
  );
}
console.log(`wrote ${outPath}`);
if (aborted || cleanupError) process.exit(2);
if (failures.length) {
  console.error(`${failures.length} action run(s) failed:`);
  for (const f of failures) {
    console.error(`  run ${f.run} [${f.action}]: ${f.message}`);
  }
  process.exit(2);
}
