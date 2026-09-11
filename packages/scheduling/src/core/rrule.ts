/**
 * Recurring event expansion.
 *
 * Given an RRULE string and a time range, return the list of occurrence
 * start times. Uses `rrule` npm package under the hood.
 */
import { RRule, rrulestr } from "rrule";

export function expandRecurring(
  rruleString: string,
  dtstart: Date,
  rangeStart: Date,
  rangeEnd: Date,
  maxOccurrences = 10,
): Date[] {
  // rrulestr parses RRULE:... with or without the DTSTART prefix.
  const rule = rrulestr(rruleString, { dtstart }) as RRule;
  const all = rule.between(rangeStart, rangeEnd, true);
  return all.slice(0, maxOccurrences);
}
