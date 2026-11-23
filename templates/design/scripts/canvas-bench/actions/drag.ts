// Drags one whole screen ~500px sideways by its title bar and drags it back.
// The sampled window runs from after mouse.down through mouse.up plus a fixed
// DROP_WINDOW_MS, so the cost of committing the drop is included and reported
// separately as dropFrames. The saved position is polled after each leg: the
// drag out must persist about the dragged distance and the drag back the
// original again. A design that is left moved is restored if a check fails.
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
} from "../lib.ts";

const DRAG_DISTANCE_PX = 500;
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

// Nearest-to-centre screen whose title bar and horizontal extent are in the
// clear area (screens are taller than the viewport, so their bottoms are not) and whose title bar is what the pointer would really hit.
const pickScreen = (
  ctx: ActionContext,
  frameId?: string,
): Promise<Pick | null> =>
  ctx.page.evaluate(
    ({ frameId, margin }) => {
      const clear = (window as any).__bench.clearArea();
      if (!clear) return null;
      const cx = (clear.left + clear.right) / 2;
      const cy = (clear.top + clear.bottom) / 2;
      let best: (Pick & { distance: number }) | null = null;
      for (const shell of document.querySelectorAll<HTMLElement>(
        "[data-screen-shell][data-frame-id]",
      )) {
        const id = shell.getAttribute("data-frame-id")!;
        if (frameId && id !== frameId) continue;
        const content = shell
          .querySelector("[data-screen-content]")
          ?.getBoundingClientRect();
        const bar = shell.firstElementChild?.getBoundingClientRect();
        if (!content || !bar || content.width <= 24 || bar.height < 2) continue;
        if (
          content.left < clear.left ||
          content.right > clear.right ||
          bar.top < clear.top + margin ||
          bar.bottom > clear.bottom - margin
        ) {
          continue;
        }
        const titleAt = {
          x: bar.left + bar.width / 2,
          y: bar.top + bar.height / 2,
        };
        const hit = document.elementFromPoint(titleAt.x, titleAt.y);
        if (hit?.closest("[data-screen-shell]") !== shell) continue;
        const distance = Math.hypot(
          content.left + content.width / 2 - cx,
          content.top + content.height / 2 - cy,
        );
        if (!best || distance < best.distance) {
          best = {
            frameId: id,
            titleAt,
            content: {
              left: content.left,
              top: content.top,
              width: content.width,
              height: content.height,
            },
            distance,
          };
        }
      }
      return (
        best && {
          frameId: best.frameId,
          titleAt: best.titleAt,
          content: best.content,
        }
      );
    },
    { frameId, margin: SCREEN_MARGIN_PX },
  );

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

// Records, for every mousemove, the delay until the next frame in which the
// shell's inline style changed. Reads only the style string, which forces no layout.
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
    (window as any).__dragProbe = probe;
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
    const probe = (window as any).__dragProbe;
    probe.on = false;
    return probe.latencies as number[];
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
  // Second window opens before mouse.up so the drop commit is inside it.
  await ctx.sampler.start();
  await page.mouse.up();
  await page.waitForTimeout(DROP_WINDOW_MS);
  const drop = await ctx.sampler.stop();
  const latencies = await collectLatencies(ctx);
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

// Polls the saved position until `accept` holds, so a leg that never saved
// fails instead of passing on a stale value.
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

// Puts the saved position back so a failed run does not leave a real design
// moved. Waits first so a save still in flight cannot land after the restore.
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

// What a failed run needs to put the design back: set once the first drag
// starts, since nothing before it can move the screen.
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

    const pick = await pickScreen(ctx);
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

    // Drag toward whichever side has room for the whole distance.
    // Measured from the screen's edges, with no margin: the moved screen only has to stay
    // whole in the clear area, which is all pickScreen needs to grab it again.
    const roomRight = clear.right - (pick.content.left + pick.content.width);
    const roomLeft = pick.content.left - clear.left;
    const direction = roomRight >= DRAG_DISTANCE_PX ? 1 : -1;
    if (Math.max(roomRight, roomLeft) < DRAG_DISTANCE_PX) {
      ctx.fail(
        `run ${run}: only ${Math.round(Math.max(roomRight, roomLeft))}px of room to drag ${DRAG_DISTANCE_PX}px (screen ${JSON.stringify(pick.content)}, clear area ${JSON.stringify(clear)})`,
      );
    }
    const dragDistancePx = direction * DRAG_DISTANCE_PX;

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
      Math.abs(Math.abs(movedPx) - DRAG_DISTANCE_PX) >
        DRAG_DISTANCE_PX * MOVE_TOLERANCE
    ) {
      ctx.fail(
        `run ${run}: the screen moved ${round(movedPx)}px, expected about ${dragDistancePx}px`,
      );
    }

    // The out leg must have been saved: about the dragged distance in world px.
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

    // Grab the title bar where it is now and drag back by what actually moved.
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

    // The saved position must be the original again, or later runs see a moved screen.
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
        // Drop-window rAF intervals of both legs, so compare can rank the commit cost.
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
  async run(ctx: ActionContext) {
    let restore: Restore = null;
    try {
      return await runDrag(ctx, (value) => {
        restore = value;
      });
    } catch (error) {
      if (!restore) throw error;
      const { frameId, original } = restore as NonNullable<Restore>;
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
