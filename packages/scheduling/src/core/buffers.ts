import type { BusyInterval } from "../shared/index.js";
import { addMinutes } from "./time.js";

export function applyBuffers(
  busy: BusyInterval,
  beforeMinutes: number,
  afterMinutes: number,
): BusyInterval {
  return {
    ...busy,
    start: new Date(
      addMinutes(new Date(busy.start), -beforeMinutes),
    ).toISOString(),
    end: new Date(addMinutes(new Date(busy.end), afterMinutes)).toISOString(),
  };
}

export function expandSlotForConflictCheck(
  start: Date,
  end: Date,
  beforeMinutes: number,
  afterMinutes: number,
): { start: Date; end: Date } {
  return {
    start: addMinutes(start, -beforeMinutes),
    end: addMinutes(end, afterMinutes),
  };
}
