import type { NativePointerState } from "./native-pointer-input";

export const MAX_NATIVE_POINTER_HISTORY_EVENTS = 36_000;
export const MAX_NATIVE_POINTER_HISTORY_SECONDS = 600;

export type NativePointerHistoryEvent = NativePointerState & { time: number };
export type NativePointerHistorySnapshot =
  | { mode: "authored-static" }
  | {
      mode: "recorded";
      startTime: number;
      endTime: number;
      events: NativePointerHistoryEvent[];
    };

export type NativePointerReplayEntry = {
  instanceId: string;
  nodeId: string;
  definitionId: string;
  definitionVersion: number;
  executionHash: string;
  instanceJson: string;
  timing: {
    time: number;
    speed: number;
    paused: boolean;
    seekRevision?: number;
  };
  history: NativePointerHistorySnapshot;
};

export class NativePointerHistoryError extends Error {
  readonly code = "interaction-history-unavailable";
  constructor() {
    super(
      "The live pointer gesture has no complete timestamped replay for this export window.",
    );
    this.name = "NativePointerHistoryError";
  }
}

function finitePointer(value: unknown): value is NativePointerState {
  return (
    !!value &&
    typeof value === "object" &&
    Number.isFinite((value as NativePointerState).x) &&
    Number.isFinite((value as NativePointerState).y) &&
    (value as NativePointerState).x >= 0 &&
    (value as NativePointerState).x <= 1 &&
    (value as NativePointerState).y >= 0 &&
    (value as NativePointerState).y <= 1 &&
    typeof (value as NativePointerState).active === "boolean"
  );
}

export class NativePointerHistory {
  private startTime: number;
  private events: NativePointerHistoryEvent[] = [];
  private unavailable = false;
  private observed = false;

  constructor(startTime: number) {
    if (!Number.isFinite(startTime) || startTime < 0)
      throw new NativePointerHistoryError();
    this.startTime = startTime;
  }

  invalidate(observedInput = false): void {
    if (observedInput) this.observed = true;
    if (this.observed) this.unavailable = true;
  }

  reset(startTime: number): void {
    if (!Number.isFinite(startTime) || startTime < 0)
      throw new NativePointerHistoryError();
    this.startTime = startTime;
    this.events = [];
    this.unavailable = this.unavailable || this.observed;
  }

  record(time: number, pointer: NativePointerState): void {
    this.observed = true;
    if (
      this.unavailable ||
      !Number.isFinite(time) ||
      time < this.startTime ||
      time - this.startTime > MAX_NATIVE_POINTER_HISTORY_SECONDS ||
      !finitePointer(pointer) ||
      (this.events.length > 0 &&
        time < this.events[this.events.length - 1].time) ||
      (this.events.length >= MAX_NATIVE_POINTER_HISTORY_EVENTS &&
        (this.events.length === 0 ||
          this.events[this.events.length - 1].x !== pointer.x ||
          this.events[this.events.length - 1].y !== pointer.y ||
          this.events[this.events.length - 1].active !== pointer.active))
    ) {
      this.unavailable = true;
      return;
    }
    const previous = this.events[this.events.length - 1];
    if (
      previous &&
      previous.x === pointer.x &&
      previous.y === pointer.y &&
      previous.active === pointer.active
    )
      return;
    this.events.push({
      time,
      x: pointer.x,
      y: pointer.y,
      active: pointer.active,
    });
  }

  snapshot(
    startTime: number,
    endTime: number,
    observedUntil: number,
  ): NativePointerHistorySnapshot {
    if (!this.observed) return { mode: "authored-static" };
    if (
      this.unavailable ||
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      !Number.isFinite(observedUntil) ||
      startTime < this.startTime - 1e-6 ||
      endTime < startTime ||
      endTime - this.startTime > MAX_NATIVE_POINTER_HISTORY_SECONDS ||
      endTime > observedUntil + 1e-6 ||
      this.events.length === 0
    )
      throw new NativePointerHistoryError();
    return {
      mode: "recorded",
      startTime: this.startTime,
      endTime: observedUntil,
      events: this.events.map((event) => ({ ...event })),
    };
  }
}

export function validateNativePointerHistorySnapshot(
  value: unknown,
  startTime: number,
  endTime: number,
): asserts value is NativePointerHistorySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NativePointerHistoryError();
  const snapshot = value as NativePointerHistorySnapshot;
  if (snapshot.mode === "authored-static") return;
  if (
    snapshot.mode !== "recorded" ||
    !Array.isArray(snapshot.events) ||
    !Number.isFinite(snapshot.startTime) ||
    !Number.isFinite(snapshot.endTime) ||
    startTime < snapshot.startTime - 1e-6 ||
    endTime > snapshot.endTime + 1e-6 ||
    endTime < startTime ||
    endTime - snapshot.startTime > MAX_NATIVE_POINTER_HISTORY_SECONDS ||
    snapshot.events.length < 1 ||
    snapshot.events.length > MAX_NATIVE_POINTER_HISTORY_EVENTS ||
    snapshot.events.some(
      (event, index) =>
        !finitePointer(event) ||
        !Number.isFinite(event.time) ||
        event.time < snapshot.startTime ||
        event.time > snapshot.endTime ||
        (index > 0 && event.time < snapshot.events[index - 1].time),
    )
  )
    throw new NativePointerHistoryError();
}

export function sampleNativePointerHistory(
  snapshot: NativePointerHistorySnapshot,
  time: number,
  initial: NativePointerState,
): NativePointerState {
  if (snapshot.mode === "authored-static") return initial;
  if (!Number.isFinite(time) || time < 0 || time > snapshot.endTime + 1e-6)
    throw new NativePointerHistoryError();
  if (time < snapshot.startTime) return initial;
  let low = 0;
  let high = snapshot.events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (snapshot.events[middle].time <= time + 1e-6) low = middle + 1;
    else high = middle;
  }
  const pointer = low ? snapshot.events[low - 1] : initial;
  return { x: pointer.x, y: pointer.y, active: pointer.active };
}
