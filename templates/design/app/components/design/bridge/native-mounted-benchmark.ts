export type NativeMountedBenchmarkRequest = {
  warmupRafIntervals: 120;
  measuredRafIntervals: 840;
};

export type NativeBenchmarkStats = {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
};

export const NATIVE_BENCHMARK_PHASE_KEYS = [
  "deviceWallMs",
  "layoutCallWallMs",
  "effectPassesWallMs",
  "finishWallMs",
  "presentWallMs",
  "submitCallWallMs",
  "errorScopeWallMs",
  "postSubmitWallMs",
] as const;

export type NativeBenchmarkPhaseKey =
  (typeof NATIVE_BENCHMARK_PHASE_KEYS)[number];
export type NativeBenchmarkPhaseValues = Record<
  NativeBenchmarkPhaseKey,
  number
>;

export function emptyNativeBenchmarkPhaseValues(): NativeBenchmarkPhaseValues {
  return {
    deviceWallMs: 0,
    layoutCallWallMs: 0,
    effectPassesWallMs: 0,
    finishWallMs: 0,
    presentWallMs: 0,
    submitCallWallMs: 0,
    errorScopeWallMs: 0,
    postSubmitWallMs: 0,
  };
}

export const NATIVE_BENCHMARK_FRAME_PHASE_KEYS = [
  "renderInternalWallMs",
  "deviceWallMs",
  "mountAwaitWallMs",
  "scenePresentationWallMs",
  "retirementWallMs",
] as const;

export const NATIVE_BENCHMARK_SCENE_PHASE_KEYS = [
  "sourceReadWallMs",
  "composeWallMs",
  "encodeWallMs",
  "submitWallMs",
  "errorScopeWallMs",
  "publicationWallMs",
] as const;

export type NativeBenchmarkFullFrameValues = {
  frame: Record<(typeof NATIVE_BENCHMARK_FRAME_PHASE_KEYS)[number], number>;
  scene: Record<(typeof NATIVE_BENCHMARK_SCENE_PHASE_KEYS)[number], number>;
};

export function emptyNativeBenchmarkFullFrameValues(): NativeBenchmarkFullFrameValues {
  return {
    frame: {
      renderInternalWallMs: 0,
      deviceWallMs: 0,
      mountAwaitWallMs: 0,
      scenePresentationWallMs: 0,
      retirementWallMs: 0,
    },
    scene: {
      sourceReadWallMs: 0,
      composeWallMs: 0,
      encodeWallMs: 0,
      submitWallMs: 0,
      errorScopeWallMs: 0,
      publicationWallMs: 0,
    },
  };
}

export type NativeBenchmarkFullFrameWallPhases = {
  scope: "full-render-internal-wall-intervals-not-CPU-or-GPU-time";
  stats: Record<
    (typeof NATIVE_BENCHMARK_FRAME_PHASE_KEYS)[number],
    NativeBenchmarkStats
  >;
  scenePresentation: {
    scope: "nested-in-scene-presentation-wall-intervals-not-CPU-or-GPU-time";
    stats: Record<
      (typeof NATIVE_BENCHMARK_SCENE_PHASE_KEYS)[number],
      NativeBenchmarkStats
    >;
  };
};

export type NativeMountedBenchmarkWindow = {
  warmupRafIntervals: 120;
  measuredRafIntervals: 840;
  measuredRenderFrames: number;
  rafIntervalMs: NativeBenchmarkStats;
  renderWallMs: NativeBenchmarkStats;
  sourceWallMs: NativeBenchmarkStats;
  composeWallMs: NativeBenchmarkStats;
  fullFrameWallPhases?: NativeBenchmarkFullFrameWallPhases;
  hostWallPhases?: {
    scope: "wall-intervals-not-CPU-or-GPU-time";
    stats: Record<NativeBenchmarkPhaseKey, NativeBenchmarkStats>;
  };
  deadlines: { over60Hz: number; over120Hz: number };
};

export class NativeMountedBenchmarkError extends Error {
  readonly code:
    | "benchmark-busy"
    | "benchmark-aborted"
    | "benchmark-hidden"
    | "benchmark-offscreen"
    | "benchmark-timeout"
    | "benchmark-no-render"
    | "benchmark-render-failed"
    | "benchmark-unavailable"
    | "benchmark-source-stale"
    | "benchmark-unpersisted-preview";
  constructor(code: NativeMountedBenchmarkError["code"]) {
    super(code);
    this.code = code;
    this.name = "NativeMountedBenchmarkError";
  }
}

const MAX_INTERVAL_MS = 120_000;
const MAX_RENDER_SAMPLES = 2520;
const RAF_60_HZ_MS = 1000 / 60;
const RAF_120_HZ_MS = 1000 / 120;

export function nativeBenchmarkStats(
  values: readonly number[],
): NativeBenchmarkStats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) =>
    sorted.length
      ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
      : 0;
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: at(1),
  };
}

function nativeBenchmarkWallSumFits(
  total: number,
  intervals: readonly number[],
): boolean {
  const sum = intervals.reduce((value, interval) => value + interval, 0);
  // This allowance covers binary64 arithmetic, not clock resolution or omitted work.
  const roundingBound =
    Number.EPSILON * Math.max(1, total, sum) * (intervals.length + 2);
  return sum <= total + roundingBound;
}

function validNativeBenchmarkFullFrameValues(
  value: NativeBenchmarkFullFrameValues,
  renderWallMs: number,
): boolean {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !value.frame ||
    !value.scene ||
    typeof value.frame !== "object" ||
    typeof value.scene !== "object" ||
    Array.isArray(value.frame) ||
    Array.isArray(value.scene)
  )
    return false;
  if (
    Object.keys(value.frame).length !==
      NATIVE_BENCHMARK_FRAME_PHASE_KEYS.length ||
    Object.keys(value.scene).length !== NATIVE_BENCHMARK_SCENE_PHASE_KEYS.length
  )
    return false;
  return (
    value.frame.renderInternalWallMs === renderWallMs &&
    NATIVE_BENCHMARK_FRAME_PHASE_KEYS.every(
      (key) =>
        Number.isFinite(value.frame[key]) &&
        value.frame[key] >= 0 &&
        value.frame[key] <= renderWallMs,
    ) &&
    NATIVE_BENCHMARK_SCENE_PHASE_KEYS.every(
      (key) =>
        Number.isFinite(value.scene[key]) &&
        value.scene[key] >= 0 &&
        value.scene[key] <= value.frame.scenePresentationWallMs,
    ) &&
    nativeBenchmarkWallSumFits(renderWallMs, [
      value.frame.deviceWallMs,
      value.frame.mountAwaitWallMs,
      value.frame.scenePresentationWallMs,
      value.frame.retirementWallMs,
    ]) &&
    nativeBenchmarkWallSumFits(
      value.frame.scenePresentationWallMs,
      NATIVE_BENCHMARK_SCENE_PHASE_KEYS.map((key) => value.scene[key]),
    )
  );
}

export class NativeMountedBenchmarkWindowCollector {
  private lastRafAt: number | null = null;
  private warmupIntervals = 0;
  private measuredIntervals: number[] = [];
  private renderWalls: number[] = [];
  private sourceWalls: number[] = [];
  private composeWalls: number[] = [];
  private phaseWalls: Record<NativeBenchmarkPhaseKey, number[]> | null = null;
  private phasePresence: boolean | null = null;
  private fullFramePresence: boolean | null = null;
  private fullFrameWalls: Record<
    (typeof NATIVE_BENCHMARK_FRAME_PHASE_KEYS)[number],
    number[]
  > | null = null;
  private sceneWalls: Record<
    (typeof NATIVE_BENCHMARK_SCENE_PHASE_KEYS)[number],
    number[]
  > | null = null;
  private finished = false;

  readonly request: NativeMountedBenchmarkRequest;
  constructor(request: NativeMountedBenchmarkRequest) {
    this.request = request;
    if (
      request.warmupRafIntervals !== 120 ||
      request.measuredRafIntervals !== 840
    )
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
  }

  get isMeasuring(): boolean {
    return this.warmupIntervals === 120 && !this.finished;
  }

  get isComplete(): boolean {
    return this.finished;
  }

  onRaf(now: number, visibility: "visible" | "hidden" | "offscreen"): void {
    if (this.finished) return;
    if (visibility !== "visible")
      throw new NativeMountedBenchmarkError(
        visibility === "hidden" ? "benchmark-hidden" : "benchmark-offscreen",
      );
    if (!Number.isFinite(now) || now < 0)
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
    if (this.lastRafAt === null) {
      this.lastRafAt = now;
      return;
    }
    const interval = now - this.lastRafAt;
    if (
      !Number.isFinite(interval) ||
      interval <= 0 ||
      interval > MAX_INTERVAL_MS
    )
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
    this.lastRafAt = now;
    if (this.warmupIntervals < 120) {
      this.warmupIntervals += 1;
      return;
    }
    this.measuredIntervals.push(interval);
    if (this.measuredIntervals.length === 840) this.finished = true;
  }

  onRender(sample: {
    renderWallMs: number;
    sourceWallMs: number;
    composeWallMs: number;
    hostWallPhases?: NativeBenchmarkPhaseValues;
    fullFrameWallPhases?: NativeBenchmarkFullFrameValues;
    failureCount: number;
  }): void {
    if (!this.isMeasuring) return;
    if (sample.failureCount !== 0)
      throw new NativeMountedBenchmarkError("benchmark-render-failed");
    const fullFrame = sample.fullFrameWallPhases;
    const hasFullFrame = fullFrame !== undefined;
    if (
      (this.fullFramePresence !== null &&
        this.fullFramePresence !== hasFullFrame) ||
      (hasFullFrame &&
        !validNativeBenchmarkFullFrameValues(fullFrame!, sample.renderWallMs))
    )
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
    const hasPhases = sample.hostWallPhases !== undefined;
    if (this.phasePresence !== null && this.phasePresence !== hasPhases)
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
    const phase = sample.hostWallPhases;
    if (
      hasPhases &&
      (!phase ||
        typeof phase !== "object" ||
        Array.isArray(phase) ||
        Object.keys(phase).length !== NATIVE_BENCHMARK_PHASE_KEYS.length ||
        NATIVE_BENCHMARK_PHASE_KEYS.some(
          (key) =>
            !Number.isFinite(phase[key]) ||
            phase[key] < 0 ||
            phase[key] > MAX_INTERVAL_MS,
        ))
    )
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
    const values = [
      sample.renderWallMs,
      sample.sourceWallMs,
      sample.composeWallMs,
    ];
    if (
      values.some(
        (value) =>
          !Number.isFinite(value) || value < 0 || value > MAX_INTERVAL_MS,
      )
    )
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
    if (this.renderWalls.length >= MAX_RENDER_SAMPLES)
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
    this.renderWalls.push(sample.renderWallMs);
    this.sourceWalls.push(sample.sourceWallMs);
    this.composeWalls.push(sample.composeWallMs);
    this.phasePresence = hasPhases;
    this.fullFramePresence = hasFullFrame;
    if (fullFrame) {
      this.fullFrameWalls ??= Object.fromEntries(
        NATIVE_BENCHMARK_FRAME_PHASE_KEYS.map((key) => [key, []]),
      ) as NonNullable<typeof this.fullFrameWalls>;
      this.sceneWalls ??= Object.fromEntries(
        NATIVE_BENCHMARK_SCENE_PHASE_KEYS.map((key) => [key, []]),
      ) as NonNullable<typeof this.sceneWalls>;
      for (const key of NATIVE_BENCHMARK_FRAME_PHASE_KEYS)
        this.fullFrameWalls[key].push(fullFrame.frame[key]);
      for (const key of NATIVE_BENCHMARK_SCENE_PHASE_KEYS)
        this.sceneWalls[key].push(fullFrame.scene[key]);
    }
    if (phase) {
      this.phaseWalls ??= {
        deviceWallMs: [],
        layoutCallWallMs: [],
        effectPassesWallMs: [],
        finishWallMs: [],
        presentWallMs: [],
        submitCallWallMs: [],
        errorScopeWallMs: [],
        postSubmitWallMs: [],
      };
      for (const key of NATIVE_BENCHMARK_PHASE_KEYS)
        this.phaseWalls[key].push(phase[key]);
    }
  }

  result(): NativeMountedBenchmarkWindow {
    if (!this.finished)
      throw new NativeMountedBenchmarkError("benchmark-timeout");
    if (this.renderWalls.length === 0)
      throw new NativeMountedBenchmarkError("benchmark-no-render");
    return {
      warmupRafIntervals: 120,
      measuredRafIntervals: 840,
      measuredRenderFrames: this.renderWalls.length,
      rafIntervalMs: nativeBenchmarkStats(this.measuredIntervals),
      renderWallMs: nativeBenchmarkStats(this.renderWalls),
      sourceWallMs: nativeBenchmarkStats(this.sourceWalls),
      composeWallMs: nativeBenchmarkStats(this.composeWalls),
      ...(this.fullFrameWalls && this.sceneWalls
        ? {
            fullFrameWallPhases: {
              scope:
                "full-render-internal-wall-intervals-not-CPU-or-GPU-time" as const,
              stats: Object.fromEntries(
                NATIVE_BENCHMARK_FRAME_PHASE_KEYS.map((key) => [
                  key,
                  nativeBenchmarkStats(this.fullFrameWalls![key]),
                ]),
              ) as NativeBenchmarkFullFrameWallPhases["stats"],
              scenePresentation: {
                scope:
                  "nested-in-scene-presentation-wall-intervals-not-CPU-or-GPU-time" as const,
                stats: Object.fromEntries(
                  NATIVE_BENCHMARK_SCENE_PHASE_KEYS.map((key) => [
                    key,
                    nativeBenchmarkStats(this.sceneWalls![key]),
                  ]),
                ) as NativeBenchmarkFullFrameWallPhases["scenePresentation"]["stats"],
              },
            },
          }
        : {}),
      ...(this.phaseWalls
        ? {
            hostWallPhases: {
              scope: "wall-intervals-not-CPU-or-GPU-time" as const,
              stats: Object.fromEntries(
                NATIVE_BENCHMARK_PHASE_KEYS.map((key) => [
                  key,
                  nativeBenchmarkStats(this.phaseWalls![key]),
                ]),
              ) as Record<NativeBenchmarkPhaseKey, NativeBenchmarkStats>,
            },
          }
        : {}),
      deadlines: {
        over60Hz: this.measuredIntervals.filter((value) => value > RAF_60_HZ_MS)
          .length,
        over120Hz: this.measuredIntervals.filter(
          (value) => value > RAF_120_HZ_MS,
        ).length,
      },
    };
  }
}

export class NativeMountedBenchmarkRun {
  readonly collector: NativeMountedBenchmarkWindowCollector;
  readonly done: Promise<NativeMountedBenchmarkWindow>;
  private resolveDone!: (value: NativeMountedBenchmarkWindow) => void;
  private rejectDone!: (error: NativeMountedBenchmarkError) => void;
  private timer: ReturnType<typeof setTimeout>;
  private settled = false;
  private readonly signal: AbortSignal;
  private readonly onMeasurementStart?: () => void;
  private readonly onMeasurementEnd?: () => void;

  constructor(
    request: NativeMountedBenchmarkRequest,
    signal: AbortSignal,
    timeoutMs = 40_000,
    onMeasurementStart?: () => void,
    onMeasurementEnd?: () => void,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 40_000)
      throw new NativeMountedBenchmarkError("benchmark-unavailable");
    this.signal = signal;
    this.onMeasurementStart = onMeasurementStart;
    this.onMeasurementEnd = onMeasurementEnd;
    this.collector = new NativeMountedBenchmarkWindowCollector(request);
    this.done = new Promise((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.timer = setTimeout(
      () => this.fail(new NativeMountedBenchmarkError("benchmark-timeout")),
      timeoutMs,
    );
    signal.addEventListener("abort", this.onAbort, { once: true });
    if (signal.aborted) this.onAbort();
  }

  private onAbort = (): void => {
    this.fail(new NativeMountedBenchmarkError("benchmark-aborted"));
  };

  private cleanup(): void {
    clearTimeout(this.timer);
    this.signal.removeEventListener("abort", this.onAbort);
  }

  fail(error: NativeMountedBenchmarkError): void {
    if (this.settled) return;
    this.settled = true;
    this.cleanup();
    this.rejectDone(error);
  }

  onFrame(
    rafTimestamp: number | undefined,
    visibility: () => "visible" | "hidden" | "offscreen",
  ): void {
    if (rafTimestamp === undefined) return;
    const wasMeasuring = this.collector.isMeasuring;
    this.onRaf(rafTimestamp, visibility());
    if (!this.settled && !wasMeasuring && this.collector.isMeasuring) {
      try {
        this.onMeasurementStart?.();
      } catch (error) {
        this.fail(
          error instanceof NativeMountedBenchmarkError
            ? error
            : new NativeMountedBenchmarkError("benchmark-unavailable"),
        );
      }
    }
  }

  onRaf(now: number, visibility: "visible" | "hidden" | "offscreen"): void {
    if (this.settled) return;
    try {
      this.collector.onRaf(now, visibility);
      if (this.collector.isComplete) {
        const result = this.collector.result();
        this.onMeasurementEnd?.();
        this.settled = true;
        this.cleanup();
        this.resolveDone(result);
      }
    } catch (error) {
      this.fail(
        error instanceof NativeMountedBenchmarkError
          ? error
          : new NativeMountedBenchmarkError("benchmark-unavailable"),
      );
    }
  }

  onRender(sample: {
    renderWallMs: number;
    sourceWallMs: number;
    composeWallMs: number;
    hostWallPhases?: NativeBenchmarkPhaseValues;
    fullFrameWallPhases?: NativeBenchmarkFullFrameValues;
    failureCount: number;
  }): void {
    if (this.settled) return;
    try {
      this.collector.onRender(sample);
    } catch (error) {
      this.fail(
        error instanceof NativeMountedBenchmarkError
          ? error
          : new NativeMountedBenchmarkError("benchmark-unavailable"),
      );
    }
  }
}
