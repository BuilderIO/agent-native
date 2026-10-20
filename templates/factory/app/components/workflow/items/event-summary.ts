import type { EndOutcome } from "./read-types";

/**
 * What an `ended` event says beyond its recorded outcome. The engine writes
 * `<outcome>[: reason] (status <status>)`; the outcome is recorded on the event
 * and is what the views act on, so this only trims the words the outcome and
 * the inbox status already say. No reader branches on what it returns.
 */
export function endedDetail(
  summary: string,
  outcome: EndOutcome,
): string | null {
  let text = summary.trim();
  if (text.startsWith(outcome)) text = text.slice(outcome.length);
  text = text
    .replace(/^:\s*/, "")
    .replace(/\s*\(status [a-z_]+\)(?:,\s*through\s+\S+)?$/, "")
    .trim();
  return text || null;
}

/** The message of an `error` event: the summary without the recorded code in front of it. */
export function errorDetail(summary: string, code: string | null): string {
  const text = summary.trim();
  const prefix = code ? `${code}: ` : null;
  return prefix && text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * A line for an item's last event in the list. An end and a park are left
 * out: the chip, the reason a person has to look, and where the item is
 * already say so. Everything else is the line the engine wrote.
 */
export function lastEventText(event: {
  kind: string;
  summary: string;
}): string | null {
  if (event.kind === "ended" || event.kind === "parked") return null;
  return event.summary.trim() || null;
}
