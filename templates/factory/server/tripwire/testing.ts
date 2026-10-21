import type { TripwireInput, TripwireSink } from "./types.js";

/**
 * A sink that keeps what it is handed, for the spec of a call site:
 * `const { sink, events } = createCapturingTripwireSink()`, pass `sink` as the
 * host's `tripwire`, run the code, and read `events`.
 */
export function createCapturingTripwireSink(): {
  sink: TripwireSink;
  events: TripwireInput[];
} {
  const events: TripwireInput[] = [];
  return { sink: (input) => void events.push(input), events };
}
