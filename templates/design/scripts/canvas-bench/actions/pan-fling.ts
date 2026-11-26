import { round, type ActionContext, type CanvasBenchAction } from "../lib.ts";
import { runPan } from "./pan.ts";

const FLING_WHEEL_DELTA = 240;

const action: CanvasBenchAction = {
  name: "pan-fling",
  async run(ctx: ActionContext) {
    const { result, legs, ticks, pxPerTick } = await runPan(ctx, "pan-fling", {
      tickIntervalMs: 0,
      wheelDelta: FLING_WHEEL_DELTA,
    });
    const elapsedMs = legs.reduce((sum, leg) => sum + leg.elapsedMs, 0);
    return {
      ...result,
      extra: {
        ...result.extra,
        achievedTicksPerSecond: round((ticks * legs.length * 1000) / elapsedMs),
        wheelElapsedMs: round(elapsedMs),
        wheelDelta: FLING_WHEEL_DELTA,
        pxPerTick: round(pxPerTick),
        achievedPxPerSecond: round(
          (legs.reduce((sum, leg) => sum + Math.hypot(leg.dx, leg.dy), 0) *
            1000) /
            elapsedMs,
        ),
      },
    };
  },
};

export default action;
