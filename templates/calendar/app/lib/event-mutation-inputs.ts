import type { CalendarEvent, DeleteEventOptions } from "@shared/api";

export type DeleteEventMutationInput = DeleteEventOptions & {
  id: string;
  accountEmail?: string;
};

/** Keep the event's connected account attached to every delete variant. */
export function buildDeleteEventMutationInput(
  event: Pick<CalendarEvent, "id" | "accountEmail">,
  options: DeleteEventOptions = {},
): DeleteEventMutationInput {
  return {
    id: event.id,
    accountEmail: event.accountEmail,
    ...options,
  };
}
