import {
  MAX_WHEEL_TICKS_PER_LEG,
  WHEEL_DELTA_Y,
  WHEEL_TICK_INTERVAL_MS,
  readCamera,
  readVisibleScreens,
  round,
  SanityFailure,
  waitForCameraRest,
  type ActionContext,
  type CanvasBenchAction,
} from "../lib.ts";
import { runPan, type PanOptions } from "./pan.ts";

const TARGET_ZOOM = 1;
const MIN_ZOOM_FRACTION = 0.8;
const MAX_ZOOM_TICKS = 150;
const ZOOM_TICK_INTERVAL_MS = 40;
const ZOOMED_VIEW_TIMEOUT_MS = 20_000;
const ZOOM_SETUP_ATTEMPTS = 4;
const LIVE_POLL_MS = 50;
const CORNER_MARGIN_PX = 40;
const CORNER_TOLERANCE_PX = 60;

const findZoomAnchor = (ctx: ActionContext) =>
  ctx.page.evaluate(() => {
    const clear = window.__bench?.clearArea();
    if (!clear) return null;
    const corner = { x: clear.left + 40, y: clear.top + 40 };
    let best: { x: number; y: number; distance: number } | null = null;
    for (const content of document.querySelectorAll(
      "[data-screen-shell][data-frame-id] [data-screen-content]",
    )) {
      const rect = content.getBoundingClientRect();
      const left = Math.max(rect.left, clear.left);
      const right = Math.min(rect.right, clear.right);
      const top = Math.max(rect.top, clear.top);
      const bottom = Math.min(rect.bottom, clear.bottom);
      if (right - left <= 24 || bottom - top <= 24) continue;
      const distance = Math.hypot(left - corner.x, top - corner.y);
      if (!best || distance < best.distance) {
        best = { x: left + 4, y: top + 4, distance };
      }
    }
    return best;
  });

async function zoomIn(ctx: ActionContext) {
  const { page, run } = ctx;
  await waitForCameraRest(page);
  const extent = await ctx.readBoardExtent();
  if (!extent) ctx.fail(`run ${run}: no board found before zooming`);
  const { clear } = extent;
  const anchor = await findZoomAnchor(ctx);
  if (!anchor) ctx.fail(`run ${run}: no screen in view to zoom around`);
  const anchorX = anchor.x;
  const anchorY = anchor.y;
  const before = await readCamera(page);
  if (!before) ctx.fail(`run ${run}: camera unavailable before zoom`);
  await page.mouse.move(anchorX, anchorY);
  await page.keyboard.down("Control");
  try {
    for (let tick = 0; tick < MAX_ZOOM_TICKS; tick += 1) {
      await page.mouse.wheel(0, -WHEEL_DELTA_Y);
      await page.waitForTimeout(ZOOM_TICK_INTERVAL_MS);
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
  const giveUpAt = Date.now() + ZOOMED_VIEW_TIMEOUT_MS;
  let view = await readVisibleScreens(page);
  while (view.loaded === 0 && Date.now() < giveUpAt) {
    await page.waitForTimeout(200);
    view = await readVisibleScreens(page);
  }
  if (view.loaded === 0) {
    ctx.fail(
      `run ${run}: the zoomed view shows no loaded screen after ${ZOOMED_VIEW_TIMEOUT_MS / 1000}s (${view.visible} visible, camera ${JSON.stringify(await readCamera(page))})`,
    );
  }
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

const screensAheadOnRow = (ctx: ActionContext) =>
  ctx.page.evaluate(() => {
    const clear = window.__bench?.clearArea();
    if (!clear) return null;
    return [
      ...document.querySelectorAll("[data-screen-shell][data-frame-id]"),
    ].filter((shell) => {
      const rect = shell.getBoundingClientRect();
      return (
        rect.left >= clear.right &&
        rect.bottom > clear.top &&
        rect.top < clear.bottom
      );
    }).length;
  });

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
    let zoomAttempts = 0;
    let liveIframesMax = 0;
    const liveFrameIds = new Set<string>();
    let boardRightPx = 0;
    const options: PanOptions = {
      tickIntervalMs: WHEEL_TICK_INTERVAL_MS,
      axis: "x",
      async prepare() {
        for (let attempt = 1; ; attempt += 1) {
          zoomAttempts = attempt;
          try {
            await alignBoardCorner(ctx);
            const columns = await readBoardColumns(ctx);
            if (!columns) {
              ctx.fail(`run ${run}: no screens found before zooming`);
            }
            zoom = await zoomIn(ctx);
            break;
          } catch (error) {
            if (
              !(error instanceof SanityFailure) ||
              attempt >= ZOOM_SETUP_ATTEMPTS
            ) {
              throw error;
            }
            console.warn(
              `run ${run} pan-zoomed: zoom setup attempt ${attempt} failed (${error.message}); reloading`,
            );
            await page.reload({ waitUntil: "domcontentloaded" });
            await ctx.waitReady();
          }
        }
        const zoomed = await readBoardColumns(ctx);
        if (!zoomed) ctx.fail(`run ${run}: no screens found after zooming`);
        boardRightPx = zoomed.right;
        const ahead = await screensAheadOnRow(ctx);
        if (ahead === null)
          ctx.fail(`run ${run}: no canvas area after zooming`);
        options.axis = ahead > 0 ? "x" : "y";
      },
      travelPx: (extent) =>
        Math.min(
          options.axis === "y"
            ? (extent.columnBottom ?? extent.boardBottom) - extent.clear.bottom
            : boardRightPx - extent.clear.right,
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
    };
    const { result } = await runPan(ctx, "pan-zoomed", options);
    return {
      ...result,
      extra: {
        ...result.extra,
        zoom: round(zoom),
        axis: options.axis,
        zoomAttempts,
        liveIframesMax,
        liveScreensDistinct: liveFrameIds.size,
      },
    };
  },
};

export default action;
