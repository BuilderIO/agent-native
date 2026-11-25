import {
  MAX_WHEEL_TICKS_PER_LEG,
  SETTLE_AFTER_LEG_MS,
  WHEEL_DELTA_Y,
  WHEEL_TICK_INTERVAL_MS,
  readCamera,
  round,
  type ActionContext,
  type CanvasBenchAction,
} from "../lib.ts";

const TARGET_SCALE = 1;
const MIN_REACHED_FRACTION = 0.8;
const MAX_RETURN_DRIFT = 0.1;
const CALIBRATION_TICKS = 4;
const LIVE_IFRAMES = "iframe[data-design-preview-iframe]";
const STATIC_PREVIEWS = "iframe[data-screen-static-preview]";

type Leg = {
  direction: "in" | "out";
  frames: number[];
  longFrames: number[];
  timeline: { tMs: number; live: number; static: number }[];
};

async function readScale(ctx: ActionContext, when: string): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const camera = await readCamera(ctx.page);
    if (camera) return camera.scale;
    await ctx.page.waitForTimeout(100);
  }
  ctx.fail(`canvas camera is unavailable ${when}`);
}

const countLive = (ctx: ActionContext) =>
  ctx.page.locator(LIVE_IFRAMES).count();

const startTracker = (ctx: ActionContext) =>
  ctx.page.evaluate(
    ({ live, previews }) => {
      const t0 = performance.now();
      const tracker = {
        samples: [] as { tMs: number; live: number; static: number }[],
        timer: 0,
      };
      tracker.timer = window.setInterval(() => {
        tracker.samples.push({
          tMs: performance.now() - t0,
          live: document.querySelectorAll(live).length,
          static: document.querySelectorAll(previews).length,
        });
      }, 50);
      window.__zoomTracker = tracker;
    },
    { live: LIVE_IFRAMES, previews: STATIC_PREVIEWS },
  );

const stopTracker = (ctx: ActionContext) =>
  ctx.page.evaluate(() => {
    const tracker = window.__zoomTracker;
    if (!tracker) return null;
    window.clearInterval(tracker.timer);
    return tracker.samples;
  });

async function wheelZoom(
  ctx: ActionContext,
  direction: Leg["direction"],
  ticks: number,
  at: { x: number; y: number },
): Promise<Leg> {
  const { page } = ctx;
  const sign = direction === "in" ? -1 : 1;
  await page.mouse.move(at.x, at.y);
  await page.keyboard.down("Control");
  try {
    await startTracker(ctx);
    await ctx.sampler.start();
    for (let tick = 0; tick < ticks; tick += 1) {
      await page.mouse.wheel(0, sign * WHEEL_DELTA_Y);
      await page.waitForTimeout(WHEEL_TICK_INTERVAL_MS);
    }
    const sampled = await ctx.sampler.stop();
    const timeline = await stopTracker(ctx);
    if (!timeline) ctx.fail("zoom tracker was not installed");
    await page.waitForTimeout(SETTLE_AFTER_LEG_MS);
    return { direction, ...sampled, timeline };
  } finally {
    await page.keyboard.up("Control");
  }
}

const action: CanvasBenchAction = {
  name: "zoom",
  async run(ctx: ActionContext) {
    const { page, run } = ctx;
    const clear = await ctx.clearArea();
    if (!clear) ctx.fail(`run ${run}: no canvas surface found`);
    const centre = {
      x: (clear.left + clear.right) / 2,
      y: (clear.top + clear.bottom) / 2,
    };
    const at = await page.evaluate(
      ({ centre, clear }) => {
        let best: { x: number; y: number; distance: number } | null = null;
        for (const content of document.querySelectorAll(
          "[data-screen-shell][data-frame-id] [data-screen-content]",
        )) {
          const rect = content.getBoundingClientRect();
          const left = Math.max(rect.left, clear.left);
          const right = Math.min(rect.right, clear.right);
          const top = Math.max(rect.top, clear.top);
          const bottom = Math.min(rect.bottom, clear.bottom);
          if (right - left <= 24 || bottom <= top) continue;
          const x = (left + right) / 2;
          const y = (top + bottom) / 2;
          const distance = Math.hypot(x - centre.x, y - centre.y);
          if (!best || distance < best.distance) best = { x, y, distance };
        }
        return best;
      },
      { centre, clear },
    );
    if (!at) ctx.fail(`run ${run}: no screen visible inside the canvas area`);

    const zoomStart = await readScale(ctx, "before zoom");
    if (zoomStart >= TARGET_SCALE * MIN_REACHED_FRACTION) {
      ctx.fail(
        `run ${run}: already at ${round(zoomStart * 100)}% before zooming`,
      );
    }

    let logPerTick = 0;
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Control");
    try {
      for (let tick = 0; tick < CALIBRATION_TICKS; tick += 1) {
        await page.mouse.wheel(0, -WHEEL_DELTA_Y);
        await page.waitForTimeout(WHEEL_TICK_INTERVAL_MS);
      }
      await page.waitForTimeout(SETTLE_AFTER_LEG_MS);
      const zoomed = await readScale(ctx, "during calibration");
      logPerTick = Math.log(zoomed / zoomStart) / CALIBRATION_TICKS;
      if (!(logPerTick > 0.001)) {
        ctx.fail(
          `run ${run}: Ctrl+wheel did not zoom in during calibration (${round(zoomStart * 100)}% -> ${round(zoomed * 100)}%)`,
        );
      }
      for (let tick = 0; tick < CALIBRATION_TICKS; tick += 1) {
        await page.mouse.wheel(0, WHEEL_DELTA_Y);
        await page.waitForTimeout(WHEEL_TICK_INTERVAL_MS);
      }
      await page.waitForTimeout(SETTLE_AFTER_LEG_MS);
      await page.keyboard.up("Control");
    } catch (error) {
      await page.keyboard.up("Control");
      throw error;
    }
    const startScale = await readScale(ctx, "after calibration");
    const ticksPerLeg = Math.ceil(
      Math.log(TARGET_SCALE / startScale) / logPerTick,
    );
    if (ticksPerLeg > MAX_WHEEL_TICKS_PER_LEG) {
      ctx.fail(
        `run ${run}: ${ticksPerLeg} ticks needed to reach ${TARGET_SCALE * 100}%, over the ${MAX_WHEEL_TICKS_PER_LEG} limit`,
      );
    }
    console.log(
      `run ${run} zoom: ${round(startScale * 100)}% -> ${TARGET_SCALE * 100}% = ${ticksPerLeg} ticks x ${round((Math.exp(logPerTick) - 1) * 100)}%/tick`,
    );

    const start = await ctx.checkpoint("start");
    if (!start.visible) ctx.fail(`run ${run}: start shows no screens`);
    const zoomIn = await wheelZoom(ctx, "in", ticksPerLeg, at);
    const zoomPeak = await readScale(ctx, "at peak");
    if (zoomPeak < TARGET_SCALE * MIN_REACHED_FRACTION) {
      ctx.fail(
        `run ${run}: zoom reached ${round(zoomPeak * 100)}%, under ${MIN_REACHED_FRACTION * 100}% of the ${TARGET_SCALE * 100}% target`,
      );
    }
    const peak = await ctx.checkpoint("zoomed-in");
    if (!peak.visible) ctx.fail(`run ${run}: zoomed-in shows no screens`);
    const liveIframesAtPeak = await countLive(ctx);
    const staticPreviewsAtPeak = await page.locator(STATIC_PREVIEWS).count();

    const zoomOut = await wheelZoom(ctx, "out", ticksPerLeg, at);
    const zoomEnd = await readScale(ctx, "at end");
    if (Math.abs(zoomEnd / startScale - 1) > MAX_RETURN_DRIFT) {
      ctx.fail(
        `run ${run}: zoom returned to ${round(zoomEnd * 100)}%, not within ${MAX_RETURN_DRIFT * 100}% of the ${round(startScale * 100)}% start`,
      );
    }
    const end = await ctx.checkpoint("end");
    if (!end.visible) ctx.fail(`run ${run}: end shows no screens`);

    const legs = [zoomIn, zoomOut];
    const frames = legs.flatMap((leg) => leg.frames);
    if (!frames.length) ctx.fail(`run ${run} sampled no frames`);
    return {
      frames,
      longFrames: legs.flatMap((leg) => leg.longFrames),
      extra: {
        zoomStart: startScale * 100,
        zoomPeak: zoomPeak * 100,
        zoomEnd: zoomEnd * 100,
        ticksPerLeg,
        liveIframesAtPeak,
        staticPreviewsAtPeak,
        liveIframesAtEnd: await countLive(ctx),
        legFrameCounts: legs.map((leg) => leg.frames.length),
        iframeTimeline: { in: zoomIn.timeline, out: zoomOut.timeline },
        zoom: { logPerTick, tickIntervalMs: WHEEL_TICK_INTERVAL_MS },
      },
    };
  },
};

export default action;
