import { mutateUserSetting } from "@agent-native/core/settings";

import type { ExternalCalendar } from "../../shared/api.js";

export async function mutateExternalCalendars(
  owner: string,
  change: (feeds: ExternalCalendar[]) => ExternalCalendar[],
): Promise<ExternalCalendar[]> {
  let next: ExternalCalendar[] = [];
  await mutateUserSetting(owner, "external-calendars", (current) => {
    if (current != null && !Array.isArray(current)) {
      throw new Error(
        "The saved calendar feed list isn't a list, so it was left unchanged",
      );
    }
    next = change(
      Array.isArray(current) ? (current as unknown as ExternalCalendar[]) : [],
    );
    return next as unknown as Record<string, unknown>;
  });
  return next;
}
