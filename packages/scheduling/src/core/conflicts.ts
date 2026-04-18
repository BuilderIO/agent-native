/**
 * Conflict detection — does a proposed interval overlap any busy interval?
 */
import type { BusyInterval } from "../shared/index.js";
import { overlaps } from "./time.js";

export function hasConflict(
  slot: { start: Date; end: Date },
  busy: BusyInterval[],
): boolean {
  for (const b of busy) {
    if (
      overlaps(slot, {
        start: new Date(b.start),
        end: new Date(b.end),
      })
    ) {
      return true;
    }
  }
  return false;
}

/** Merge overlapping busy intervals into a canonical, non-overlapping set. */
export function mergeBusy(busy: BusyInterval[]): BusyInterval[] {
  if (busy.length === 0) return [];
  const sorted = busy
    .map((b) => ({
      start: new Date(b.start),
      end: new Date(b.end),
      source: b.source,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: { start: Date; end: Date; source?: string }[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    const cur = sorted[i];
    if (cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      out.push(cur);
    }
  }
  return out.map((b) => ({
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    source: b.source,
  }));
}
