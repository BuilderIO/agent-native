import { assertNativeUniformTiming } from "../../../../shared/native-uniform-timing";

export interface NativePlaybackClock {
  global: number;
  local: number;
  speed: number;
  paused: boolean;
}

export function updateNativePlaybackClock(
  clock: NativePlaybackClock,
  previousTime: number,
  next: { time: number; speed: number; paused: boolean },
  now: number,
  seek = false,
): NativePlaybackClock {
  const prior = clock.paused
    ? clock.local
    : clock.local + (now - clock.global) * clock.speed;
  assertNativeUniformTiming(next.time, "initial-time");
  assertNativeUniformTiming(next.speed, "speed");
  const local =
    seek || clock.paused !== next.paused
      ? next.time
      : prior + next.time - previousTime;
  assertNativeUniformTiming(local, "time");
  return { global: now, local, speed: next.speed, paused: next.paused };
}
