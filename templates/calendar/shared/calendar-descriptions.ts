/** The longest description a connected account or calendar feed can carry. */
export const MAX_CALENDAR_DESCRIPTION_LENGTH = 300;

/**
 * Trims a description and folds its whitespace to single spaces. Anything
 * that isn't text, or is empty once trimmed, means no description.
 */
export function normalizeCalendarDescription(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_CALENDAR_DESCRIPTION_LENGTH) : undefined;
}
