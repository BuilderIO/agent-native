import {
  READY_STABLE_MS,
  type ClearArea,
  type Milestones,
  type ActionContext,
  type CanvasBenchAction,
} from "../lib.ts";

const LOAD_TIMEOUT_MS = 60_000;
const POLL_MS = 100;

const loadWatcher = (config: { pollMs: number; stableMs: number }) => {
  if (window.top !== window) return;
  const bench = window.__bench;
  if (!bench) return;
  const state: Milestones & { done: boolean } = {
    canvasMountedMs: null,
    firstScreenDrawnMs: null,
    allVisibleReadyMs: null,
    visibleScreenCount: 0,
    frames: [],
    longFrames: [],
    done: false,
  };
  window.__loadBench = state;
  bench.frames = [];
  bench.longFrames = [];
  bench.sampling = true;

  const surfaceSelector = "[data-multi-screen-canvas-surface]";
  const observer = new MutationObserver(() => {
    if (document.querySelector(surfaceSelector)) {
      state.canvasMountedMs = performance.now();
      observer.disconnect();
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  const STEP = 4;
  let cached: ClearArea | null = null;
  const surfaceHits = (x: number, y: number) => {
    const surface = document.querySelector(surfaceSelector);
    const hit = document.elementFromPoint(x, y);
    return !!surface && !!hit && surface.contains(hit);
  };
  const stillValid = (area: ClearArea) => {
    const surface = document.querySelector(surfaceSelector);
    if (!surface) return false;
    const bounds = surface.getBoundingClientRect();
    const cy = (area.top + area.bottom) / 2;
    const cx = (area.left + area.right) / 2;
    const inside =
      surfaceHits(area.left + 1, cy) &&
      surfaceHits(area.right - 1, cy) &&
      surfaceHits(cx, area.top + 1) &&
      surfaceHits(cx, area.bottom - 1);
    const sealed =
      (area.left <= bounds.left || !surfaceHits(area.left - STEP, cy)) &&
      (area.right >= bounds.right || !surfaceHits(area.right + STEP, cy)) &&
      (area.top <= bounds.top || !surfaceHits(cx, area.top - STEP)) &&
      (area.bottom >= bounds.bottom || !surfaceHits(cx, area.bottom + STEP));
    return inside && sealed;
  };
  const clearArea = () => {
    if (cached && stillValid(cached)) return cached;
    cached = bench.clearArea();
    return cached;
  };

  const visibleScreens = (clear: ClearArea) => {
    const ids: string[] = [];
    let loaded = 0;
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
      const frameId = shell.getAttribute("data-frame-id");
      if (!content || !frameId) continue;
      ids.push(frameId);
      const frames = content.querySelectorAll(
        "iframe[data-design-preview-iframe], iframe[data-screen-static-preview]",
      );
      if ([...frames].some((f) => f.hasAttribute("data-bench-loaded"))) {
        loaded += 1;
      }
    }
    return { visible: ids.length, loaded, signature: ids.sort().join(",") };
  };

  let stable: {
    since: number;
    signature: string;
    visible: number;
    frameCount: number;
    longFrameCount: number;
  } | null = null;
  const poll = () => {
    if (state.canvasMountedMs !== null) {
      const now = performance.now();
      const clear = clearArea();
      const { visible, loaded, signature } = clear
        ? visibleScreens(clear)
        : { visible: 0, loaded: 0, signature: "" };
      if (state.firstScreenDrawnMs === null && loaded > 0) {
        state.firstScreenDrawnMs = now;
      }
      const camera = document.querySelector<HTMLElement>(
        "[data-multi-screen-canvas-world]",
      )?.style.transform;
      if (camera && visible > 0 && loaded === visible) {
        if (!stable || stable.signature !== signature) {
          stable = {
            since: now,
            signature,
            visible,
            frameCount: bench.frames.length,
            longFrameCount: bench.longFrames.length,
          };
        }
        if (now - stable.since >= config.stableMs) {
          bench.sampling = false;
          state.allVisibleReadyMs = stable.since;
          state.visibleScreenCount = stable.visible;
          state.frames = bench.frames.slice(0, stable.frameCount + 2);
          state.longFrames = bench.longFrames.slice(0, stable.longFrameCount);
          state.done = true;
          return;
        }
      } else {
        stable = null;
      }
    }
    setTimeout(poll, config.pollMs);
  };
  setTimeout(poll, config.pollMs);
};

const action: CanvasBenchAction = {
  name: "load",
  ownsNavigation: true,
  async run(ctx: ActionContext) {
    const { page, run } = ctx;
    await page.addInitScript(loadWatcher, {
      pollMs: POLL_MS,
      stableMs: READY_STABLE_MS,
    });
    await page.goto(ctx.designUrl, { waitUntil: "domcontentloaded" });

    const armed = await page.evaluate(
      () => !!window.__bench && !!window.__loadBench,
    );
    if (!armed) {
      ctx.fail("load watcher or harness __bench sampler is not active");
    }

    try {
      await page.waitForFunction(() => window.__loadBench?.done, null, {
        timeout: LOAD_TIMEOUT_MS,
        polling: 100,
      });
    } catch {
      const partial = await page
        .evaluate(() => {
          const s = window.__loadBench;
          return s
            ? {
                canvasMountedMs: s.canvasMountedMs,
                firstScreenDrawnMs: s.firstScreenDrawnMs,
              }
            : null;
        })
        .catch((error: unknown) => ({
          unreadable: error instanceof Error ? error.message : String(error),
        }));
      ctx.fail(
        `ready not reached within ${LOAD_TIMEOUT_MS / 1000}s ${JSON.stringify(partial)}`,
      );
    }

    const result = await page.evaluate(() => {
      const s = window.__loadBench;
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceEntry
        | undefined;
      const memory = (
        performance as Performance & {
          memory?: { usedJSHeapSize: number };
        }
      ).memory;
      if (!s || !nav) return null;
      return {
        ...s,
        domContentLoadedMs: (nav as PerformanceNavigationTiming)
          .domContentLoadedEventStart,
        heapUsedBytes: memory?.usedJSHeapSize ?? null,
      };
    });

    if (!result) ctx.fail("load milestones or navigation timing unavailable");
    if (!result.visibleScreenCount) ctx.fail("zero visible screens at ready");
    if (
      result.canvasMountedMs === null ||
      result.firstScreenDrawnMs === null ||
      result.allVisibleReadyMs === null ||
      result.heapUsedBytes === null
    ) {
      ctx.fail(`a milestone was not recorded: ${JSON.stringify(result)}`);
    }
    const ready = await ctx.checkpoint("ready");
    if (!ready.visible)
      ctx.fail(`run ${run}: ready checkpoint shows no screens`);

    const r = (n: number) => Math.round(n * 10) / 10;
    return {
      frames: result.frames,
      longFrames: result.longFrames,
      extra: {
        domContentLoadedMs: r(result.domContentLoadedMs),
        canvasMountedMs: r(result.canvasMountedMs),
        firstScreenDrawnMs: r(result.firstScreenDrawnMs),
        allVisibleReadyMs: r(result.allVisibleReadyMs),
        visibleScreenCount: result.visibleScreenCount,
        heapUsedMb: r(result.heapUsedBytes / 1024 / 1024),
      },
    };
  },
};

export default action;
