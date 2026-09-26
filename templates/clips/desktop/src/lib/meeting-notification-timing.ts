
export const MEETING_NOTIFY_LEAD_MS = 60_000;
export const MEETING_NOTIFY_HOLD_AFTER_START_MS = 5 * 60_000;

export function isMeetingNotificationWindowOpen(
  startMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(startMs)) return false;
  const earliest = startMs - MEETING_NOTIFY_LEAD_MS;
  const latest = startMs + MEETING_NOTIFY_HOLD_AFTER_START_MS;
  return nowMs >= earliest && nowMs <= latest;
}

export function meetingNotificationAutoHideMs(
  startMs: number,
  nowMs: number = Date.now(),
): number {
  if (!Number.isFinite(startMs)) return 0;
  const latest = startMs + MEETING_NOTIFY_HOLD_AFTER_START_MS;
  return Math.max(0, latest - nowMs);
}

export type MeetingJoinProvider = "zoom" | "meet" | "teams" | "webex" | "other";

export function detectMeetingJoinProvider(
  joinUrl: string | null | undefined,
  platform?: string | null,
): MeetingJoinProvider {
  const haystack = `${platform ?? ""} ${joinUrl ?? ""}`.toLowerCase();
  if (haystack.includes("zoom")) return "zoom";
  if (haystack.includes("meet.google") || /\bmeet\b/.test(haystack))
    return "meet";
  if (haystack.includes("teams.microsoft") || haystack.includes("teams"))
    return "teams";
  if (haystack.includes("webex")) return "webex";
  return "other";
}

export function joinProviderLabel(provider: MeetingJoinProvider): string {
  switch (provider) {
    case "zoom":
      return "Zoom";
    case "meet":
      return "Meet";
    case "teams":
      return "Teams";
    case "webex":
      return "Webex";
    default:
      return "meeting";
  }
}

export function formatMeetingTimeRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  locale?: string,
): string | null {
  if (!startIso) return null;
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return null;
  const end = endIso ? Date.parse(endIso) : NaN;
  const fmt = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  const startLabel = fmt.format(new Date(start));
  if (!Number.isFinite(end)) return startLabel;
  return `${startLabel} - ${fmt.format(new Date(end))}`;
}
