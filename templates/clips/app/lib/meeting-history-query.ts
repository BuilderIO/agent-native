export const MEETING_HISTORY_PAGE_SIZE = 50;

export function buildMeetingHistoryQuery(offset: number) {
  return {
    view: "past" as const,
    hasContent: true,
    includeLiveCalendar: false,
    limit: MEETING_HISTORY_PAGE_SIZE,
    offset,
  };
}
