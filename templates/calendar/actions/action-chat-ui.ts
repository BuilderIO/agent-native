import type { ActionChangeResult } from "@agent-native/core/action-ui";
import {
  DEFAULT_LOCALE,
  LOCALIZATION_SETTING_KEY,
  normalizeLocalizationPreference,
  resolveLocaleFromRequest,
  type LocaleCode,
} from "@agent-native/core/localization";
import { buildDeepLink } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";

import { isCalendarTimezone, timezoneShortName } from "../shared/timezone.js";

export async function resolveCalendarActionLocale(
  email: string,
  requestHeaders?: Headers,
): Promise<LocaleCode> {
  let preference:
    | ReturnType<typeof normalizeLocalizationPreference>
    | undefined;
  try {
    preference = normalizeLocalizationPreference(
      await getUserSetting(email, LOCALIZATION_SETTING_KEY),
    );
  } catch {
    // coercion-ok: the saved locale only formats action results.
  }
  return resolveLocaleFromRequest({
    preference,
    request: requestHeaders ? { headers: requestHeaders } : undefined,
    fallback: DEFAULT_LOCALE,
  }).locale;
}

export function calendarTimeChoiceChange(
  start: string,
  end: string,
  timezone: string,
  locale: LocaleCode = DEFAULT_LOCALE,
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

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  const startDateLabel = dateFormatter.format(startDate);
  const endDateLabel = dateFormatter.format(endDate);
  const timezoneLabel = timezoneShortName(timezone, locale);
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
