import { defineAction, fail } from "@agent-native/core/action";
import { getDecisionsStatus } from "@agent-native/core/decisions";
import {
  getRequestUserEmail,
  hasRecurringSweepHandler,
  scheduledTriggerAvailability,
} from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

export default defineAction({
  description:
    "Check whether automatic calendar invitation rules can run on this deployment.",
  schema: z.object({}),
  http: { method: "GET" },
  dedupe: false,
  run: async () => {
    const owner = getRequestUserEmail();
    if (!owner) throw new Error("no authenticated user");
    const decisionStatus = await getDecisionsStatus(owner);
    const decisionProviderConfigured = decisionStatus.providers.some(
      (provider) => provider.status === "ready",
    );
    if (
      !decisionProviderConfigured &&
      decisionStatus.providers.some((provider) => provider.status === "unknown")
    ) {
      fail("Decision provider availability could not be checked.", {
        errorCode: "jev_availability_failed",
        statusCode: 503,
      });
    }
    const availability = scheduledTriggerAvailability();
    const registered = hasRecurringSweepHandler("calendar-event-rules");
    const configured = registered && availability.available;
    const unavailableReason = availability.available
      ? null
      : availability.reason;
    const runtime = (await getUserSetting(
      owner,
      "calendar-event-rules-runtime",
    )) as {
      lastError?: string;
      lastConflictCount?: number;
      accountRefreshErrors?: Array<{ email: string; error: string }>;
    } | null;
    return {
      decisionProviderConfigured,
      jevConfigured: decisionProviderConfigured,
      enabled: configured,
      reason: configured ? null : unavailableReason,
      registered,
      intervalMinutes: configured ? 5 : null,
      message: configured
        ? null
        : !registered
          ? "calendar-rule-handler-not-registered"
          : (unavailableReason ?? "calendar-rule-handler-not-scheduled"),
      lastError: runtime?.lastError ?? null,
      accountRefreshErrors: runtime?.accountRefreshErrors ?? [],
      conflictsSkipped: (runtime?.lastConflictCount ?? 0) > 0,
    };
  },
});
