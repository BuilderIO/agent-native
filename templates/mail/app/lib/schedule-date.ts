import { casual } from "chrono-node/en";

const DAY_PART_HOURS: Record<string, number> = {
  morning: 8,
  afternoon: 13,
  evening: 18,
  tonight: 18,
};

export function parseSendLaterDate(
  input: string,
  referenceDate = new Date(),
): Date | null {
  const trimmedInput = input.trim();
  if (!trimmedInput) return null;

  const [result] = casual.parse(trimmedInput, referenceDate, {
    forwardDate: true,
  });
  if (!result) return null;

  const date = result.start.date();
  const hasExplicitTime =
    result.start.isCertain("hour") || result.start.isCertain("minute");

  if (!hasExplicitTime) {
    const dayPart = trimmedInput
      .match(/\b(morning|afternoon|evening|tonight)\b/i)?.[1]
      ?.toLowerCase();
    date.setHours(dayPart ? DAY_PART_HOURS[dayPart] : 8, 0, 0, 0);
  }

  if (
    !Number.isFinite(date.getTime()) ||
    date.getTime() <= referenceDate.getTime()
  ) {
    return null;
  }

  return date;
}
