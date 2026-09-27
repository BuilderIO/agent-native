import type { ActionChangeResult } from "@agent-native/core/action-ui";
import { buildDeepLink } from "@agent-native/core/server";

import { isCalendarTimezone, timezoneShortName } from "../shared/timezone.js";

export function calendarTimeChoiceChange(
  start: string,
  end: string,
  timezone: string,
): ActionChangeResult | null {
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (
    !isCalendarTimezone(timezone) ||
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    endDate <= startDate
  ) {
    return null;
  }

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  const startDateLabel = dateFormatter.format(startDate);
  const endDateLabel = dateFormatter.format(endDate);
  const timezoneLabel = timezoneShortName(timezone);
  const dateLabel =
    startDateLabel === endDateLabel
      ? startDateLabel
      : `${startDateLabel} – ${endDateLabel}`;
  const params = new URLSearchParams({
    createSlot: "1",
    start,
    end,
    timezone,
  });

  return {
    change: {
      verb: "created",
      kind: "calendar-time-choice",
      title: "Best shared time",
      detail: `${dateLabel} · ${timeFormatter.format(startDate)}–${timeFormatter.format(endDate)} · ${timezoneLabel}`,
      url: buildDeepLink({
        app: "calendar",
        view: "calendar",
        to: `/home?${params.toString()}`,
      }),
    },
  };
}
