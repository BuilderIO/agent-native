import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { mutateUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import * as googleCalendar from "../server/lib/google-calendar.js";
import { normalizeCalendarSettings } from "../shared/settings.js";
import { resolveOwnedAccountEmail } from "./event-action-helpers.js";

const UNDO_CLAIMS_KEY = "__calendarEventRuleUndoClaims";
const UNDO_CLAIM_TTL_MS = 5 * 60 * 1000;
const EVENT_RULES_RUNTIME_KEY = "calendar-event-rules-runtime";

type UndoClaim = { token: string; expiresAt: number };

function readUndoClaims(value: unknown): Record<string, UndoClaim> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, claim]) => {
      if (
        !claim ||
        typeof claim !== "object" ||
        typeof (claim as UndoClaim).token !== "string" ||
        !Number.isFinite((claim as UndoClaim).expiresAt)
      ) {
        return [];
      }
      return [[id, claim as UndoClaim]];
    }),
  );
}

function conflict(): never {
  return fail("This calendar action is already being undone.", {
    errorCode: "conflict",
    statusCode: 409,
  });
}

function eventRuleKey(accountEmail: string, eventId: string) {
  return `google:${accountEmail.toLowerCase()}:primary:${eventId}`;
}

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
    const claimToken = randomUUID();
    const claimed = await mutateUserSetting(
      ownerEmail,
      "calendar-settings",
      (current) => {
        const record = (current ?? {}) as Record<string, unknown>;
        const latest = normalizeCalendarSettings(record);
        const activity = latest.eventRuleActivity?.find(
          (entry) => entry.id === activityId,
        );
        if (!activity)
          fail("Calendar rule activity was not found or was already undone.", {
            errorCode: "not_found",
            statusCode: 404,
          });

        const now = Date.now();
        const activityIds = new Set(
          latest.eventRuleActivity?.map((entry) => entry.id),
        );
        const claims = Object.fromEntries(
          Object.entries(readUndoClaims(record[UNDO_CLAIMS_KEY])).filter(
            ([id, claim]) => activityIds.has(id) && claim.expiresAt > now,
          ),
        );
        if (Object.prototype.hasOwnProperty.call(claims, activityId))
          conflict();
        return {
          ...record,
          [UNDO_CLAIMS_KEY]: {
            ...claims,
            [activityId]: {
              token: claimToken,
              expiresAt: now + UNDO_CLAIM_TTL_MS,
            },
          },
        };
      },
    );
    const activity = normalizeCalendarSettings(claimed).eventRuleActivity?.find(
      (entry) => entry.id === activityId,
    );
    if (!activity) conflict();

    let providerWriteAttempted = false;
    let undoSuppressionKey: string | undefined;
    try {
      if (activity.action === "accepted" || activity.action === "declined") {
        const accountEmail = await resolveOwnedAccountEmail(
          activity.accountEmail,
          ownerEmail,
        );
        const event = await googleCalendar.getEvent(activity.eventId, {
          ownerEmail,
          accountEmail,
        });
        const responseStatus =
          event.responseStatus ??
          event.attendees?.find(
            (attendee) =>
              attendee.self ||
              attendee.email?.toLowerCase() === accountEmail.toLowerCase(),
          )?.responseStatus;
        if (
          responseStatus === activity.action ||
          responseStatus === "needsAction"
        ) {
          undoSuppressionKey = eventRuleKey(accountEmail, activity.eventId);
          await mutateUserSetting(
            ownerEmail,
            EVENT_RULES_RUNTIME_KEY,
            (current) => {
              const record = (current ?? {}) as Record<string, any>;
              if (
                (record.rsvpClaims?.[undoSuppressionKey!]?.expiresAt ?? 0) >
                Date.now()
              )
                conflict();
              const suppressions = {
                ...(record.undoRsvpSuppressions ?? {}),
              };
              delete suppressions[undoSuppressionKey!];
              suppressions[undoSuppressionKey!] = { token: claimToken };
              return {
                ...record,
                undoRsvpSuppressions: Object.fromEntries(
                  Object.entries(suppressions).slice(-5000),
                ),
              };
            },
          );
        }
        if (responseStatus === activity.action) {
          providerWriteAttempted = true;
          await googleCalendar.rsvpEvent(
            activity.eventId,
            "needsAction",
            { ownerEmail, accountEmail },
            "single",
            undefined,
            "none",
          );
        } else if (responseStatus === "needsAction") {
          // A previous request may have completed the RSVP before its settings
          // write failed. Finalize it without sending the RSVP a second time.
          providerWriteAttempted = true;
        } else {
          fail("Could not undo this action.", {
            errorCode: "conflict",
            statusCode: 409,
          });
        }
      }

      await mutateUserSetting(ownerEmail, "calendar-settings", (current) => {
        const record = (current ?? {}) as Record<string, unknown>;
        const latest = normalizeCalendarSettings(record);
        const claims = readUndoClaims(record[UNDO_CLAIMS_KEY]);
        if (
          !Object.prototype.hasOwnProperty.call(claims, activityId) ||
          claims[activityId]?.token !== claimToken
        )
          conflict();
        const nextClaims = { ...claims };
        delete nextClaims[activityId];
        return {
          ...record,
          [UNDO_CLAIMS_KEY]: nextClaims,
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
    } catch (error) {
      if (!providerWriteAttempted) {
        if (undoSuppressionKey) {
          await mutateUserSetting(
            ownerEmail,
            EVENT_RULES_RUNTIME_KEY,
            (current) => {
              const record = (current ?? {}) as Record<string, any>;
              const suppressions = {
                ...(record.undoRsvpSuppressions ?? {}),
              };
              if (suppressions[undoSuppressionKey!]?.token !== claimToken)
                return record;
              delete suppressions[undoSuppressionKey!];
              return { ...record, undoRsvpSuppressions: suppressions };
            },
          );
        }
        await mutateUserSetting(ownerEmail, "calendar-settings", (current) => {
          const record = (current ?? {}) as Record<string, unknown>;
          const claims = readUndoClaims(record[UNDO_CLAIMS_KEY]);
          if (
            !Object.prototype.hasOwnProperty.call(claims, activityId) ||
            claims[activityId]?.token !== claimToken
          )
            return record;
          const nextClaims = { ...claims };
          delete nextClaims[activityId];
          return { ...record, [UNDO_CLAIMS_KEY]: nextClaims };
        });
      }
      throw error;
    }
  },
});
