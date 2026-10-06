import { RRule, rrulestr } from "rrule";

export function expandRecurring(
  rruleString: string,
  dtstart: Date,
  rangeStart: Date,
  rangeEnd: Date,
  maxOccurrences = 10,
): Date[] {
  const rule = rrulestr(rruleString, { dtstart }) as RRule;
  const all = rule.between(rangeStart, rangeEnd, true);
  return all.slice(0, maxOccurrences);
}
