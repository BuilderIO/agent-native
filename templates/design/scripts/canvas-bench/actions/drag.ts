import {
  LONG_FRAME_MS,
  SETTLE_AFTER_LEG_MS,
  median,
  percentile,
  readCamera,
  round,
  SanityFailure,
  type ActionContext,
  type ActionResult,
  type CanvasBenchAction,
  type ClearArea,
} from "../lib.ts";

const DRAG_DISTANCE_PX = 500;
const MIN_DRAG_DISTANCE_PX = 100;
const ROOM_USED_FRACTION = 0.9;
const REACH_STEP_TICKS_MAX = 150;
const REACH_WHEEL_DELTA = 120;
const REACH_TOLERANCE_PX = 20;
const REACH_MAX_STEPS = 12;
const DRAG_STEPS = 30;
const DRAG_STEP_INTERVAL_MS = 16;
const MOVE_TOLERANCE = 0.1;
const RETURN_TOLERANCE_PX = 3;
const PERSIST_TOLERANCE = 0.5;
const SAVE_TOLERANCE_PX = 3;
const PERSIST_TIMEOUT_MS = 15_000;
const SCREEN_MARGIN_PX = 40;
const DROP_WINDOW_MS = 500;
const RESTORE_SETTLE_MS = 1500;

type Point = { x: number; y: number };
type Pick = {
  frameId: string;
  titleAt: Point;
  content: { left: number; top: number; width: number; height: number };
};
type Leg = {
  frames: number[];
  longFrames: number[];
  latencies: number[];
  dx: number;
  dropFrames: number[];
  dropLongFrames: number[];
};

type Rect = { left: number; top: number; width: number; height: number };
type Candidate = {
  frameId: string;
  bounds: Rect;
  bar: { top: number; bottom: number };
  titleAt: Point;
  titleHit: boolean;
};

const readCandidates = (ctx: ActionContext): Promise<Candidate[]> =>
  ctx.page.evaluate(() => {
    const candidates: Candidate[] = [];
    for (const shell of document.querySelectorAll<HTMLElement>(
      "[data-screen-shell][data-frame-id]",
    )) {
      const frameId = shell.getAttribute("data-frame-id");
      const bar = shell.firstElementChild?.getBoundingClientRect();
      const copies = [...shell.querySelectorAll("[data-screen-content]")]
        .map((content) => content.getBoundingClientRect())
        .filter((rect) => rect.width > 24);
      if (!frameId || !bar || bar.height < 2 || !copies.length) continue;
      const left = Math.min(...copies.map((rect) => rect.left));
      const top = Math.min(...copies.map((rect) => rect.top));
      const right = Math.max(...copies.map((rect) => rect.right));
      const bottom = Math.max(...copies.map((rect) => rect.bottom));
      const titleAt = {
        x: bar.left + bar.width / 2,
        y: bar.top + bar.height / 2,
      };
      candidates.push({
        frameId,
        bounds: { left, top, width: right - left, height: bottom - top },
        bar: { top: bar.top, bottom: bar.bottom },
        titleAt,
        titleHit:
          document
            .elementFromPoint(titleAt.x, titleAt.y)
            ?.closest("[data-screen-shell]") === shell,
      });
    }
    return candidates;
  });

const fitsAcross = (candidate: Candidate, clear: ClearArea) =>
  candidate.bounds.left >= clear.left &&
  candidate.bounds.left + candidate.bounds.width <= clear.right;

async function pickScreen(
  ctx: ActionContext,
  frameId?: string,
): Promise<Pick | null> {
  const clear = await ctx.clearArea();
  if (!clear) return null;
  const cx = (clear.left + clear.right) / 2;
  const cy = (clear.top + clear.bottom) / 2;
  let best: { pick: Pick; distance: number } | null = null;
  for (const candidate of await readCandidates(ctx)) {
    if (frameId && candidate.frameId !== frameId) continue;
    if (
      !fitsAcross(candidate, clear) ||
      !candidate.titleHit ||
      candidate.bar.top < clear.top + SCREEN_MARGIN_PX ||
      candidate.bar.bottom > clear.bottom - SCREEN_MARGIN_PX
    ) {
      continue;
    }
    const { bounds } = candidate;
    const distance = Math.hypot(
      bounds.left + bounds.width / 2 - cx,
      bounds.top + bounds.height / 2 - cy,
    );
    if (!best || distance < best.distance) {
      best = {
        pick: {
          frameId: candidate.frameId,
          titleAt: candidate.titleAt,
          content: bounds,
        },
        distance,
      };
    }
  }
  return best?.pick ?? null;
}

async function bringTitleBarIntoReach(ctx: ActionContext) {
  const clear = await ctx.clearArea();
  if (!clear) return;
  const middle = (clear.top + clear.bottom) / 2;
  await ctx.page.mouse.move((clear.left + clear.right) / 2, middle);
  for (let step = 0; step < REACH_MAX_STEPS; step += 1) {
    const gaps = (await readCandidates(ctx))
      .filter((candidate) => fitsAcross(candidate, clear))
      .map(
        (candidate) => (candidate.bar.top + candidate.bar.bottom) / 2 - middle,
      );
    if (!gaps.length) return;
    const gap = gaps.reduce((best, next) =>
      Math.abs(next) < Math.abs(best) ? next : best,
    );
    if (Math.abs(gap) <= REACH_TOLERANCE_PX) return;
    const ticks = Math.min(
      REACH_STEP_TICKS_MAX,
      Math.max(1, Math.round(Math.abs(gap) / REACH_WHEEL_DELTA)),
    );
    for (let tick = 0; tick < ticks; tick += 1) {
      await ctx.page.mouse.wheel(0, Math.sign(gap) * REACH_WHEEL_DELTA);
      await ctx.page.waitForTimeout(16);
    }
    await ctx.page.waitForTimeout(SETTLE_AFTER_LEG_MS);
  }
}

async function selectionBoxMatches(ctx: ActionContext, frameId: string) {
  return ctx.page.evaluate((frameId) => {
    const content = document
      .querySelector(
        `[data-screen-shell][data-frame-id="${frameId}"] [data-screen-content]`,
      )
      ?.getBoundingClientRect();
    if (!content) return false;
    return [...document.querySelectorAll("[data-frame-selection-box]")].some(
      (box) => {
        const rect = box.getBoundingClientRect();
        return (
          Math.abs(rect.left - content.left) < 3 &&
          Math.abs(rect.top - content.top) < 3 &&
          Math.abs(rect.width - content.width) < 3
        );
      },
    );
  }, frameId);
}

const readContentLeft = (ctx: ActionContext, frameId: string) =>
  ctx.page.evaluate(
    (frameId) =>
      document
        .querySelector(
          `[data-screen-shell][data-frame-id="${frameId}"] [data-screen-content]`,
        )
        ?.getBoundingClientRect().left ?? null,
    frameId,
  );

const installLatencyProbe = (ctx: ActionContext, frameId: string) =>
  ctx.page.evaluate((frameId) => {
    const shell = document.querySelector<HTMLElement>(
      `[data-screen-shell][data-frame-id="${frameId}"]`,
    );
    const probe = {
      pending: [] as number[],
      latencies: [] as number[],
      on: true,
    };
    window.__dragProbe = probe;
    let last = shell?.getAttribute("style") ?? "";
    window.addEventListener(
      "mousemove",
      (event) => {
        if (probe.on) probe.pending.push(event.timeStamp);
      },
      { capture: true },
    );
    const tick = () => {
      if (!probe.on) return;
      const style = shell?.getAttribute("style") ?? "";
      if (style !== last) {
        last = style;
        const now = performance.now();
        for (const at of probe.pending) probe.latencies.push(now - at);
        probe.pending = [];
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, frameId);

const collectLatencies = (ctx: ActionContext) =>
  ctx.page.evaluate(() => {
    const probe = window.__dragProbe;
    if (!probe) return null;
    probe.on = false;
    return probe.latencies;
  });

async function dragLeg(
  ctx: ActionContext,
  pick: Pick,
  dx: number,
  label: string,
): Promise<Leg> {
  const { page } = ctx;
  const before = await readContentLeft(ctx, pick.frameId);
  if (before === null) ctx.fail(`${label}: screen vanished before the drag`);
  await installLatencyProbe(ctx, pick.frameId);
  await page.mouse.move(pick.titleAt.x, pick.titleAt.y);
  await page.mouse.down();
  await ctx.sampler.start();
  for (let step = 1; step <= DRAG_STEPS; step += 1) {
    await page.mouse.move(
      pick.titleAt.x + (dx * step) / DRAG_STEPS,
      pick.titleAt.y,
    );
    await page.waitForTimeout(DRAG_STEP_INTERVAL_MS);
  }
  const moved = await ctx.sampler.stop();
  await ctx.sampler.start();
  await page.mouse.up();
  await page.waitForTimeout(DROP_WINDOW_MS);
  const drop = await ctx.sampler.stop();
  const latencies = await collectLatencies(ctx);
  if (!latencies) ctx.fail(`${label}: latency probe was not installed`);
  await page.waitForTimeout(SETTLE_AFTER_LEG_MS);
  const after = await readContentLeft(ctx, pick.frameId);
  if (after === null) ctx.fail(`${label}: screen vanished after the drag`);
  return {
    frames: [...moved.frames, ...drop.frames],
    longFrames: [...moved.longFrames, ...drop.longFrames],
    latencies,
    dx: after - before,
    dropFrames: drop.frames,
    dropLongFrames: drop.longFrames,
  };
}

async function readPersistedPosition(
  ctx: ActionContext,
  frameId: string,
): Promise<Point> {
  const response = await fetch(
    `${ctx.options.baseUrl}/_agent-native/actions/get-design?id=${ctx.designId}&includeFileContent=false`,
  );
  if (!response.ok) {
    ctx.fail(`get-design failed: ${response.status} ${await response.text()}`);
  }
  const design = (await response.json()) as { data?: string | null };
  const data = design.data ? JSON.parse(design.data) : null;
  const frame = data?.canvasFrames?.[frameId];
  if (typeof frame?.x !== "number" || typeof frame?.y !== "number") {
    ctx.fail(`persisted design has no position for screen ${frameId}`);
  }
  return { x: frame.x, y: frame.y };
}

async function waitForPersisted(
  ctx: ActionContext,
  frameId: string,
  accept: (position: Point) => boolean,
): Promise<{ position: Point; accepted: boolean }> {
  const deadline = Date.now() + PERSIST_TIMEOUT_MS;
  let position = await readPersistedPosition(ctx, frameId);
  while (!accept(position) && Date.now() < deadline) {
    await ctx.page.waitForTimeout(500);
    position = await readPersistedPosition(ctx, frameId);
  }
  return { position, accepted: accept(position) };
}

async function restorePersisted(
  ctx: ActionContext,
  frameId: string,
  original: Point,
): Promise<string> {
  try {
    await ctx.page.waitForTimeout(RESTORE_SETTLE_MS);
    const response = await fetch(
      `${ctx.options.baseUrl}/_agent-native/actions/update-design`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-CSRF": "1",
        },
        body: JSON.stringify({
          id: ctx.designId,
          dataOperations: [
            {
              op: "set",
              path: ["canvasFrames", frameId, "x"],
              value: original.x,
            },
            {
              op: "set",
              path: ["canvasFrames", frameId, "y"],
              value: original.y,
            },
          ],
        }),
      },
    );
    if (!response.ok) {
      return `restoring the original position FAILED: update-design ${response.status} ${await response.text()}`;
    }
    await ctx.page.waitForTimeout(RESTORE_SETTLE_MS);
    const now = await readPersistedPosition(ctx, frameId);
    if (
      Math.hypot(now.x - original.x, now.y - original.y) > PERSIST_TOLERANCE
    ) {
      return `restoring the original position FAILED: saved position is ${JSON.stringify(now)}, original ${JSON.stringify(original)}`;
    }
    return "restored the original saved position";
  } catch (error) {
    return `restoring the original position FAILED: ${error instanceof Error ? error.message : error}`;
  }
}

type Restore = { frameId: string; original: Point } | null;

async function runDrag(
  ctx: ActionContext,
  onFirstMove: (restore: NonNullable<Restore>) => void,
): Promise<ActionResult> {
  {
    const { page, run } = ctx;
    const camera = await readCamera(page);
    if (!camera) ctx.fail(`run ${run}: canvas camera is unavailable`);
    const clear = await ctx.clearArea();
    if (!clear) ctx.fail(`run ${run}: no canvas surface found`);

    let pick = await pickScreen(ctx);
    if (!pick) {
      await bringTitleBarIntoReach(ctx);
      pick = await pickScreen(ctx);
    }
    if (!pick) {
      const diag = await page.evaluate(() =>
        [...document.querySelectorAll("[data-screen-shell]")]
          .map((s) => {
            const c = s
              .querySelector("[data-screen-content]")
              ?.getBoundingClientRect();
            const b = s.firstElementChild?.getBoundingClientRect();
            return c &&
              b &&
              c.right > 0 &&
              c.left < 1280 &&
              c.bottom > 0 &&
              c.top < 720
              ? [c.left, c.top, c.right, c.bottom, b.top, b.height]
                  .map(Math.round)
                  .join(",")
              : null;
          })
          .filter(Boolean),
      );
      ctx.fail(
        `run ${run}: no screen fits inside the clear area ${JSON.stringify(clear)} ${JSON.stringify(diag)}`,
      );
    }
    const originalPersisted = await readPersistedPosition(ctx, pick.frameId);
    const originalLeft = pick.content.left;
    const originalTop = pick.content.top;

    const roomRight = clear.right - (pick.content.left + pick.content.width);
    const roomLeft = pick.content.left - clear.left;
    const direction =
      roomRight >= DRAG_DISTANCE_PX
        ? 1
        : roomLeft >= DRAG_DISTANCE_PX
          ? -1
          : roomRight >= roomLeft
            ? 1
            : -1;
    const room = Math.max(roomRight, roomLeft);
    const distancePx =
      room >= DRAG_DISTANCE_PX
        ? DRAG_DISTANCE_PX
        : Math.floor((room * ROOM_USED_FRACTION) / 10) * 10;
    if (distancePx < MIN_DRAG_DISTANCE_PX) {
      ctx.fail(
        `run ${run}: only ${Math.round(room)}px of room to drag (need ${Math.ceil(MIN_DRAG_DISTANCE_PX / ROOM_USED_FRACTION)}px; screen ${JSON.stringify(pick.content)}, clear area ${JSON.stringify(clear)})`,
      );
    }
    const dragDistancePx = direction * distancePx;

    const start = await ctx.checkpoint("start");
    if (!start.visible) ctx.fail(`run ${run}: start shows no screens`);

    await page.mouse.click(pick.titleAt.x, pick.titleAt.y);
    await page.waitForTimeout(SETTLE_AFTER_LEG_MS);
    if (!(await selectionBoxMatches(ctx, pick.frameId))) {
      ctx.fail(
        `run ${run}: clicking the title of ${pick.frameId} did not select it (no matching [data-frame-selection-box])`,
      );
    }
    const unmoved = await readContentLeft(ctx, pick.frameId);
    if (unmoved === null || Math.abs(unmoved - originalLeft) > 1) {
      ctx.fail(`run ${run}: the selecting click moved the screen`);
    }

    onFirstMove({ frameId: pick.frameId, original: originalPersisted });
    const out = await dragLeg(ctx, pick, dragDistancePx, `run ${run} drag out`);
    const dragged = await ctx.checkpoint("dragged");
    if (!dragged.visible) ctx.fail(`run ${run}: dragged shows no screens`);
    const movedPx = out.dx;
    if (
      Math.sign(movedPx) !== direction ||
      Math.abs(Math.abs(movedPx) - distancePx) > distancePx * MOVE_TOLERANCE
    ) {
      ctx.fail(
        `run ${run}: the screen moved ${round(movedPx)}px, expected about ${dragDistancePx}px`,
      );
    }

    const expectedWorldDx = movedPx / camera.scale;
    const savedOut = await waitForPersisted(ctx, pick.frameId, (position) => {
      const dx = position.x - originalPersisted.x;
      const dy = position.y - originalPersisted.y;
      return (
        Math.abs(dx - expectedWorldDx) <=
          SAVE_TOLERANCE_PX / camera.scale + PERSIST_TOLERANCE &&
        Math.abs(dy) <= SAVE_TOLERANCE_PX / camera.scale + PERSIST_TOLERANCE
      );
    });
    const persistedOut = savedOut.position;
    if (!savedOut.accepted) {
      ctx.fail(
        `run ${run}: the drag out was not saved: persisted ${JSON.stringify(persistedOut)} after ${PERSIST_TIMEOUT_MS / 1000}s, original ${JSON.stringify(originalPersisted)}, expected a move of about ${round(expectedWorldDx)} world px`,
      );
    }

    const moved = await pickScreen(ctx, pick.frameId);
    if (!moved) {
      ctx.fail(`run ${run}: the dragged screen is no longer grabbable in view`);
    }
    const back = await dragLeg(ctx, moved, -movedPx, `run ${run} drag back`);
    const endLeft = await readContentLeft(ctx, pick.frameId);
    const endTop = await page.evaluate(
      (frameId) =>
        document
          .querySelector(
            `[data-screen-shell][data-frame-id="${frameId}"] [data-screen-content]`,
          )
          ?.getBoundingClientRect().top ?? null,
      pick.frameId,
    );
    if (endLeft === null || endTop === null) {
      ctx.fail(`run ${run}: the screen vanished after dragging back`);
    }
    const returnedErrorPx = Math.hypot(
      endLeft - originalLeft,
      endTop - originalTop,
    );
    const end = await ctx.checkpoint("end");
    if (!end.visible) ctx.fail(`run ${run}: end shows no screens`);

    const persistedError = (position: Point) =>
      Math.hypot(
        position.x - originalPersisted.x,
        position.y - originalPersisted.y,
      );
    const savedBack = await waitForPersisted(
      ctx,
      pick.frameId,
      (position) => persistedError(position) <= PERSIST_TOLERANCE,
    );
    await page.waitForTimeout(1000);
    const persisted = await readPersistedPosition(ctx, pick.frameId);
    const persistedErrorWorld = persistedError(persisted);

    if (returnedErrorPx > RETURN_TOLERANCE_PX) {
      ctx.fail(
        `run ${run}: the screen is ${round(returnedErrorPx)}px from where it started after dragging back (persisted error ${round(persistedErrorWorld)} world px)`,
      );
    }
    if (!savedBack.accepted || persistedErrorWorld > PERSIST_TOLERANCE) {
      ctx.fail(
        `run ${run}: the saved position ${JSON.stringify(persisted)} is not the original ${JSON.stringify(originalPersisted)}`,
      );
    }

    const legs = [out, back];
    const frames = legs.flatMap((leg) => leg.frames);
    if (!frames.length) ctx.fail(`run ${run} sampled no frames`);
    const latencies = legs.flatMap((leg) => leg.latencies);
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const dropIntervals = legs.flatMap((leg) => leg.dropFrames);
    const sortedDrop = [...dropIntervals].sort((a, b) => a - b);
    return {
      frames,
      longFrames: legs.flatMap((leg) => leg.longFrames),
      extra: {
        dragDistancePx,
        movedPx,
        returnedErrorPx,
        persistedOutWorld: persistedOut,
        persistedBackWorld: persisted,
        persistedErrorWorldPx: persistedErrorWorld,
        steps: DRAG_STEPS,
        legFrameCounts: legs.map((leg) => leg.frames.length),
        frameId: pick.frameId,
        inputToFrameMsMedian: latencies.length ? median(latencies) : null,
        inputToFrameMsMax: sortedLatencies.length
          ? sortedLatencies[sortedLatencies.length - 1]
          : null,
        latencySamples: latencies.length,
        dropWindowMs: DROP_WINDOW_MS,
        drop: {
          frameCount: dropIntervals.length,
          frameP95Ms: sortedDrop.length ? percentile(sortedDrop, 0.95) : null,
          frameWorstMs: sortedDrop.length
            ? sortedDrop[sortedDrop.length - 1]
            : null,
          framesOver50Ms: dropIntervals.filter((ms) => ms > LONG_FRAME_MS)
            .length,
        },
        dropFrames: legs.map((leg) => ({
          worstMs: Math.max(0, ...leg.dropFrames),
          over50Ms: leg.dropFrames.filter((ms) => ms > LONG_FRAME_MS).length,
          longAnimationFrames: leg.dropLongFrames.length,
          frames: leg.dropFrames.length,
        })),
      },
    };
  }
}

const action: CanvasBenchAction = {
  name: "drag",
  mutatesDesign: true,
  async run(ctx: ActionContext) {
    const pending: { restore: Restore } = { restore: null };
    try {
      return await runDrag(ctx, (value) => {
        pending.restore = value;
      });
    } catch (error) {
      if (!pending.restore) throw error;
      const { frameId, original } = pending.restore;
      const outcome = await restorePersisted(ctx, frameId, original);
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof SanityFailure) {
        throw new SanityFailure(`${message} [${outcome}]`);
      }
      throw new Error(`${message} [${outcome}]`);
    }
  },
};

export default action;
