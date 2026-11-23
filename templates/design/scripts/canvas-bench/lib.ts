// Shared by the harness (canvas-bench.ts) and every action in ./actions. This
// module has no side effects, so actions can import it freely; never import
// canvas-bench.ts from an action, it runs the whole benchmark on load.
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

// A step did not take effect, so nothing was measured for that action: it is
// recorded as a failure and the invocation exits 2.
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
};
export type Checkpoint = VisibleScreens & {
  name: string;
  screenshot: string | null;
};
export type ScreenshotMode = "on-failure" | "always" | "never";
export type Sampled = { frames: number[]; longFrames: number[] };

export type ActionResult = {
  /** rAF intervals (ms) sampled while the action drove the canvas. */
  frames: number[];
  /** Long Animation Frame durations (ms) from the same window. */
  longFrames: number[];
  /** Action-specific metrics. Top-level numbers also feed the console lines. */
  extra: Record<string, unknown>;
};

export type ActionContext = {
  page: Page;
  designId: string;
  designUrl: string;
  /** 1-based run number. */
  run: number;
  actionName: string;
  /** Harness pre-action idle rAF median (ms); null for ownsNavigation actions. */
  idleFrameMs: number | null;
  options: {
    baseUrl: string;
    copies: number;
    runs: number;
    headless: boolean;
    screenshots: ScreenshotMode;
    video: boolean;
  };
  constants: typeof CONSTANTS;
  /** Viewport-pixel rects of the board and the unobscured canvas area. */
  readBoardExtent(): Promise<BoardExtent | null>;
  clearArea(): Promise<ClearArea | null>;
  /** Wheel-calibrates camera pixels per tick (scrolls 5 ticks forward and back). */
  measurePxPerTick(): Promise<number>;
  /** Samples rAF intervals and LoAFs between start() and stop(). */
  sampler: { start(): Promise<void>; stop(): Promise<Sampled> };
  /** Records visible screens and, per --screenshots, run-<n>-<action>-<label>.png. */
  checkpoint(label: string): Promise<VisibleScreens>;
  /** Waits until every visible screen loaded and held for READY_STABLE_MS. */
  waitReady(): Promise<VisibleScreens>;
  /** Throws a SanityFailure: the harness records the failure for this run and action, goes on, and exits 2 at the end. */
  fail(message: string): never;
};

export type CanvasBenchAction = {
  /** Must equal the file name: actions/<name>.ts. */
  name: string;
  /**
   * true: the harness hands over a fresh page and neither navigates, waits for
   * readiness, nor measures idle frames (for cold-load actions).
   */
  ownsNavigation?: boolean;
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

export const readClearArea = (target: Page): Promise<ClearArea | null> =>
  target.evaluate(
    () => (window as any).__bench.clearArea() as ClearArea | null,
  );

// Visible screens are those whose content box intersects the unobscured canvas area; each
// must hold at least one iframe (live editor or static preview) that loaded.
export const readVisibleScreens = (target: Page): Promise<VisibleScreens> =>
  target.evaluate(() => {
    const clear = (window as any).__bench.clearArea() as ClearArea | null;
    const screens: VisibleScreens["screens"] = [];
    if (!clear) return { visible: 0, loaded: 0, screens };
    for (const shell of document.querySelectorAll(
      "[data-screen-shell][data-frame-id]",
    )) {
      const content = shell.querySelector("[data-screen-content]");
      const rect = content?.getBoundingClientRect();
      if (
        !rect ||
        rect.width <= 24 ||
        rect.right <= clear.left ||
        rect.bottom <= clear.top ||
        rect.left >= clear.right ||
        rect.top >= clear.bottom
      ) {
        continue;
      }
      const frames = [
        ...content!.querySelectorAll(
          "iframe[data-design-preview-iframe], iframe[data-screen-static-preview]",
        ),
      ];
      const title = shell.querySelector("[data-frame-title]");
      const titleInput = shell.querySelector<HTMLInputElement>(
        "input[data-frame-title-input]",
      );
      screens.push({
        frameId: shell.getAttribute("data-frame-id")!,
        name: (title?.textContent || titleInput?.value || "").trim() || null,
        loaded: frames.some((frame) => frame.hasAttribute("data-bench-loaded")),
      });
    }
    return {
      visible: screens.length,
      loaded: screens.filter((screen) => screen.loaded).length,
      screens,
    };
  });

// Rects are in viewport pixels; `clear` excludes the panels overlaying the canvas.
export const readBoardExtent = (target: Page): Promise<BoardExtent | null> =>
  target.evaluate(() => {
    const clear = (window as any).__bench.clearArea() as ClearArea | null;
    const shells = [
      ...document.querySelectorAll("[data-screen-shell][data-frame-id]"),
    ];
    if (!clear || !shells.length) return null;
    const rects = shells.map((shell) => shell.getBoundingClientRect());
    return {
      clear,
      boardTop: Math.min(...rects.map((r) => r.top)),
      boardBottom: Math.max(...rects.map((r) => r.bottom)),
    };
  });

export async function wheelTicks(page: Page, ticks: number, sign: number) {
  for (let tick = 0; tick < ticks; tick += 1) {
    await page.mouse.wheel(0, sign * WHEEL_DELTA_Y);
    await page.waitForTimeout(WHEEL_TICK_INTERVAL_MS);
  }
}

// One tick forward and back, so the leg length comes from the measured ratio
// instead of an assumed 1:1 between wheel delta and camera pixels.
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
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
export const median = (numbers: number[]) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
export const round = (value: number) => Math.round(value * 10) / 10;

export type FrontApp = { pid: number; name: string };
/** One poll of the frontmost app; null when lsappinfo output was unreadable. */
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

// lsappinfo prints `"key"="value"` for strings and `"key"=123` for numbers.
export function parseLsappinfoValue(output: string, key: string) {
  const match = new RegExp(`"${key}"\\s*=\\s*(.+)`).exec(output);
  if (!match) return null;
  return match[1]!.trim().replace(/^"(.*)"$/, "$1");
}

// `lsappinfo front` prints e.g. `ASN:0x0-0x10010:`.
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

// Playwright spawns the browser as a child of this process with
// --remote-debugging-pipe; helper processes carry --type=. Input is
// `ps -A -o pid=,ppid=,command=`. Ambiguity returns null, never a guess.
export function findBrowserPid(psOutput: string, parentPid: number) {
  const pids: number[] = [];
  for (const line of psOutput.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match || Number(match[2]) !== parentPid) continue;
    const command = match[3]!;
    if (command.includes("--type=")) continue;
    if (!command.includes("--remote-debugging-pipe")) continue;
    pids.push(Number(match[1]));
  }
  return pids.length === 1 ? pids[0]! : null;
}

// Matches by PID, so a browser renamed or running next to another Chromium is
// still told apart. A poll that could not be read is counted, not assumed fine.
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
