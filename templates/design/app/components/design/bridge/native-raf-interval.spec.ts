import { describe, expect, it } from "vitest";

import { NativeRafIntervalTelemetry } from "./native-raf-interval";

describe("RAF profile continuity", () => {
  it("excludes an idle wake but retains real missed intervals while RAF remains scheduled", () => {
    const telemetry = new NativeRafIntervalTelemetry();
    const samples = [
      telemetry.onFrame(100, true),
      telemetry.onFrame(116, true),
      telemetry.onFrame(236, true),
      telemetry.onFrame(252, false),
      telemetry.onFrame(18_631.5, false),
      telemetry.onFrame(18_647.5, true),
      telemetry.onFrame(18_663.5, true),
    ].filter((value): value is number => value !== null);
    expect(samples).toEqual([16, 120, 16, 16]);
  });

  it("breaks continuity for synchronous kicks and canceled RAFs", () => {
    const telemetry = new NativeRafIntervalTelemetry();
    expect(telemetry.onFrame(100, true)).toBeNull();
    expect(telemetry.onFrame(undefined, true)).toBeNull();
    expect(telemetry.onFrame(1000, true)).toBeNull();
    telemetry.reset();
    expect(telemetry.onFrame(2000, true)).toBeNull();
    expect(telemetry.onFrame(2016, true)).toBe(16);
  });
});
