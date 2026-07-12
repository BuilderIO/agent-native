import type { AvailabilityConfig } from "../../shared/api.js";

const MAX_DURATION_MINUTES = 24 * 60;

export type BookingDurationSource = {
  duration: number;
  durations?: string | null;
};

function toDurationNumber(value: unknown): number | null {
  const duration =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (
    !Number.isInteger(duration) ||
    duration <= 0 ||
    duration > MAX_DURATION_MINUTES
  ) {
    return null;
  }
  return duration;
}

function uniqueDurations(values: unknown[]): number[] {
  const durations: number[] = [];
  for (const value of values) {
    const duration = toDurationNumber(value);
    if (duration !== null && !durations.includes(duration)) {
      durations.push(duration);
    }
  }
  return durations;
}

export function parseBookingLinkDurations(
  bookingLink: BookingDurationSource | null | undefined,
): number[] {
  if (!bookingLink) return [];

  if (bookingLink.durations) {
    try {
      const parsed = JSON.parse(bookingLink.durations);
      if (Array.isArray(parsed)) {
        const durations = uniqueDurations(parsed);
        if (durations.length > 0) return durations;
      }
    } catch {
      // Fall through to the primary duration below.
    }
  }

  const primary = toDurationNumber(bookingLink.duration);
  return primary === null ? [] : [primary];
}

export function normalizeBookingDurationInput({
  duration,
  durations,
}: {
  duration: unknown;
  durations?: unknown;
}): { duration: number; durations?: number[] } | { error: string } {
  const options = Array.isArray(durations) ? uniqueDurations(durations) : [];
  const primary = toDurationNumber(duration);

  if (options.length > 0) {
    const normalizedDuration =
      primary !== null && options.includes(primary) ? primary : options[0];
    return {
      duration: normalizedDuration,
      durations: options.length > 1 ? options : undefined,
    };
  }

  if (primary === null) {
    return { error: "duration must be between 1 and 1440 minutes" };
  }

  return { duration: primary };
}

export function resolveAvailabilityDuration({
  rawDuration,
  bookingLink,
  availability,
}: {
  rawDuration: unknown;
  bookingLink?: BookingDurationSource | null;
  availability?: Pick<AvailabilityConfig, "slotDurationMinutes"> | null;
}): { duration: number } | { error: string } {
  const allowedDurations = parseBookingLinkDurations(bookingLink);

  if (rawDuration !== undefined) {
    if (Array.isArray(rawDuration)) {
      return { error: "duration must be a single value" };
    }
    const requested = toDurationNumber(rawDuration);
    if (requested === null) {
      return { error: "duration must be between 1 and 1440 minutes" };
    }
    if (allowedDurations.length > 0 && !allowedDurations.includes(requested)) {
      return { error: "duration is not available for this booking link" };
    }
    return { duration: requested };
  }

  if (allowedDurations.length > 0) {
    return { duration: allowedDurations[0] };
  }

  const fallback = toDurationNumber(availability?.slotDurationMinutes ?? 30);
  if (fallback === null) {
    return { duration: 30 };
  }
  return { duration: fallback };
}
