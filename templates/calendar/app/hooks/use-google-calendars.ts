import { useActionQuery } from "@agent-native/core/client/hooks";
import type { GoogleCalendarSource } from "@shared/api";
import { useQuery } from "@tanstack/react-query";

import {
  calendarReadRetryDelay,
  shouldRetryCalendarRead,
} from "@/lib/calendar-read-retry";
import {
  isSharedCalendarDemo,
  SHARED_CALENDAR_DEMO_SOURCES,
} from "@/lib/shared-calendar-demo";

export function useGoogleCalendars(options?: { enabled?: boolean }) {
  const demo = isSharedCalendarDemo();
  const enabled = options?.enabled ?? true;
  const live = useActionQuery<{
    calendars: GoogleCalendarSource[];
    errors: Array<{ email: string; error: string }>;
  }>(
    "list-google-calendars",
    { strict: true },
    {
      enabled: enabled && !demo,
      retry: shouldRetryCalendarRead,
      retryDelay: calendarReadRetryDelay,
      staleTime: 30_000,
    },
  );
  const fixture = useQuery({
    queryKey: ["shared-calendar-demo-sources"],
    queryFn: async () => SHARED_CALENDAR_DEMO_SOURCES,
    enabled: demo,
    staleTime: Infinity,
  });
  const partialCalendars = (
    (live.error ?? live.failureReason) as {
      details?: { calendars?: unknown };
    } | null
  )?.details?.calendars;
  const availableCalendars =
    Array.isArray(partialCalendars) && partialCalendars.length > 0
      ? (partialCalendars as GoogleCalendarSource[])
      : undefined;
  return {
    ...(demo ? fixture : live),
    data: demo ? fixture.data : (live.data?.calendars ?? availableCalendars),
    hasPartialData: !demo && !live.data && Boolean(availableCalendars),
    sourceErrors: demo ? [] : (live.data?.errors ?? []),
    enabled,
    demo,
  };
}
