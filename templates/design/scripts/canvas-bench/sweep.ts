import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { liveBenchLockHolder } from "./lib.ts";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    axis: { type: "string" },
    steps: { type: "string" },
    runs: { type: "string", default: "3" },
    out: { type: "string" },
    actions: { type: "string", default: "load,idle,zoom,pan,pan-zoomed" },
    fixed: { type: "string", default: "" },
    tag: { type: "string", default: "" },
    "keep-going": { type: "boolean", default: false },
  },
});

const AXES: Record<string, string> = {
  screens: "--screens",
  dom: "--dom",
  height: "--height",
  "image-mp": "--image-mp",
  loops: "--loops",
};
const axis = values.axis ?? "";
const flag = AXES[axis];
if (!flag)
  throw new Error(`--axis must be one of ${Object.keys(AXES).join(", ")}`);
if (!values["base-url"]) throw new Error("--base-url is required");
if (!values.out) throw new Error("--out is required");
const steps = (values.steps ?? "").split(",").filter(Boolean);
if (!steps.length) throw new Error("--steps is required");

const designDir = fileURLToPath(new URL("../..", import.meta.url));
const out = values.out.startsWith("/")
  ? values.out
  : `${process.cwd()}/${values.out}`;
const label = `${axis}${values.tag ? `+${values.tag}` : ""}`;
const fixed = values.fixed.split(" ").filter(Boolean);
mkdirSync(`${out}/sources`, { recursive: true });
mkdirSync(`${out}/runs`, { recursive: true });

const BROKEN_P95_MS = 33.4;

async function waitForQuietMachine() {
  for (let i = 0; i < 120; i += 1) {
    const other = liveBenchLockHolder();
    if (!other) return;
    console.log(`another benchmark is running (${other}); waiting 30s`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  throw new Error("another benchmark kept running for 60 minutes");
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  const at = (index: number) => s[index] ?? 0;
  return s.length % 2 ? at(mid) : (at(mid - 1) + at(mid)) / 2;
};
const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);

type ActionJson = {
  extra?: Record<string, unknown>;
  [metric: string]: unknown;
};
type BenchJson = {
  actionNames: string[];
  runs: { actions?: Record<string, ActionJson | undefined> }[];
  numbersValid: boolean;
  numbersInvalidReasons: string[];
  failures: { run: number; action: string; message: string }[];
  screenCount: number;
};
type ActionSummary = Record<string, number | number[] | null>;
type StepSummary = {
  exit: number;
  resultFolder: string | null;
  numbersValid: boolean;
  reason?: string;
  reasons?: string[];
  failures?: string[];
  screenCount?: number;
  perAction?: Record<string, ActionSummary>;
};

function summarize(runDir: string, exit: number): StepSummary {
  const dirs = existsSync(runDir)
    ? readdirSync(runDir).filter((d) =>
        existsSync(`${runDir}/${d}/canvas-bench.json`),
      )
    : [];
  const newest = [...dirs].sort().pop();
  if (!newest)
    return {
      exit,
      resultFolder: null,
      numbersValid: false,
      reason: "no canvas-bench.json written",
    };
  const folder = `${runDir}/${newest}`;
  const json = JSON.parse(
    readFileSync(`${folder}/canvas-bench.json`, "utf8"),
  ) as BenchJson;
  const numbers = (list: unknown[]) =>
    list.filter((v): v is number => typeof v === "number");
  const perAction: Record<string, ActionSummary> = {};
  for (const name of json.actionNames) {
    const rows = json.runs.flatMap((r) => {
      const row = r.actions?.[name];
      return row ? [row] : [];
    });
    const col = (k: string) => numbers(rows.map((r) => r[k]));
    const ex = (k: string) => numbers(rows.map((r) => r.extra?.[k]));
    perAction[name] = {
      n: rows.length,
      p50: r1(median(col("frameP50Ms"))),
      p95: r1(median(col("frameP95Ms"))),
      p95All: col("frameP95Ms").map((v) => r1(v) ?? v),
      worst: r1(median(col("frameWorstMs"))),
      over50: median(col("framesOver50Ms")),
      loaf: median(col("longAnimationFrameCount")),
      idleHz: r1(median(col("idleHz"))),
      ready: r1(median(col("readyMs"))),
      allVisibleReadyMs: r1(median(ex("allVisibleReadyMs"))),
      canvasMountedMs: r1(median(ex("canvasMountedMs"))),
      heapUsedMb: r1(median(ex("heapUsedMb"))),
      liveIframesMax: median(ex("liveIframesMax")),
      fps: r1(median(ex("fps"))),
      steadyP95Ms: r1(median(ex("steadyP95Ms"))),
      gestureEdgeWorstMs: r1(median(ex("gestureEdgeWorstMs"))),
      framesOver100Ms: median(ex("framesOver100Ms")),
    };
  }
  return {
    exit,
    resultFolder: folder,
    numbersValid: json.numbersValid,
    reasons: json.numbersInvalidReasons,
    failures: json.failures.map(
      (f) => `run ${f.run} [${f.action}]: ${f.message.slice(0, 300)}`,
    ),
    screenCount: json.screenCount,
    perAction,
  };
}

let brokenStreak = 0;
for (const step of steps) {
  await waitForQuietMachine();
  const name = `${label}-${step}`;
  const source = `${out}/sources/${name}.json`;
  execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "scripts/canvas-bench/make-sweep-source.ts",
      ...fixed,
      flag,
      step,
      "--out",
      source,
      "--title",
      `bp ${name}`,
    ],
    {
      cwd: designDir,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  const runDir = `${out}/runs/${name}`;
  let result: StepSummary = {
    exit: -1,
    resultFolder: null,
    numbersValid: false,
  };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    rmSync(runDir, { recursive: true, force: true });
    console.log(`=== ${name} (attempt ${attempt}) ===`);
    const proc = spawnSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "scripts/canvas-bench/canvas-bench.ts",
        "--base-url",
        values["base-url"],
        "--source",
        source,
        "--action",
        values.actions,
        "--runs",
        values.runs,
        "--out",
        runDir,
      ],
      {
        cwd: designDir,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        shell: process.platform === "win32",
      },
    );
    mkdirSync(runDir, { recursive: true });
    appendFileSync(`${runDir}/console.log`, `${proc.stdout}\n${proc.stderr}`);
    result = summarize(runDir, proc.status ?? -1);
    const spoiled = !result.numbersValid && !result.failures?.length;
    if (!spoiled) break;
  }
  const actionsP95 = ["zoom", "pan", "pan-zoomed"]
    .map((a) => result.perAction?.[a]?.["p95"])
    .filter((v): v is number => typeof v === "number");
  const broken =
    result.exit !== 0 ||
    result.numbersValid !== true ||
    actionsP95.some((v) => v > BROKEN_P95_MS);
  const record = { axis, step, label, fixed, broken, ...result };
  appendFileSync(`${out}/results.jsonl`, `${JSON.stringify(record)}\n`);
  console.log(JSON.stringify(record, null, 1).slice(0, 3000));
  brokenStreak = broken ? brokenStreak + 1 : 0;
  if (brokenStreak >= 2 && !values["keep-going"]) {
    console.log(`two steps in a row broken on ${axis}; stopping this axis`);
    break;
  }
}
