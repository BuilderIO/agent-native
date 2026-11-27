import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { median, round } from "./lib.ts";

const MIN_RUNS = 3;
const IDLE_HZ_TOLERANCE = 0.05;
const FRAME_METRICS = [
  "frameP50Ms",
  "frameP95Ms",
  "frameWorstMs",
  "framesOver50Ms",
  "longAnimationFrameCount",
] as const;
const HIGHER_IS_BETTER = new Set([
  "fps",
  "achievedPxPerSecond",
  "achievedTicksPerSecond",
]);
const LOWER_IS_BETTER =
  /(Ms|Mb|Count)$|^(longTasks|inputToFrameMs.*|returnedErrorPx|persistedErrorWorldPx)$/;
const NEUTRAL = new Set([
  "durationMs",
  "dropWindowMs",
  "wheelElapsedMs",
  "idleFrameMsExpected",
  "visibleScreenCount",
  "liveIframesAtEnd",
  "liveIframesAtStart",
  "liveIframesAtPeak",
  "staticPreviewsAtPeak",
  "liveIframesMax",
  "liveScreensDistinct",
  "cameraMovedPx",
  "drop.frameCount",
]);
const FLATTENED_EXTRAS = ["drop"];

type ActionEntry = Record<string, unknown> & {
  extra?: Record<string, unknown>;
  idleHz?: number | null;
  checkpoints?: { name: string; visible: number; loaded: number }[];
};
type Bench = {
  numbersValid: boolean;
  injectedJank?: { busyMs: number; everyMs: number } | null;
  breakInput?: boolean;
  numbersInvalidReasons?: string[];
  failures?: { run: number; action: string; message: string }[];
  osFocusCheck?: string;
  designId?: string;
  copies: number | null;
  source?: { id: string | null; title: string; contentHash?: string } | null;
  screenCount: number;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  runs: { run: number; actions: Record<string, ActionEntry> }[];
};

class NotComparable extends Error {}

const load = (arg: string): { path: string; bench: Bench } => {
  const path =
    existsSync(arg) && statSync(arg).isDirectory()
      ? join(arg, "canvas-bench.json")
      : arg;
  if (!existsSync(path)) throw new NotComparable(`no result at ${path}`);
  const bench = JSON.parse(readFileSync(path, "utf8")) as Bench;
  if (!Array.isArray(bench.runs)) {
    throw new NotComparable(`${path} is not a canvas-bench result`);
  }
  if (bench.injectedJank || bench.breakInput) {
    throw new NotComparable(
      `${path} is a harness test (injectedJank ${JSON.stringify(bench.injectedJank ?? null)}, breakInput ${bench.breakInput ?? false}), not a measurement`,
    );
  }
  if (bench.failures?.length) {
    throw new NotComparable(
      `${path} has ${bench.failures.length} failed action run(s): ${bench.failures.map((f) => `run ${f.run} [${f.action}]: ${f.message}`).join("; ")}`,
    );
  }
  if (!bench.numbersValid) {
    throw new NotComparable(
      `${path} has invalid numbers: ${(bench.numbersInvalidReasons ?? []).join("; ")}`,
    );
  }
  return { path, bench };
};

const extraValue = (entry: ActionEntry, metric: string): unknown => {
  const extra = entry.extra ?? {};
  const dot = metric.indexOf(".");
  if (dot === -1) return extra[metric];
  const nested = extra[metric.slice(0, dot)];
  return nested && typeof nested === "object"
    ? (nested as Record<string, unknown>)[metric.slice(dot + 1)]
    : undefined;
};

const extraKeys = (bench: Bench, action: string): string[] =>
  bench.runs.flatMap(({ actions }) =>
    Object.entries(actions[action]?.extra ?? {}).flatMap(([key, value]) => {
      if (typeof value === "number") return [key];
      if (
        FLATTENED_EXTRAS.includes(key) &&
        value &&
        typeof value === "object"
      ) {
        return Object.entries(value)
          .filter((entry) => typeof entry[1] === "number")
          .map(([name]) => `${key}.${name}`);
      }
      return [];
    }),
  );

const series = (bench: Bench, action: string, metric: string): number[] =>
  bench.runs.flatMap(({ actions }) => {
    const entry = actions[action] as ActionEntry | undefined;
    if (!entry) return [];
    const value = metric in entry ? entry[metric] : extraValue(entry, metric);
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  });

const direction = (metric: string): 1 | -1 | 0 =>
  NEUTRAL.has(metric)
    ? 0
    : HIGHER_IS_BETTER.has(metric)
      ? 1
      : LOWER_IS_BETTER.test(metric)
        ? -1
        : 0;

const verdict = (metric: string, base: number[], change: number[]): string => {
  if (base.length < MIN_RUNS || change.length < MIN_RUNS) return "too few runs";
  const baseMedian = median(base);
  const changeMedian = median(change);
  const outside = (value: number, values: number[]) =>
    value < Math.min(...values) || value > Math.max(...values);
  if (!outside(changeMedian, base) || !outside(baseMedian, change)) {
    return "no measurable change";
  }
  const dir = direction(metric);
  if (dir === 0) return "changed";
  return (changeMedian - baseMedian) * dir > 0 ? "better" : "worse";
};

const medianOrNull = (values: number[]) =>
  values.length ? median(values) : null;

const fmtRange = (values: number[]) =>
  values.length
    ? `${round(median(values))} (${round(Math.min(...values))}–${round(Math.max(...values))})`
    : "n/a";

const actionNames = (bench: Bench) =>
  new Set(bench.runs.flatMap(({ actions }) => Object.keys(actions)));

const subject = (bench: Bench): "design" | "source" | "seeded" =>
  bench.source ? "source" : bench.copies === null ? "design" : "seeded";

const assertComparable = (base: Bench, change: Bench) => {
  const problems: string[] = [];
  if (subject(base) !== subject(change)) {
    problems.push(
      `different kinds of board: ${subject(base)} vs ${subject(change)}`,
    );
  } else if (subject(base) === "design") {
    if (!base.designId || base.designId !== change.designId) {
      problems.push(
        `design ${base.designId ?? "unknown"} vs ${change.designId ?? "unknown"}`,
      );
    }
  } else if (subject(base) === "source") {
    if (!base.source?.contentHash || !change.source?.contentHash) {
      problems.push(
        "a result has no source.contentHash, so the sources cannot be matched",
      );
    } else if (base.source.contentHash !== change.source.contentHash) {
      problems.push(
        `source file content differs (${base.source.title} ${base.source.contentHash.slice(0, 12)} vs ${change.source.title} ${change.source.contentHash.slice(0, 12)})`,
      );
    }
  } else if (base.copies !== change.copies) {
    problems.push(`copies ${base.copies} vs ${change.copies}`);
  }
  if (base.screenCount !== change.screenCount) {
    problems.push(`screenCount ${base.screenCount} vs ${change.screenCount}`);
  }
  if (
    base.viewport.width !== change.viewport.width ||
    base.viewport.height !== change.viewport.height ||
    base.deviceScaleFactor !== change.deviceScaleFactor
  ) {
    problems.push("viewport or device scale factor differ");
  }
  for (const name of actionNames(base)) {
    if (!actionNames(change).has(name)) continue;
    const baseHz = medianOrNull(series(base, name, "idleHz"));
    const changeHz = medianOrNull(series(change, name, "idleHz"));
    if (
      baseHz !== null &&
      changeHz !== null &&
      Math.abs(baseHz - changeHz) / baseHz > IDLE_HZ_TOLERANCE
    ) {
      problems.push(
        `[${name}] idle refresh ${round(baseHz)} Hz vs ${round(changeHz)} Hz (different display or power state)`,
      );
    }
    const baseMethod = medianOrNull(series(base, name, "panMethod"));
    const changeMethod = medianOrNull(series(change, name, "panMethod"));
    if (baseMethod !== changeMethod) {
      problems.push(
        `[${name}] pan method ${baseMethod ?? "unversioned"} vs ${changeMethod ?? "unversioned"} (re-run the baseline with the same bench)`,
      );
    }
    const baseCount = medianOrNull(series(base, name, "visibleScreenCount"));
    const changeCount = medianOrNull(
      series(change, name, "visibleScreenCount"),
    );
    if (
      baseCount !== null &&
      changeCount !== null &&
      baseCount !== changeCount
    ) {
      problems.push(
        `[${name}] visibleScreenCount ${baseCount} vs ${changeCount} (a different number of screens was on screen)`,
      );
    }
  }
  if (problems.length) {
    throw new NotComparable(`runs are not comparable: ${problems.join("; ")}`);
  }
};

const blankCheckpoints = (bench: Bench, action: string) =>
  bench.runs.flatMap(({ run, actions }) =>
    (actions[action]?.checkpoints ?? [])
      .filter((checkpoint) => checkpoint.loaded < checkpoint.visible)
      .map(
        (checkpoint) =>
          `run ${run} ${checkpoint.name}: ${checkpoint.visible - checkpoint.loaded} of ${checkpoint.visible} visible screens not loaded`,
      ),
  );

const assertNoBlankScreens = (label: string, bench: Bench) => {
  const blanks = [...actionNames(bench)].flatMap((name) =>
    blankCheckpoints(bench, name).map((line) => `[${name}] ${line}`),
  );
  if (blanks.length) {
    throw new NotComparable(
      `visible screens did not load in the ${label}, verdicts would be invalid: ${blanks.join("; ")}`,
    );
  }
};

try {
  const [baseArg, changeArg] = process.argv.slice(2);
  if (!baseArg || !changeArg) {
    throw new NotComparable(
      "usage: pnpm perf:canvas-bench:compare <baseline> <change>",
    );
  }
  const base = load(baseArg);
  const change = load(changeArg);
  assertComparable(base.bench, change.bench);
  assertNoBlankScreens("baseline", base.bench);
  assertNoBlankScreens("change", change.bench);

  console.log(`Baseline: ${base.path} (${base.bench.runs.length} runs)`);
  console.log(`Change:   ${change.path} (${change.bench.runs.length} runs)`);
  for (const [label, bench] of [
    ["baseline", base.bench],
    ["change", change.bench],
  ] as const) {
    if (bench.osFocusCheck !== "enabled") {
      console.log(
        `Note: ${label} ran without the OS focus check (${bench.osFocusCheck ?? "missing"}).`,
      );
    }
  }
  console.log(
    "\nValues are median (min–max) across runs. A verdict needs the medians to sit outside each other's range.",
  );

  const shared = [...actionNames(base.bench)].filter((name) =>
    actionNames(change.bench).has(name),
  );
  if (!shared.length) throw new NotComparable("no action ran in both results");

  for (const name of shared) {
    const metrics = new Set<string>([
      ...FRAME_METRICS,
      ...extraKeys(base.bench, name),
      ...extraKeys(change.bench, name),
    ]);
    console.log(`\n### ${name}\n`);
    console.log("| Metric | Baseline | Change | Verdict |");
    console.log("| --- | --- | --- | --- |");
    for (const metric of metrics) {
      const baseValues = series(base.bench, name, metric);
      const changeValues = series(change.bench, name, metric);
      if (!baseValues.length && !changeValues.length) continue;
      console.log(
        `| ${metric} | ${fmtRange(baseValues)} | ${fmtRange(changeValues)} | ${verdict(metric, baseValues, changeValues)} |`,
      );
    }
  }
} catch (error) {
  console.error(
    error instanceof NotComparable ? `Error: ${error.message}` : error,
  );
  process.exit(2);
}
