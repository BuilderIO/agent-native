import type { CalendarEvent, DeleteEventOptions } from "@shared/api";

import {
  withCalendarEventSourceIdentity,
  type CalendarEventSourceIdentity,
} from "./calendar-event-identity";

type EventSourceIdentityInput = Partial<CalendarEventSourceIdentity>;

export type DeleteEventMutationInput = DeleteEventOptions & {
  id: string;
  accountEmail?: string;
  cacheEventIdentity?: CalendarEventSourceIdentity;
};

export function buildDeleteEventMutationInput(
  event: Pick<CalendarEvent, "id" | "accountEmail"> & EventSourceIdentityInput,
  options: DeleteEventOptions = {},
): DeleteEventMutationInput {
  return withCalendarEventSourceIdentity(
    {
      ...options,
      id: event.id,
      accountEmail: event.accountEmail,
    },
    event,
  );
}
