import {
  median,
  readCamera,
  round,
  type ActionContext,
  type CanvasBenchAction,
} from "../lib.ts";

const IDLE_WINDOW_MS = 10_000;
const MAX_CAMERA_DRIFT_PX = 1;

const countLiveIframes = (ctx: ActionContext) =>
  ctx.page.locator("iframe[data-design-preview-iframe]").count();

const findNeutralPoint = (ctx: ActionContext) =>
  ctx.page.evaluate(() => {
    const clear = window.__bench?.clearArea();
    if (!clear) return null;
    const rects = [...document.querySelectorAll("[data-screen-shell]")].map(
      (shell) => shell.getBoundingClientRect(),
    );
    const inset = 12;
    const cols = 12;
    const rows = 8;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x =
          clear.left +
          inset +
          ((clear.right - clear.left - 2 * inset) * col) / (cols - 1);
        const y =
          clear.top +
          inset +
          ((clear.bottom - clear.top - 2 * inset) * row) / (rows - 1);
        const covered = rects.some(
          (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
        );
        if (!covered) return { x, y, covered: false };
      }
    }
    return { x: clear.right - inset, y: clear.bottom - inset, covered: true };
  });

const action: CanvasBenchAction = {
  name: "idle",
  async run(ctx: ActionContext) {
    const { page, run } = ctx;
    const point = await findNeutralPoint(ctx);
    if (!point) ctx.fail(`run ${run}: no canvas clear area found`);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(500);

    const start = await ctx.checkpoint("start");
    if (!start.visible) ctx.fail(`run ${run}: start shows no screens`);
    const liveIframesAtStart = await countLiveIframes(ctx);
    const cameraBefore = await readCamera(page);
    if (!cameraBefore) ctx.fail(`run ${run}: canvas camera is unavailable`);

    await page.evaluate(() => {
      const busy = { longTaskMs: 0, longTasks: 0 };
      window.__idleBusy = busy;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          busy.longTaskMs += entry.duration;
          busy.longTasks += 1;
        }
      });
      observer.observe({ type: "longtask", buffered: false });
      window.__idleBusyObserver = observer;
    });
    const startedAt = Date.now();
    await ctx.sampler.start();
    await page.waitForTimeout(IDLE_WINDOW_MS);
    const sampled = await ctx.sampler.stop();
    const durationMs = Date.now() - startedAt;
    const busy = await page.evaluate(() => {
      window.__idleBusyObserver?.disconnect();
      return window.__idleBusy ?? null;
    });
    if (!busy) ctx.fail(`run ${run}: idle long-task probe was not installed`);

    const cameraAfter = await readCamera(page);
    if (!cameraAfter)
      ctx.fail(`run ${run}: canvas camera vanished during idle`);
    const cameraMovedPx = Math.hypot(
      cameraAfter.x - cameraBefore.x,
      cameraAfter.y - cameraBefore.y,
    );
    if (
      cameraMovedPx > MAX_CAMERA_DRIFT_PX ||
      cameraAfter.scale !== cameraBefore.scale
    ) {
      ctx.fail(
        `run ${run}: camera moved during idle: ${JSON.stringify({ cameraBefore, cameraAfter })}`,
      );
    }
    if (!sampled.frames.length) ctx.fail(`run ${run} sampled no frames`);

    const end = await ctx.checkpoint("end");
    if (!end.visible) ctx.fail(`run ${run}: end shows no screens`);
    const liveIframesAtEnd = await countLiveIframes(ctx);

    return {
      frames: sampled.frames,
      longFrames: sampled.longFrames,
      extra: {
        durationMs,
        fps: round(sampled.frames.length / (durationMs / 1000)),
        idleFrameMsExpected: round(median(sampled.frames)),
        liveIframesAtStart,
        liveIframesAtEnd,
        cameraMovedPx,
        longFrameBusyMs: round(
          sampled.longFrames.reduce((sum, ms) => sum + ms, 0),
        ),
        longTaskBusyMs: round(busy.longTaskMs),
        longTasks: busy.longTasks,
        mouse: { x: point.x, y: point.y, overScreen: point.covered },
      },
    };
  },
};

export default action;
