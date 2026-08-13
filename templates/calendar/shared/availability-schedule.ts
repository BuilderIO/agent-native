import type { TimeSlot } from "./api.js";

function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Returns the saved windows in chronological order with overlaps merged. */
export function normalizeAvailabilitySlots(slots: TimeSlot[]): TimeSlot[] {
  const valid = slots
    .map((slot) => ({
      slot,
      start: timeToMinutes(slot.start),
      end: timeToMinutes(slot.end),
    }))
    .filter(
      (entry): entry is typeof entry & { start: number; end: number } =>
        entry.start !== null && entry.end !== null && entry.start < entry.end,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const normalized: Array<{
    slot: TimeSlot;
    start: number;
    end: number;
  }> = [];
  for (const entry of valid) {
    const previous = normalized.at(-1);
    if (previous && entry.start < previous.end) {
      const mergedEnd = Math.max(previous.end, entry.end);
      previous.slot = {
        ...previous.slot,
        end: entry.end > previous.end ? entry.slot.end : previous.slot.end,
      };
      previous.end = mergedEnd;
      continue;
    }
    normalized.push({ ...entry, slot: { ...entry.slot } });
  }

  return normalized.map(({ slot }) => slot);
}

export function availabilitySlotsOverlap(slots: TimeSlot[]): boolean {
  const valid = slots
    .map((slot) => ({
      start: timeToMinutes(slot.start),
      end: timeToMinutes(slot.end),
    }))
    .filter(
      (entry): entry is { start: number; end: number } =>
        entry.start !== null && entry.end !== null && entry.start < entry.end,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  return valid.some((slot, index) => {
    const previous = valid[index - 1];
    return previous !== undefined && slot.start < previous.end;
  });
}
