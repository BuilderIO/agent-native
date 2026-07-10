interface EventFormInitializationInput {
  draftId?: string;
  draftTimezone: string;
  date: string;
  startTime: string;
  endTime: string;
  defaultTimezone: string;
}

export function buildEventFormInitializationKey({
  draftId,
  draftTimezone,
  date,
  startTime,
  endTime,
  defaultTimezone,
}: EventFormInitializationInput): string {
  return draftId
    ? `draft:${draftId}:${draftTimezone}`
    : `new:${date}:${startTime}:${endTime}:${defaultTimezone}`;
}
