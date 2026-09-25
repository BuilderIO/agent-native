interface EventFormInitializationInput {
  draftId?: string;
  date: string;
  startTime?: string;
  endTime?: string;
}

export function buildEventFormInitializationKey({
  draftId,
  date,
  startTime,
  endTime,
}: EventFormInitializationInput): string {
  return draftId
    ? `draft:${draftId}`
    : `new:${date}:${startTime ?? ""}:${endTime ?? ""}`;
}
