import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

import { percentile } from "./frame-cadence.ts";

interface TraceEvent {
  name: string;
  pid: number;
  tid: number;
  ts: number;
  tts?: number;
  tdur?: number;
  ph: string;
  dur?: number;
  args?: { data?: { type?: string } };
}

function categoryCpu(events: TraceEvent[], clock: number[]) {
  const spans: { start: number; end: number }[] = [];
  for (const event of events) {
    if (event.tts !== undefined && event.tdur !== undefined && event.tdur > 0)
      spans.push({ start: event.tts, end: event.tts + event.tdur });
  }
  spans.sort((a, b) => a.start - b.start);
  const result = Array<number>(clock.length - 1).fill(0);
  let frame = 0;
  let previousEnd = clock[0];
  for (const span of spans) {
    let start = Math.max(previousEnd, span.start);
    if (start >= span.end) continue;
    previousEnd = span.end;
    while (frame < result.length && clock[frame + 1] <= start) frame++;
    while (frame < result.length && start < span.end) {
      const end = Math.min(clock[frame + 1], span.end);
      result[frame] += (end - start) / 1000;
      start = end;
      if (end === clock[frame + 1]) frame++;
    }
  }
  return result;
}

function summarizeDrag(events: TraceEvent[]) {
  const pointers = events
    .filter(
      (event) =>
        event.name === "EventDispatch" &&
        ["pointerdown", "pointerup"].includes(event.args?.data?.type ?? ""),
    )
    .sort((a, b) => a.ts - b.ts);
  let pressed: TraceEvent | undefined;
  let drag: { start: TraceEvent; end: TraceEvent } | undefined;
  for (const event of pointers) {
    if (event.args?.data?.type === "pointerdown") {
      pressed = event;
    } else if (
      pressed &&
      pressed.pid === event.pid &&
      pressed.tid === event.tid
    ) {
      if (!drag || event.ts - pressed.ts > drag.end.ts - drag.start.ts)
        drag = { start: pressed, end: event };
      pressed = undefined;
    }
  }
  assert.ok(drag, "Trace has no complete pointer gesture");
  const { start, end } = drag;
  const dragMs = (end.ts - start.ts) / 1000;
  assert.ok(dragMs >= 10_000, "Trace has no full workspace benchmark drag");
  const renderer = events.filter(
    (event) => event.pid === start.pid && event.tid === start.tid,
  );
  const frames = renderer
    .filter(
      (event) =>
        event.name === "BeginMainThreadFrame" &&
        event.ts >= start.ts &&
        event.ts <= end.ts,
    )
    .sort((a, b) => a.ts - b.ts);
  assert.ok(
    frames.length >= 2,
    "Trace has fewer than two renderer frames during the drag",
  );
  const clock = frames.map((frame) => {
    assert.ok(
      Number.isFinite(frame.tts) && typeof frame.tts === "number",
      "Trace has missing or inconsistent renderer thread timestamps",
    );
    return frame.tts;
  });
  assert.ok(
    typeof start.tts === "number" &&
      typeof end.tts === "number" &&
      typeof end.tdur === "number",
    "Trace is missing renderer CPU timing for pointer press or release",
  );
  const pressToFirstFrame = (clock[0] - start.tts) / 1000;
  const lastFrameThroughRelease =
    (end.tts + end.tdur - clock[clock.length - 1]) / 1000;
  assert.ok(
    pressToFirstFrame >= 0 && lastFrameThroughRelease >= 0,
    "Inconsistent gesture boundary clocks",
  );
  const cpu = clock.slice(1).map((end, index) => (end - clock[index]) / 1000);
  assert.ok(
    cpu.every((ms) => ms >= 0),
    "Renderer CPU clock moved backwards",
  );
  const slow = cpu
    .map((ms, index) => (ms > 1000 / 120 ? index : -1))
    .filter((index) => index >= 0);
  let longestOverBudgetRun = 0;
  let currentRun = 0;
  for (const [position, frame] of slow.entries()) {
    currentRun =
      position > 0 && frame === slow[position - 1] + 1 ? currentRun + 1 : 1;
    longestOverBudgetRun = Math.max(longestOverBudgetRun, currentRun);
  }
  const categories = {
    script: (name: string) =>
      name === "FunctionCall" || name === "EvaluateScript",
    layoutAndStyle: (name: string) =>
      name === "Layout" || name === "UpdateLayoutTree",
    paintAndLayerize: (name: string) =>
      name === "PrePaint" || name === "Paint" || name === "Layerize",
    garbageCollection: (name: string) =>
      name === "MinorGC" || name === "MajorGC" || name.startsWith("V8.GC_"),
  };
  const slices = renderer.filter(
    (event) =>
      event.ph === "X" &&
      event.ts < frames[frames.length - 1].ts &&
      event.ts + (event.dur ?? 0) >= frames[0].ts,
  );
  const inclusiveCpuMs = Object.fromEntries(
    Object.entries(categories).map(([name, matches]) => {
      const category = slices.filter((event) => matches(event.name));
      const samples = categoryCpu(category, clock);
      return [
        name,
        {
          untimedSlices: category.filter(
            (event) => event.tts === undefined || event.tdur === undefined,
          ).length,
          meanPerInterval:
            samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
          meanPerOverBudgetInterval: slow.length
            ? slow.reduce((sum, index) => sum + samples[index], 0) / slow.length
            : null,
          overBudgetIntervalsContainingCategory: slow.filter(
            (index) => samples[index] > 0,
          ).length,
        },
      ];
    }),
  );
  return {
    dragMs,
    frameIntervals: cpu.length,
    boundaryCpuMs: { pressToFirstFrame, lastFrameThroughRelease },
    totalGestureRendererCpuMs: (end.tts + end.tdur - start.tts) / 1000,
    rendererCpuMs: {
      p50: percentile(cpu, 0.5),
      p95: percentile(cpu, 0.95),
      p99: percentile(cpu, 0.99),
      max: Math.max(...cpu),
    },
    intervalsOver8_33ms: slow.length,
    longestConsecutiveIntervalsOver8_33ms: longestOverBudgetRun,
    intervalsOver16_67ms: cpu.filter((ms) => ms > 1000 / 60).length,
    inclusiveCpuMs,
  };
}

const paths = process.argv.slice(2);
assert.ok(
  paths.length,
  "Pass at least one Chromium workspace *-trace.json.gz file",
);
for (const path of paths) {
  const trace: { traceEvents: TraceEvent[] } = JSON.parse(
    gunzipSync(await readFile(path)).toString("utf8"),
  );
  console.log(JSON.stringify({ path, ...summarizeDrag(trace.traceEvents) }));
}
