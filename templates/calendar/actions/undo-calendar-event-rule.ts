import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import * as googleCalendar from "../server/lib/google-calendar.js";
import { normalizeCalendarSettings } from "../shared/settings.js";
import { resolveOwnedAccountEmail } from "./event-action-helpers.js";

export default defineAction({
  description:
    "Undo one recent automatic calendar invitation action, restoring its prior RSVP or removing its hidden state.",
  schema: z.object({
    activityId: z
      .string()
      .min(1)
      .max(2048)
      .describe("Activity id returned by get-settings for the current user"),
  }),
  run: async ({ activityId }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) fail("Unauthenticated", { errorCode: "unauthenticated" });
    const settings = normalizeCalendarSettings(
      await getUserSetting(ownerEmail, "calendar-settings"),
    );
    const activity = settings.eventRuleActivity?.find(
      (entry) => entry.id === activityId,
    );
    if (!activity)
      fail("Calendar rule activity was not found or was already undone.", {
        errorCode: "not_found",
        statusCode: 404,
      });

    const accountEmail = await resolveOwnedAccountEmail(
      activity.accountEmail,
      ownerEmail,
    );
    if (activity.action === "accepted" || activity.action === "declined") {
      const event = await googleCalendar.getEvent(activity.eventId, {
        ownerEmail,
        accountEmail,
      });
      if (event.responseStatus !== activity.action)
        fail("Could not undo this action.", {
          errorCode: "conflict",
          statusCode: 409,
        });
      await googleCalendar.rsvpEvent(
        activity.eventId,
        "needsAction",
        { ownerEmail, accountEmail },
        "single",
        undefined,
        "none",
      );
    }

    await mutateUserSetting(ownerEmail, "calendar-settings", (current) => {
      const record = (current ?? {}) as Record<string, unknown>;
      const latest = normalizeCalendarSettings(record);
      if (!latest.eventRuleActivity?.some((entry) => entry.id === activityId))
        fail("Calendar rule activity was already undone.", {
          errorCode: "not_found",
          statusCode: 404,
        });
      return {
        ...record,
        eventRuleActivity: latest.eventRuleActivity?.filter(
          (entry) => entry.id !== activityId,
        ),
        ...(activity.action === "hidden"
          ? {
              hiddenEventKeys: latest.hiddenEventKeys?.filter(
                (key) => key !== activity.hiddenEventKey,
              ),
            }
          : {}),
      };
    });
    return { success: true, activityId };
  },
});
