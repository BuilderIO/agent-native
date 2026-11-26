import {
  MAX_WHEEL_TICKS_PER_LEG,
  MIN_CAMERA_TRAVEL_PX,
  SETTLE_AFTER_LEG_MS,
  percentile,
  WHEEL_DELTA_Y,
  WHEEL_TICK_INTERVAL_MS,
  readCamera,
  readShellOrigins,
  round,
  type ActionContext,
  type ActionResult,
  type BoardExtent,
  type CanvasBenchAction,
} from "../lib.ts";

const PAN_METHOD = 2;

const MIN_LEG_TRAVEL_FRACTION = 0.8;
const RETURN_TOLERANCE_FRACTION = 0.1;
const MIN_TRAVEL_VIEWPORT_FRACTION = 0.5;
const SCREEN_FOLLOW_TOLERANCE_PX = 4;
const GESTURE_EDGE_MS = 300;
const JIRA_WORST_FRAME_MS = 100;
const PAN_MIN_TICKS = 200;

export type Leg = {
  direction: "forward" | "back";
  dx: number;
  dy: number;
  elapsedMs: number;
  frames: number[];
  longFrames: number[];
};

export type PanOptions = {
  tickIntervalMs: number;
  axis?: "x" | "y";
  wheelDelta?: number;
  minTicks?: number;
  gestureEndTailMs?: number;
  prepare?(ctx: ActionContext): Promise<void>;
  travelPx?(extent: BoardExtent, viewportSpanPx: number): number;
  screensMustChange?: boolean;
  beforeLeg?(ctx: ActionContext): Promise<void>;
  afterLeg?(ctx: ActionContext): Promise<void>;
};

export type PanRun = {
  result: ActionResult;
  legs: Leg[];
  ticks: number;
  pxPerTick: number;
  extent: BoardExtent;
};

async function wheelLeg(
  ctx: ActionContext,
  ticks: number,
  sign: number,
  options: PanOptions,
) {
  const delta = sign * (options.wheelDelta ?? WHEEL_DELTA_Y);
  const horizontal = options.axis === "x";
  for (let tick = 0; tick < ticks; tick += 1) {
    await ctx.page.mouse.wheel(horizontal ? delta : 0, horizontal ? 0 : delta);
    if (options.tickIntervalMs > 0) {
      await ctx.page.waitForTimeout(options.tickIntervalMs);
    }
  }
}

async function calibratePxPerTick(ctx: ActionContext, options: PanOptions) {
  const horizontal = options.axis === "x";
  const delta = options.wheelDelta ?? WHEEL_DELTA_Y;
  if (
    !horizontal &&
    delta === WHEEL_DELTA_Y &&
    options.tickIntervalMs === WHEEL_TICK_INTERVAL_MS
  ) {
    return ctx.measurePxPerTick();
  }
  const { page } = ctx;
  const CALIBRATION_TICKS = 5;
  const read = async () => {
    const camera = await readCamera(page);
    if (!camera) ctx.fail("canvas camera vanished during calibration");
    return horizontal ? camera.x : camera.y;
  };
  const send = async (sign: number) => {
    for (let tick = 0; tick < CALIBRATION_TICKS; tick += 1) {
      await page.mouse.wheel(
        horizontal ? sign * delta : 0,
        horizontal ? 0 : sign * delta,
      );
      if (options.tickIntervalMs > 0) {
        await page.waitForTimeout(options.tickIntervalMs);
      }
    }
    await page.waitForTimeout(SETTLE_AFTER_LEG_MS);
  };
  const before = await read();
  await send(1);
  const moved = await read();
  await send(-1);
  const back = await read();
  const pxPerTick = Math.abs(moved - before) / CALIBRATION_TICKS;
  if (pxPerTick < 1 || Math.abs(back - before) > 1) {
    ctx.fail(
      `wheel calibration failed: ${JSON.stringify({ axis: options.axis ?? "y", delta, before, moved, back })}`,
    );
  }
  return pxPerTick;
}

async function pan(
  ctx: ActionContext,
  direction: Leg["direction"],
  ticks: number,
  expectedTravelPx: number,
  options: PanOptions,
): Promise<Leg> {
  const { page } = ctx;
  const before = await readCamera(page);
  if (!before) ctx.fail("canvas camera is unavailable before pan");
  const sign = direction === "forward" ? 1 : -1;
  await options.beforeLeg?.(ctx);
  await ctx.sampler.start();
  const startedAt = performance.now();
  await wheelLeg(ctx, ticks, sign, options);
  const elapsedMs = performance.now() - startedAt;
  if (options.gestureEndTailMs) {
    await page.waitForTimeout(options.gestureEndTailMs);
  }
  const sampled = await ctx.sampler.stop();
  await options.afterLeg?.(ctx);
  await page.waitForTimeout(SETTLE_AFTER_LEG_MS);
  const after = await readCamera(page);
  if (!after) ctx.fail("canvas camera vanished during pan");
  const leg: Leg = {
    direction,
    dx: after.x - before.x,
    dy: after.y - before.y,
    elapsedMs,
    ...sampled,
  };
  const travelPx = Math.hypot(leg.dx, leg.dy);
  if (travelPx < MIN_CAMERA_TRAVEL_PX) {
    ctx.fail(
      `camera did not move on the ${direction} leg: ${JSON.stringify({ before, after })}`,
    );
  }
  if (travelPx < MIN_LEG_TRAVEL_FRACTION * expectedTravelPx) {
    ctx.fail(
      `the ${direction} leg moved the camera ${Math.round(travelPx)}px, under ${MIN_LEG_TRAVEL_FRACTION * 100}% of the ${Math.round(expectedTravelPx)}px its ${ticks} ticks should travel`,
    );
  }
  return leg;
}

async function sustainedPan(
  ctx: ActionContext,
  ticksPerSweep: number,
  sweeps: number,
  options: PanOptions,
): Promise<Leg> {
  const { page } = ctx;
  const before = await readCamera(page);
  if (!before)
    ctx.fail("canvas camera is unavailable before the sustained pan");
  await options.beforeLeg?.(ctx);
  await ctx.sampler.start();
  const startedAt = performance.now();
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    await wheelLeg(ctx, ticksPerSweep, 1, options);
    await wheelLeg(ctx, ticksPerSweep, -1, options);
  }
  const elapsedMs = performance.now() - startedAt;
  if (options.gestureEndTailMs) {
    await page.waitForTimeout(options.gestureEndTailMs);
  }
  const sampled = await ctx.sampler.stop();
  await options.afterLeg?.(ctx);
  await page.waitForTimeout(SETTLE_AFTER_LEG_MS);
  const after = await readCamera(page);
  if (!after) ctx.fail("canvas camera vanished during the sustained pan");
  return {
    direction: "back",
    dx: after.x - before.x,
    dy: after.y - before.y,
    elapsedMs,
    ...sampled,
  };
}

function gestureEdgeStats(legs: Leg[], options: PanOptions) {
  const edge: number[] = [];
  const steady: number[] = [];
  for (const leg of legs) {
    const total = leg.frames.reduce((sum, ms) => sum + ms, 0);
    let elapsed = 0;
    for (const ms of leg.frames) {
      elapsed += ms;
      const atEdge =
        elapsed <= GESTURE_EDGE_MS ||
        elapsed > total - (options.gestureEndTailMs ?? 0);
      (atEdge ? edge : steady).push(ms);
    }
  }
  const sorted = [...steady].sort((a, b) => a - b);
  return {
    steadyFrames: steady.length,
    steadyP50Ms: sorted.length ? round(percentile(sorted, 0.5)) : null,
    steadyP95Ms: sorted.length ? round(percentile(sorted, 0.95)) : null,
    steadyWorstMs: sorted.length ? round(percentile(sorted, 1)) : null,
    gestureEdgeFrames: edge.length,
    gestureEdgeWorstMs: edge.length ? round(Math.max(...edge)) : null,
    framesOver100Ms: [...steady, ...edge].filter(
      (ms) => ms > JIRA_WORST_FRAME_MS,
    ).length,
    jiraWorstFrameBarMs: JIRA_WORST_FRAME_MS,
  };
}

export async function runPan(
  ctx: ActionContext,
  name: string,
  options: PanOptions,
): Promise<PanRun> {
  {
    const { page, run } = ctx;
    await options.prepare?.(ctx);
    const extent = await ctx.readBoardExtent();
    if (!extent) ctx.fail(`run ${run}: no board or canvas surface found`);
    const horizontal = options.axis === "x";
    const viewportHeightPx = horizontal
      ? extent.clear.right - extent.clear.left
      : extent.clear.bottom - extent.clear.top;
    const boardHeightPx = extent.boardBottom - extent.boardTop;
    if (!horizontal && extent.columnBottom === null) {
      ctx.fail(`run ${run}: no screen lies in the canvas area's column`);
    }
    const travelPx = options.travelPx
      ? options.travelPx(extent, viewportHeightPx)
      : (extent.columnBottom ?? extent.boardBottom) - extent.clear.bottom;
    if (travelPx < MIN_TRAVEL_VIEWPORT_FRACTION * viewportHeightPx) {
      ctx.fail(
        `run ${run}: the board barely extends past the view at this zoom (board ${Math.round(boardHeightPx)}px, canvas area ${Math.round(viewportHeightPx)}px, travel ${Math.round(travelPx)}px, under ${MIN_TRAVEL_VIEWPORT_FRACTION * 100}% of the canvas area)`,
      );
    }
    const pxPerTick = await calibratePxPerTick(ctx, options);
    const ticks = Math.floor(travelPx / pxPerTick);
    if (ticks > MAX_WHEEL_TICKS_PER_LEG) {
      ctx.fail(
        `run ${run}: ${ticks} ticks needed to cross the board, over the ${MAX_WHEEL_TICKS_PER_LEG} limit`,
      );
    }
    console.log(
      `run ${run} ${name}: board ${Math.round(boardHeightPx)}px tall, canvas area ${Math.round(viewportHeightPx)}px tall, travel ${Math.round(travelPx)}px = ${ticks} ticks x ${round(pxPerTick)}px/tick`,
    );

    const start = await ctx.checkpoint("start");
    if (!start.visible) ctx.fail(`run ${run}: start shows no screens`);
    const startCamera = await readCamera(page);
    if (!startCamera) ctx.fail(`run ${run}: canvas camera is unavailable`);
    const expectedTravelPx = ticks * pxPerTick;
    const startOrigins = await readShellOrigins(page);
    const forward = await pan(ctx, "forward", ticks, expectedTravelPx, options);
    const afterForward = await ctx.checkpoint("after-forward");
    if (!afterForward.visible) {
      ctx.fail(`run ${run}: after-forward shows no screens`);
    }
    const startIds = new Set(start.screens.map((s) => s.frameId));
    const screensUnchanged =
      afterForward.screens.length === startIds.size &&
      afterForward.screens.every((s) => startIds.has(s.frameId));
    if (options.screensMustChange !== false && screensUnchanged) {
      if (start.visible < ctx.screenCount) {
        ctx.fail(
          `run ${run}: the visible screens did not change after the forward leg although the camera moved and the board has ${ctx.screenCount - start.visible} screens out of view`,
        );
      }
      if (afterForward.loaded < afterForward.visible) {
        ctx.fail(
          `run ${run}: ${afterForward.visible - afterForward.loaded} of ${afterForward.visible} screens are not loaded after the forward leg`,
        );
      }
      const afterOrigins = await readShellOrigins(page);
      const followed = [...startOrigins].flatMap(([frameId, origin]) => {
        const now = afterOrigins.get(frameId);
        return now ? [{ origin, now }] : [];
      });
      const stuck = followed.filter(
        ({ origin, now }) =>
          Math.abs(now.left - origin.left - forward.dx) >
            SCREEN_FOLLOW_TOLERANCE_PX ||
          Math.abs(now.top - origin.top - forward.dy) >
            SCREEN_FOLLOW_TOLERANCE_PX,
      );
      if (!followed.length || stuck.length) {
        ctx.fail(
          `run ${run}: the camera moved ${Math.round(forward.dx)},${Math.round(forward.dy)}px but ${followed.length ? `${stuck.length} of ${followed.length} screens did not move with it` : "no screen stayed mounted to move"}`,
        );
      }
    }
    const firstBack = await pan(ctx, "back", ticks, expectedTravelPx, options);
    const sweeps = options.minTicks
      ? Math.ceil(Math.max(0, options.minTicks - 2 * ticks) / (2 * ticks))
      : 0;
    const sustainedLegs: Leg[] = sweeps
      ? [await sustainedPan(ctx, ticks, sweeps, options)]
      : [];
    const endCamera = await readCamera(page);
    if (!endCamera)
      ctx.fail(`run ${run}: canvas camera vanished after the back leg`);
    const returnErrorPx = Math.hypot(
      endCamera.x - startCamera.x,
      endCamera.y - startCamera.y,
    );
    const forwardTravelPx = Math.hypot(forward.dx, forward.dy);
    if (returnErrorPx > RETURN_TOLERANCE_FRACTION * forwardTravelPx) {
      ctx.fail(
        `run ${run}: the camera ended ${Math.round(returnErrorPx)}px from where it started, over ${RETURN_TOLERANCE_FRACTION * 100}% of the ${Math.round(forwardTravelPx)}px leg`,
      );
    }
    const end = await ctx.checkpoint("end");
    if (!end.visible) ctx.fail(`run ${run}: end shows no screens`);

    const legs = [forward, firstBack, ...sustainedLegs];
    const frames = legs.flatMap((leg) => leg.frames);
    if (!frames.length) ctx.fail(`run ${run} sampled no frames`);
    const result: ActionResult = {
      frames,
      longFrames: legs.flatMap((leg) => leg.longFrames),
      extra: {
        panMethod: PAN_METHOD,
        cameraDistancePx: legs.reduce(
          (sum, leg) => sum + Math.hypot(leg.dx, leg.dy),
          0,
        ),
        liveIframesAtEnd: await page
          .locator("iframe[data-design-preview-iframe]")
          .count(),
        wheelElapsedMs: legs.reduce((sum, leg) => sum + leg.elapsedMs, 0),
        legFrameCounts: legs.map((leg) => leg.frames.length),
        ...(options.gestureEndTailMs ? gestureEdgeStats(legs, options) : {}),
        pan: {
          clearArea: extent.clear,
          boardHeightPx,
          viewportHeightPx,
          travelPx,
          pxPerTick,
          ticks,
        },
        legs: legs.map(({ direction, dx, dy }) => ({ direction, dx, dy })),
        returnedErrorPx: returnErrorPx,
      },
    };
    return { result, legs, ticks, pxPerTick, extent };
  }
}

const action: CanvasBenchAction = {
  name: "pan",
  async run(ctx: ActionContext) {
    const { result } = await runPan(ctx, "pan", {
      tickIntervalMs: WHEEL_TICK_INTERVAL_MS,
      minTicks: PAN_MIN_TICKS,
      gestureEndTailMs: GESTURE_EDGE_MS,
    });
    return result;
  },
};

export default action;
