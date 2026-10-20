export type NativeUniformTimingField =
  | "time"
  | "initial-time"
  | "step-time"
  | "delta-time"
  | "speed";

export class NativeUniformTimingError extends RangeError {
  readonly code = "native-uniform-timing-invalid";

  constructor(readonly field: NativeUniformTimingField) {
    super(`native-uniform-timing-invalid:${field}`);
    this.name = "NativeUniformTimingError";
  }
}

export function isFiniteNativeUniformTiming(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(Math.fround(value));
}

export function assertNativeUniformTiming(
  value: number,
  field: NativeUniformTimingField,
): void {
  if (!isFiniteNativeUniformTiming(value))
    throw new NativeUniformTimingError(field);
}

export function packNativeUniformClock(input: {
  time: number;
  seed: number;
  pixelRatio: number;
  deltaTime?: number;
}): Float32Array {
  const deltaTime = input.deltaTime === undefined ? 0 : input.deltaTime;
  assertNativeUniformTiming(input.time, "time");
  assertNativeUniformTiming(deltaTime, "delta-time");
  return new Float32Array([
    input.time,
    input.seed,
    input.pixelRatio,
    deltaTime,
  ]);
}
