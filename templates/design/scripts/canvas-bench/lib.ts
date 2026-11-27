import { execFileSync } from "node:child_process";
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";

import type { Page } from "@playwright/test";

export const VIEWPORT = { width: 1280, height: 720 };
export const DEVICE_SCALE_FACTOR = 2;
export const MAX_WHEEL_TICKS_PER_LEG = 1500;
export const WHEEL_DELTA_Y = 120;
export const WHEEL_TICK_INTERVAL_MS = 16;
export const SETTLE_AFTER_LEG_MS = 500;
export const READY_TIMEOUT_MS = 180_000;
export const READY_STABLE_MS = 1500;
export const LONG_FRAME_MS = 50;
export const MIN_CAMERA_TRAVEL_PX = 100;
export const IDLE_SAMPLE_MS = 1000;
export const CHECKPOINT_LOAD_WAIT_MS = 3000;

export const CONSTANTS = {
  MAX_WHEEL_TICKS_PER_LEG,
  WHEEL_DELTA_Y,
  WHEEL_TICK_INTERVAL_MS,
  SETTLE_AFTER_LEG_MS,
  READY_STABLE_MS,
  LONG_FRAME_MS,
  IDLE_SAMPLE_MS,
  CHECKPOINT_LOAD_WAIT_MS,
  MIN_CAMERA_TRAVEL_PX,
};

export class SanityFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SanityFailure";
  }
}

export type ClearArea = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type BenchHook = {
  longFrames: number[];
  frames: number[];
  sampling: boolean;
  focus: { lostFocus: boolean; hidden: boolean; blurs: number };
  clearArea: () => ClearArea | null;
};
export type Milestones = {
  canvasMountedMs: number | null;
  firstScreenDrawnMs: number | null;
  allVisibleReadyMs: number | null;
  visibleScreenCount: number;
  frames: number[];
  longFrames: number[];
};
export type LatencyProbe = {
  pending: number[];
  latencies: number[];
  on: boolean;
};
export type ZoomSample = { tMs: number; live: number; static: number };
export type ZoomTracker = { samples: ZoomSample[]; timer: number };
export type IdleBusy = { longTaskMs: number; longTasks: number };
export type LivePeak = {
  max: number;
  ids: Set<string>;
  timer: number;
};

declare global {
  interface Window {
    __bench?: BenchHook;
    __loadBench?: Milestones & { done: boolean };
    __dragProbe?: LatencyProbe;
    __zoomTracker?: ZoomTracker;
    __idleBusy?: IdleBusy;
    __idleBusyObserver?: PerformanceObserver;
    __livePeak?: LivePeak;
  }
}

export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new SanityFailure(`${what} is missing`);
  }
  return value;
}
export type Camera = { x: number; y: number; scale: number };
export type VisibleScreens = {
  visible: number;
  loaded: number;
  screens: { frameId: string; name: string | null; loaded: boolean }[];
};
export type BoardExtent = {
  clear: ClearArea;
  boardTop: number;
  boardBottom: number;
  columnBottom: number | null;
};
export type Checkpoint = VisibleScreens & {
  name: string;
  screenshot: string | null;
};
export type ScreenshotMode = "on-failure" | "always" | "never";
export type Sampled = { frames: number[]; longFrames: number[] };

export type ActionResult = {
  frames: number[];
  longFrames: number[];
  extra: Record<string, unknown>;
};

export type ActionContext = {
  page: Page;
  designId: string;
  designUrl: string;
  run: number;
  actionName: string;
  idleFrameMs: number | null;
  screenCount: number;
  options: {
    baseUrl: string;
    copies: number;
    runs: number;
    headless: boolean;
    screenshots: ScreenshotMode;
    video: boolean;
  };
  constants: typeof CONSTANTS;
  readBoardExtent(): Promise<BoardExtent | null>;
  clearArea(): Promise<ClearArea | null>;
  measurePxPerTick(): Promise<number>;
  sampler: { start(): Promise<void>; stop(): Promise<Sampled> };
  checkpoint(label: string): Promise<VisibleScreens>;
  waitReady(): Promise<VisibleScreens>;
  fail(message: string): never;
};

export type CanvasBenchAction = {
  name: string;
  ownsNavigation?: boolean;
  mutatesDesign?: boolean;
  run(ctx: ActionContext): Promise<ActionResult>;
};

export const readCamera = (target: Page): Promise<Camera | null> =>
  target.evaluate(() => {
    const transform = document.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    )?.style.transform;
    if (!transform) return null;
    const matrix = new DOMMatrixReadOnly(transform);
    return { x: matrix.m41, y: matrix.m42, scale: matrix.a };
  });

export async function waitForCameraRest(
  page: Page,
  restMs = 400,
  timeoutMs = 10_000,
): Promise<Camera> {
  const giveUpAt = Date.now() + timeoutMs;
  let last = required(await readCamera(page), "canvas camera");
  let stillSince = Date.now();
  while (Date.now() < giveUpAt) {
    await page.waitForTimeout(50);
    const now = required(await readCamera(page), "canvas camera");
    if (
      Math.hypot(now.x - last.x, now.y - last.y) > 0.5 ||
      Math.abs(now.scale - last.scale) > 1e-6
    ) {
      last = now;
      stillSince = Date.now();
    } else if (Date.now() - stillSince >= restMs) {
      return now;
    }
  }
  throw new SanityFailure(
    `canvas camera did not come to rest in ${timeoutMs}ms`,
  );
}

export const readClearArea = (target: Page): Promise<ClearArea | null> =>
  target.evaluate(() => window.__bench?.clearArea() ?? null);

export const readVisibleScreens = (target: Page): Promise<VisibleScreens> =>
  target.evaluate(() => {
    const clear = window.__bench?.clearArea() ?? null;
    const screens: VisibleScreens["screens"] = [];
    if (!clear) return { visible: 0, loaded: 0, screens };
    for (const shell of document.querySelectorAll(
      "[data-screen-shell][data-frame-id]",
    )) {
      const frameId = shell.getAttribute("data-frame-id");
      const inView = [
        ...shell.querySelectorAll("[data-screen-content]"),
      ].filter((content) => {
        const rect = content.getBoundingClientRect();
        return (
          rect.width > 24 &&
          rect.right > clear.left &&
          rect.bottom > clear.top &&
          rect.left < clear.right &&
          rect.top < clear.bottom
        );
      });
      if (!frameId || !inView.length) continue;
      const copiesWithFrames = inView
        .map((content) => [
          ...content.querySelectorAll(
            "iframe[data-design-preview-iframe], iframe[data-screen-static-preview]",
          ),
        ])
        .filter((frames) => frames.length);
      const loaded =
        copiesWithFrames.length > 0 &&
        copiesWithFrames.every((frames) =>
          frames.some((frame) => frame.hasAttribute("data-bench-loaded")),
        );
      const title = shell.querySelector("[data-frame-title]");
      const titleInput = shell.querySelector<HTMLInputElement>(
        "input[data-frame-title-input]",
      );
      screens.push({
        frameId,
        name: (title?.textContent || titleInput?.value || "").trim() || null,
        loaded,
      });
    }
    return {
      visible: screens.length,
      loaded: screens.filter((screen) => screen.loaded).length,
      screens,
    };
  });

export type ShellOrigins = Map<string, { left: number; top: number }>;
export const readShellOrigins = async (target: Page): Promise<ShellOrigins> =>
  new Map(
    await target.evaluate(() =>
      [
        ...document.querySelectorAll("[data-screen-shell][data-frame-id]"),
      ].flatMap((shell) => {
        const frameId = shell.getAttribute("data-frame-id");
        const { left, top } = shell.getBoundingClientRect();
        return frameId ? [[frameId, { left, top }] as const] : [];
      }),
    ),
  );

export const readBoardExtent = (target: Page): Promise<BoardExtent | null> =>
  target.evaluate(() => {
    const clear = window.__bench?.clearArea() ?? null;
    const shells = [
      ...document.querySelectorAll("[data-screen-shell][data-frame-id]"),
    ];
    if (!clear || !shells.length) return null;
    const rects = shells.map((shell) => shell.getBoundingClientRect());
    const inColumn = rects.filter(
      (r) => r.right > clear.left && r.left < clear.right,
    );
    return {
      clear,
      boardTop: Math.min(...rects.map((r) => r.top)),
      boardBottom: Math.max(...rects.map((r) => r.bottom)),
      columnBottom: inColumn.length
        ? Math.max(...inColumn.map((r) => r.bottom))
        : null,
    };
  });

export async function wheelTicks(page: Page, ticks: number, sign: number) {
  for (let tick = 0; tick < ticks; tick += 1) {
    await page.mouse.wheel(0, sign * WHEEL_DELTA_Y);
    await page.waitForTimeout(WHEEL_TICK_INTERVAL_MS);
  }
}

export async function measurePxPerTick(page: Page): Promise<number> {
  const before = await readCamera(page);
  if (!before)
    throw new SanityFailure("canvas camera is unavailable before calibration");
  const CALIBRATION_TICKS = 5;
  await wheelTicks(page, CALIBRATION_TICKS, 1);
  await page.waitForTimeout(SETTLE_AFTER_LEG_MS);
  const moved = await readCamera(page);
  await wheelTicks(page, CALIBRATION_TICKS, -1);
  await page.waitForTimeout(SETTLE_AFTER_LEG_MS);
  const back = await readCamera(page);
  if (!moved || !back)
    throw new SanityFailure("canvas camera vanished during calibration");
  const pxPerTick = Math.abs(moved.y - before.y) / CALIBRATION_TICKS;
  if (pxPerTick < 1 || Math.abs(back.y - before.y) > 1) {
    throw new SanityFailure(
      `wheel calibration failed: ${JSON.stringify({ before, moved, back })}`,
    );
  }
  return pxPerTick;
}

export const percentile = (sorted: number[], p: number) =>
  required(
    sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)],
    "percentile sample",
  );
export const median = (numbers: number[]) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const at = (index: number) => required(sorted[index], "median sample");
  return sorted.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
};
export const round = (value: number) => Math.round(value * 10) / 10;

export type FrontApp = { pid: number; name: string };
export type FrontSample = FrontApp | null;
export type OsFocusSummary =
  | {
      check: "checked";
      frontmostOther: boolean;
      otherApps: string[];
      polls: number;
      unreadablePolls: number;
    }
  | { check: "unavailable"; reason: string };

export function parseLsappinfoValue(output: string, key: string) {
  const match = new RegExp(`"${key}"\\s*=\\s*(.+)`).exec(output);
  if (!match) return null;
  return required(match[1], "lsappinfo value")
    .trim()
    .replace(/^"(.*)"$/, "$1");
}

export const parseAsn = (output: string) =>
  /^ASN:[0-9a-fx-]+:?$/i.test(output.trim()) ? output.trim() : null;

export function parseFrontApp(
  nameOutput: string,
  pidOutput: string,
): FrontSample {
  const name = parseLsappinfoValue(nameOutput, "LSDisplayName");
  const pid = Number(parseLsappinfoValue(pidOutput, "pid"));
  return name && Number.isInteger(pid) && pid > 0 ? { pid, name } : null;
}

export function findBrowserPid(psOutput: string, parentPid: number) {
  const pids: number[] = [];
  for (const line of psOutput.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match || Number(match[2]) !== parentPid) continue;
    const command = required(match[3], "ps command");
    if (command.includes("--type=")) continue;
    if (!command.includes("--remote-debugging-pipe")) continue;
    pids.push(Number(match[1]));
  }
  return pids.length === 1 ? required(pids[0], "browser pid") : null;
}

export function summarizeOsFocus(
  samples: FrontSample[],
  browserPid: number,
): OsFocusSummary {
  const readable = samples.filter((s): s is FrontApp => s !== null);
  if (!readable.length) {
    return {
      check: "unavailable",
      reason: `lsappinfo output was unreadable in all ${samples.length} polls`,
    };
  }
  const others = readable.filter((s) => s.pid !== browserPid);
  return {
    check: "checked",
    frontmostOther: others.length > 0,
    otherApps: [...new Set(others.map((s) => s.name))],
    polls: samples.length,
    unreadablePolls: samples.length - readable.length,
  };
}

export const BENCH_LOCK_PATH = `${tmpdir()}/agent-native-canvas-bench.lock`;

type LockOwner = {
  pid: number;
  processStart: string;
  acquiredAt: string;
  cwd: string;
  command: string;
};

export class BenchLockHeld extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchLockHeld";
  }
}

function readProcessStart(pid: number): string | null {
  try {
    return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    }).trim();
  } catch (error) {
    if ((error as { status?: number }).status === 1) return null;
    throw error;
  }
}

type LockHolder = "alive" | "gone" | "pid-reused";

function classifyLockHolder(owner: LockOwner): LockHolder {
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if ((error as { code?: string }).code === "ESRCH") return "gone";
    if ((error as { code?: string }).code !== "EPERM") throw error;
  }
  const start = readProcessStart(owner.pid);
  if (start === null) return "gone";
  return start === owner.processStart ? "alive" : "pid-reused";
}

function readLock(): { raw: string; owner: LockOwner } | null {
  let raw: string;
  try {
    raw = readFileSync(BENCH_LOCK_PATH, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
  let owner: LockOwner;
  try {
    owner = JSON.parse(raw) as LockOwner;
  } catch {
    // coercion-ok: an unreadable lock is reported, never treated as stale
    throw new BenchLockHeld(
      `${BENCH_LOCK_PATH} exists but is not readable JSON; check that no benchmark is running, then delete it`,
    );
  }
  if (!Number.isInteger(owner.pid) || typeof owner.processStart !== "string") {
    throw new BenchLockHeld(
      `${BENCH_LOCK_PATH} has an unexpected format; check that no benchmark is running, then delete it`,
    );
  }
  return { raw, owner };
}

export function liveBenchLockHolder(): string | null {
  const held = readLock();
  if (!held || classifyLockHolder(held.owner) !== "alive") return null;
  return `pid ${held.owner.pid}: ${held.owner.command}`;
}

export function acquireBenchLock(command: string): () => void {
  const self: LockOwner = {
    pid: process.pid,
    processStart: required(
      readProcessStart(process.pid),
      "this process's start time",
    ),
    acquiredAt: new Date().toISOString(),
    cwd: process.cwd(),
    command,
  };
  const staging = `${BENCH_LOCK_PATH}.${process.pid}.tmp`;
  const stale = `${BENCH_LOCK_PATH}.${process.pid}.stale`;
  const tryCreate = () => {
    const fd = openSync(staging, "w");
    try {
      writeSync(fd, JSON.stringify(self, null, 2));
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(staging, BENCH_LOCK_PATH);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "EEXIST") return false;
      throw error;
    } finally {
      unlinkSync(staging);
    }
  };
  const removeStale = (held: { raw: string }) => {
    try {
      renameSync(BENCH_LOCK_PATH, stale);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return;
      throw error;
    }
    const moved = readFileSync(stale, "utf8");
    if (moved === held.raw) {
      unlinkSync(stale);
      return;
    }
    try {
      linkSync(stale, BENCH_LOCK_PATH);
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    } finally {
      unlinkSync(stale);
    }
  };
  const ATTEMPTS = 5;
  let acquired = false;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (tryCreate()) {
      acquired = true;
      break;
    }
    const held = readLock();
    if (!held) continue;
    const holder = classifyLockHolder(held.owner);
    if (holder === "alive") {
      throw new BenchLockHeld(
        `another canvas benchmark is running (pid ${held.owner.pid}, started ${held.owner.acquiredAt}, in ${held.owner.cwd}: ${held.owner.command}). Two runs at once ruin each other's numbers. Wait for it to finish; the lock is ${BENCH_LOCK_PATH}`,
      );
    }
    console.warn(
      `removing stale benchmark lock left by pid ${held.owner.pid} (${holder === "gone" ? "no longer running" : "the pid now belongs to another process"})`,
    );
    removeStale(held);
  }
  if (!acquired && !tryCreate()) {
    throw new BenchLockHeld(
      `could not take ${BENCH_LOCK_PATH}: another process keeps recreating it`,
    );
  }
  if (readLock()?.owner.pid !== process.pid) {
    throw new BenchLockHeld(`could not take ${BENCH_LOCK_PATH}`);
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (readLock()?.owner.pid === process.pid) unlinkSync(BENCH_LOCK_PATH);
  };
  process.on("exit", release);
  return release;
}
