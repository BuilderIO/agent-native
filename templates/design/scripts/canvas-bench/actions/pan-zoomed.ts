import {
  MAX_WHEEL_TICKS_PER_LEG,
  WHEEL_DELTA_Y,
  WHEEL_TICK_INTERVAL_MS,
  readCamera,
  round,
  type ActionContext,
  type CanvasBenchAction,
} from "../lib.ts";
import { runPan } from "./pan.ts";

const TARGET_ZOOM = 1;
const MIN_ZOOM_FRACTION = 0.8;
const MAX_ZOOM_TICKS = 80;
const LIVE_POLL_MS = 50;
const CORNER_MARGIN_PX = 40;
const CORNER_TOLERANCE_PX = 60;

async function zoomIn(ctx: ActionContext, boardLeft: number) {
  const { page, run } = ctx;
  const extent = await ctx.readBoardExtent();
  if (!extent) ctx.fail(`run ${run}: no board found before zooming`);
  const { clear } = extent;
  const anchorX = Math.min(
    Math.max(boardLeft + 4, clear.left + 20),
    clear.right - 20,
  );
  const anchorY = Math.min(
    Math.max(extent.boardTop + 4, clear.top + 20),
    clear.bottom - 20,
  );
  const before = await readCamera(page);
  if (!before) ctx.fail(`run ${run}: camera unavailable before zoom`);
  await page.mouse.move(anchorX, anchorY);
  await page.keyboard.down("Control");
  try {
    for (let tick = 0; tick < MAX_ZOOM_TICKS; tick += 1) {
      await page.mouse.wheel(0, -WHEEL_DELTA_Y);
      await page.waitForTimeout(WHEEL_TICK_INTERVAL_MS);
      const camera = await readCamera(page);
      if (camera && camera.scale >= TARGET_ZOOM) break;
    }
  } finally {
    await page.keyboard.up("Control");
  }
  await page.waitForTimeout(500);
  const after = await readCamera(page);
  if (!after || after.scale < TARGET_ZOOM * MIN_ZOOM_FRACTION) {
    ctx.fail(
      `run ${run}: zoom did not reach ${TARGET_ZOOM * MIN_ZOOM_FRACTION * 100}%: ${JSON.stringify({ before, after })}`,
    );
  }
  await page.mouse.move(
    (clear.left + clear.right) / 2,
    (clear.top + clear.bottom) / 2,
  );
  await ctx.waitReady();
  return after.scale;
}

async function alignBoardCorner(ctx: ActionContext) {
  const { page, run } = ctx;
  for (let step = 0; step < 60; step += 1) {
    const extent = await ctx.readBoardExtent();
    const columns = await readBoardColumns(ctx);
    if (!extent || !columns) ctx.fail(`run ${run}: no board while aligning`);
    const gapY = extent.boardTop - (extent.clear.top + CORNER_MARGIN_PX);
    const gapX = columns.left - (extent.clear.left + CORNER_MARGIN_PX);
    if (
      Math.abs(gapY) < CORNER_TOLERANCE_PX &&
      Math.abs(gapX) < CORNER_TOLERANCE_PX
    ) {
      return;
    }
    const ticksY = Math.min(100, Math.ceil(Math.abs(gapY) / 300));
    const ticksX = Math.min(100, Math.ceil(Math.abs(gapX) / 300));
    const signY = Math.sign(gapY);
    const signX = Math.sign(gapX);
    for (let tick = 0; tick < Math.max(ticksY, ticksX); tick += 1) {
      await page.mouse.wheel(
        tick < ticksX && Math.abs(gapX) >= CORNER_TOLERANCE_PX
          ? signX * WHEEL_DELTA_Y
          : 0,
        tick < ticksY && Math.abs(gapY) >= CORNER_TOLERANCE_PX
          ? signY * WHEEL_DELTA_Y
          : 0,
      );
      await page.waitForTimeout(WHEEL_TICK_INTERVAL_MS);
    }
    await page.waitForTimeout(300);
  }
  ctx.fail(`run ${run}: could not bring the board corner into view`);
}

const readBoardColumns = (ctx: ActionContext) =>
  ctx.page.evaluate(() => {
    const rects = [
      ...document.querySelectorAll("[data-screen-shell][data-frame-id]"),
    ].map((shell) => shell.getBoundingClientRect());
    return rects.length
      ? {
          left: Math.min(...rects.map((r) => r.left)),
          right: Math.max(...rects.map((r) => r.right)),
        }
      : null;
  });

const action: CanvasBenchAction = {
  name: "pan-zoomed",
  async run(ctx: ActionContext) {
    const { page, run } = ctx;
    let zoom = 0;
    let liveIframesMax = 0;
    const liveFrameIds = new Set<string>();
    let boardRightPx = 0;
    const { result } = await runPan(ctx, "pan-zoomed", {
      tickIntervalMs: WHEEL_TICK_INTERVAL_MS,
      axis: "x",
      async prepare() {
        await alignBoardCorner(ctx);
        const columns = await readBoardColumns(ctx);
        if (!columns) ctx.fail(`run ${run}: no screens found before zooming`);
        zoom = await zoomIn(ctx, columns.left);
        const zoomed = await readBoardColumns(ctx);
        if (!zoomed) ctx.fail(`run ${run}: no screens found after zooming`);
        boardRightPx = zoomed.right;
      },
      travelPx: (extent) =>
        Math.min(
          boardRightPx - extent.clear.right,
          MAX_WHEEL_TICKS_PER_LEG * WHEEL_DELTA_Y,
        ),
      beforeLeg: () =>
        page.evaluate((pollMs) => {
          const peak = { max: 0, ids: new Set<string>(), timer: 0 };
          const poll = () => {
            const live = document.querySelectorAll(
              "iframe[data-design-preview-iframe]",
            );
            peak.max = Math.max(peak.max, live.length);
            live.forEach((iframe) => {
              const id = iframe
                .closest("[data-screen-shell][data-frame-id]")
                ?.getAttribute("data-frame-id");
              if (id) peak.ids.add(id);
            });
          };
          poll();
          peak.timer = window.setInterval(poll, pollMs);
          window.__livePeak = peak;
        }, LIVE_POLL_MS),
      async afterLeg() {
        const peak = await page.evaluate(() => {
          const live = window.__livePeak;
          if (!live) return null;
          window.clearInterval(live.timer);
          return { max: live.max, ids: [...live.ids] };
        });
        if (!peak) ctx.fail(`run ${run}: live-iframe poller was not installed`);
        liveIframesMax = Math.max(liveIframesMax, peak.max);
        for (const id of peak.ids) liveFrameIds.add(id);
      },
    });
    return {
      ...result,
      extra: {
        ...result.extra,
        zoom: round(zoom),
        liveIframesMax,
        liveScreensDistinct: liveFrameIds.size,
      },
    };
  },
};

export default action;
