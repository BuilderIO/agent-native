import { useActionQuery } from "@agent-native/core/client/hooks";
import type { GoogleCalendarSource } from "@shared/api";
import { useQuery } from "@tanstack/react-query";

import {
  isSharedCalendarDemo,
  SHARED_CALENDAR_DEMO_SOURCES,
} from "@/lib/shared-calendar-demo";

export function useGoogleCalendars() {
  const demo = isSharedCalendarDemo();
  const enabled = true;
  const live = useActionQuery<{
    calendars: GoogleCalendarSource[];
    errors: Array<{ email: string; error: string }>;
  }>(
    "list-google-calendars",
    {},
    {
      enabled: enabled && !demo,
      retry: false,
      staleTime: 30_000,
    },
  );
  const fixture = useQuery({
    queryKey: ["shared-calendar-demo-sources"],
    queryFn: async () => SHARED_CALENDAR_DEMO_SOURCES,
    enabled: demo,
    staleTime: Infinity,
  });
  return {
    ...(demo ? fixture : live),
    data: demo ? fixture.data : live.data?.calendars,
    sourceErrors: demo ? [] : (live.data?.errors ?? []),
    enabled,
    demo,
  };
}
