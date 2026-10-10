import { nativeShaderGpuSampleWindowSchema } from "@shared/native-shader-validation";
import { describe, expect, it } from "vitest";

import type { NativeGpuProfile } from "./native-gpu-profiler";
import { NativeGpuSampleWindowCollector } from "./native-gpu-sample-window";

function ready(frameIndex: number, gpuMs: number): NativeGpuProfile {
  return {
    kind: "ready",
    frameIndex,
    passCount: 1,
    gpuPassSumMs: gpuMs,
    passes: [{ label: "chosen:effect:main", gpuMs }],
    estimatedResourceBytes: 2304,
  };
}
function submit(window: NativeGpuSampleWindowCollector, frameIndex: number) {
  window.reserve(frameIndex);
  window.onEvent({ kind: "submitted", frameIndex });
}
function complete(
  window: NativeGpuSampleWindowCollector,
  frameIndex: number,
  gpuMs: number,
) {
  window.onEvent({
    kind: "completed",
    frameIndex,
    result: ready(frameIndex, gpuMs),
  });
}
function parse(window: NativeGpuSampleWindowCollector, upper: number) {
  const result = window.finish(upper);
  expect(nativeShaderGpuSampleWindowSchema.safeParse(result).success).toBe(
    true,
  );
  return result;
}

describe("bounded GPU sample windows", () => {
  it("keeps all reordered measured completions and excludes warmup and pre-window samples", () => {
    const window = new NativeGpuSampleWindowCollector("chosen", 60, 4, true);
    complete(window, 4, 999);
    submit(window, 5);
    complete(window, 5, 888);
    window.startMeasurement(5);
    for (const frame of [6, 8, 10]) submit(window, frame);
    complete(window, 10, 3);
    complete(window, 6, 9);
    complete(window, 8, 1);
    const result = parse(window, 12);
    expect(result).toMatchObject({
      kind: "ready",
      code: "complete",
      warmupAfterFrameIndex: 4,
      afterFrameIndex: 5,
      throughFrameIndex: 12,
      gpuPassSumMs: { count: 3, p50: 3, p95: 9, p99: 9, max: 9 },
    });
    expect(
      result.samples.map((sample) => [
        sample.frameIndex,
        sample.phase,
        sample.status,
      ]),
    ).toEqual([
      [5, "warmup", "ready"],
      [6, "measurement", "ready"],
      [8, "measurement", "ready"],
      [10, "measurement", "ready"],
    ]);
  });

  it("freezes pending submissions and reserved encoders at end without accepting late or post-window output", () => {
    const window = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
    window.startMeasurement(-1);
    submit(window, 0);
    complete(window, 0, 0);
    submit(window, 1);
    window.reserve(2);
    const result = parse(window, 2);
    const frozen = JSON.stringify(result);
    expect(result).toMatchObject({
      kind: "pending",
      code: "readback-pending",
      gpuPassSumMs: null,
    });
    expect(result.samples.map((sample) => sample.status)).toEqual([
      "ready",
      "submitted",
      "reserved",
    ]);
    complete(window, 1, 400);
    window.onEvent({ kind: "submitted", frameIndex: 2 });
    complete(window, 2, 500);
    submit(window, 3);
    complete(window, 3, 999);
    expect(JSON.stringify(result)).toBe(frozen);
    expect(window.finish(100)).toBe(result);
    expect(Object.isFrozen(result.samples[0].profile?.passes[0])).toBe(true);
  });

  it("reports valid zero only after real timestamps, and never fabricates empty percentiles", () => {
    const zero = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
    zero.startMeasurement(-1);
    submit(zero, 0);
    complete(zero, 0, 0);
    expect(parse(zero, 0)).toMatchObject({
      kind: "ready",
      gpuPassSumMs: { count: 1, max: 0 },
    });
    for (const supported of [true, false]) {
      const empty = new NativeGpuSampleWindowCollector(
        "chosen",
        60,
        -1,
        supported,
      );
      empty.startMeasurement(-1);
      expect(parse(empty, -1)).toMatchObject({
        kind: "unavailable",
        code: supported ? "no-measured-samples" : "timestamp-query-unavailable",
        gpuPassSumMs: null,
      });
    }
  });

  it.each(["capacity", "read-failed", "invalid-timestamps"] as const)(
    "retains %s failures alongside ready evidence",
    (code) => {
      const window = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
      window.startMeasurement(-1);
      submit(window, 0);
      complete(window, 0, 1);
      submit(window, 1);
      window.onEvent({
        kind: "completed",
        frameIndex: 1,
        result: { kind: "error", code, estimatedResourceBytes: 2304 },
      });
      expect(parse(window, 1)).toMatchObject({
        kind: "error",
        code,
        gpuPassSumMs: null,
      });
    },
  );

  it("distinguishes warmup failure from measured abandonment and ring-capacity loss", () => {
    const window = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
    submit(window, 0);
    window.onEvent({ kind: "abandoned", frameIndex: 0 });
    window.capacity();
    window.startMeasurement(0);
    submit(window, 1);
    complete(window, 1, 2);
    expect(parse(window, 1)).toMatchObject({
      kind: "ready",
      skippedCapacity: { warmup: 1, measurement: 0 },
    });
    for (const failure of ["abandoned", "capacity"] as const) {
      const failed = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
      failed.startMeasurement(-1);
      submit(failed, 0);
      complete(failed, 0, 2);
      if (failure === "capacity") failed.capacity();
      else {
        failed.reserve(1);
        failed.onEvent({ kind: "abandoned", frameIndex: 1 });
      }
      expect(parse(failed, 1)).toMatchObject({
        kind: "error",
        code: failure === "capacity" ? "capacity" : "abandoned-sample",
        gpuPassSumMs: null,
      });
    }
  });

  it("bounds history at 128 and preserves overflow failure instead of reporting a truncated distribution", () => {
    const window = new NativeGpuSampleWindowCollector("chosen", 1, -1, true);
    window.startMeasurement(-1);
    for (let frame = 0; frame < 132; frame += 1) {
      submit(window, frame);
      complete(window, frame, 1);
    }
    const result = parse(window, 131);
    expect(result).toMatchObject({
      kind: "error",
      code: "history-capacity",
      omittedSamples: 4,
      gpuPassSumMs: null,
    });
    expect(result.samples).toHaveLength(128);
  });

  it.each([
    "lost-reservation",
    "lost-submission",
    "duplicate-submission",
    "duplicate-completion",
    "wrong-owner",
    "wrong-frame",
  ])("reports %s event ordering distinctly", (fault) => {
    const window = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
    window.startMeasurement(-1);
    if (fault !== "lost-reservation") window.reserve(0);
    if (!["lost-reservation", "lost-submission"].includes(fault))
      window.onEvent({ kind: "submitted", frameIndex: 0 });
    if (fault === "duplicate-submission")
      window.onEvent({ kind: "submitted", frameIndex: 0 });
    const profile = ready(fault === "wrong-frame" ? 1 : 0, 1);
    if (fault === "wrong-owner")
      profile.passes = [{ label: "other:effect:main", gpuMs: 1 }];
    window.onEvent({ kind: "completed", frameIndex: 0, result: profile });
    if (fault === "duplicate-completion") complete(window, 0, 1);
    expect(parse(window, 0)).toMatchObject({
      kind: "error",
      code: "sample-order",
      gpuPassSumMs: null,
    });
  });

  it.each(["device-lost", "disposed", "target-changed"] as const)(
    "keeps %s invalidation through end",
    (code) => {
      const window = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
      window.startMeasurement(-1);
      submit(window, 0);
      complete(window, 0, 1);
      window.invalidate(code);
      expect(parse(window, 0)).toMatchObject({
        kind: code === "target-changed" ? "error" : "unavailable",
        code,
        gpuPassSumMs: null,
      });
    },
  );

  it("refuses inverted bounds, forged percentiles, wrong labels, omitted history, duplicate indices and wrong phases", () => {
    const window = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
    window.startMeasurement(-1);
    submit(window, 0);
    complete(window, 0, 2);
    const valid = parse(window, 0);
    for (const bad of [
      { ...valid, throughFrameIndex: -1 },
      { ...valid, gpuPassSumMs: { ...valid.gpuPassSumMs!, p95: 0 } },
      { ...valid, omittedSamples: 1 },
      { ...valid, samples: [valid.samples[0], valid.samples[0]] },
      { ...valid, samples: [{ ...valid.samples[0], phase: "warmup" }] },
      { ...valid, targetInstanceId: "other" },
      { ...valid, kind: "pending" },
      { ...valid, skippedCapacity: { warmup: 0, measurement: 1 } },
    ])
      expect(nativeShaderGpuSampleWindowSchema.safeParse(bad).success).toBe(
        false,
      );
    const unopened = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
    expect(() => unopened.finish(0)).toThrowError(
      "Invalid GPU sample window boundary",
    );
    unopened.startMeasurement(5);
    expect(() => unopened.finish(4)).toThrowError(
      "Invalid GPU sample window boundary",
    );
  });
});

describe("known pass overflow before readback", () => {
  it("keeps the pending submission visible while reporting capacity already observed in that measured encoder", () => {
    const window = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
    window.startMeasurement(-1);
    window.reserve(0);
    window.onEvent({ kind: "capacity", frameIndex: 0 });
    window.onEvent({ kind: "submitted", frameIndex: 0 });
    const result = window.finish(0);
    expect(result).toMatchObject({
      kind: "error",
      code: "capacity",
      samples: [{ frameIndex: 0, status: "submitted" }],
      skippedCapacity: { measurement: 1 },
      gpuPassSumMs: null,
    });
    expect(nativeShaderGpuSampleWindowSchema.safeParse(result).success).toBe(
      true,
    );
  });
});

describe("retained profile storage bounds", () => {
  it.each(["pass-count", "label-length", "nonfinite", "resource-count"])(
    "refuses %s overflow before retaining its payload",
    (fault) => {
      const window = new NativeGpuSampleWindowCollector("chosen", 60, -1, true);
      window.startMeasurement(-1);
      submit(window, 0);
      const profile = ready(0, 1);
      if (fault === "pass-count") {
        profile.passCount = 33;
        profile.passes = Array.from({ length: 33 }, () => ({
          label: "chosen:main",
          gpuMs: 1,
        }));
        profile.gpuPassSumMs = 33;
      } else if (fault === "label-length")
        profile.passes = [{ label: `chosen:${"p".repeat(141)}`, gpuMs: 1 }];
      else if (fault === "resource-count")
        profile.estimatedResourceBytes = Infinity;
      else profile.passes = [{ label: "chosen:main", gpuMs: NaN }];
      window.onEvent({ kind: "completed", frameIndex: 0, result: profile });
      const result = parse(window, 0);
      expect(result).toMatchObject({
        kind: "error",
        code: "profile-unavailable",
        samples: [{ frameIndex: 0, status: "submitted" }],
        gpuPassSumMs: null,
      });
      expect(result.samples[0]).not.toHaveProperty("profile");
    },
  );
});
