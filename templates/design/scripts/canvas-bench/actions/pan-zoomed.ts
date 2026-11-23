// Zooms to about 100% at the board's top-left corner, then pans horizontally
// across the board's columns and back. Each column is about one screen wide at
// this zoom, so screens enter and leave the view while they are live editors.
// Zooming and settling happen before sampling starts. The canvas treats deltaX
// as a horizontal pan (shift+wheel maps deltaY to it), so deltaX is sent
// directly.
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

// Ctrl+wheel zooms the canvas around the cursor (a -120 delta is one mouse
// notch, 1.1^1.2 per tick), so the anchor stays under the mouse.
async function zoomIn(ctx: ActionContext, boardLeft: number) {
  const { page, run } = ctx;
  const extent = await ctx.readBoardExtent();
  if (!extent) ctx.fail(`run ${run}: no board found before zooming`);
  const { clear } = extent;
  // The board's top-left stays under the cursor, so zooming keeps the first
  // column's title and headings in view instead of its grey filler.
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

// The board is far taller than the view at the opening camera, so bring its
// top-left corner into view before zooming; the zoom then keeps it under the
// cursor. A proportional controller, because wheel delta to camera px is not
// assumed.
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
    // A positive delta moves the camera forward (down or right), so a corner
    // above or left of its target (negative gap) needs a negative delta.
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

// Viewport-pixel left and right edges of every screen shell.
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
      // The wheel moves about WHEEL_DELTA_Y camera px per tick at this zoom.
      travelPx: (extent) =>
        Math.min(
          boardRightPx - extent.clear.right,
          MAX_WHEEL_TICKS_PER_LEG * WHEEL_DELTA_Y,
        ),
      // A page-side timer tracks live iframes without a round trip per tick;
      // it is started and read outside the sampled window.
      beforeLeg: () =>
        page.evaluate((pollMs) => {
          const w = window as any;
          w.__liveMax = 0;
          w.__liveIds = new Set<string>();
          const poll = () => {
            const live = document.querySelectorAll(
              "iframe[data-design-preview-iframe]",
            );
            w.__liveMax = Math.max(w.__liveMax, live.length);
            live.forEach((iframe) => {
              const id = iframe
                .closest("[data-screen-shell][data-frame-id]")
                ?.getAttribute("data-frame-id");
              if (id) w.__liveIds.add(id);
            });
          };
          poll();
          w.__liveTimer = window.setInterval(poll, pollMs);
        }, LIVE_POLL_MS),
      async afterLeg() {
        const peak = await page.evaluate(() => {
          const w = window as any;
          window.clearInterval(w.__liveTimer);
          return {
            max: w.__liveMax as number,
            ids: [...w.__liveIds] as string[],
          };
        });
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
