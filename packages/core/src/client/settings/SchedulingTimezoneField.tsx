import { ActionButton } from "@agent-native/toolkit/design-system";
import { useEffect, useState } from "react";

import {
  TimezoneSelect,
  browserTimezone,
} from "../agent-page/TimezoneSelect.js";
import { useT } from "../i18n.js";
import { useActionMutation, useActionQuery } from "../use-action.js";

interface LocalizationPreferenceResult {
  locale: string;
  timezone: string;
}

const SYSTEM = "system";

/**
 * Timezone used when the agent schedules work for this user.
 *
 * This is deliberately a stored preference rather than a per-request read of
 * the browser zone: automations are created and run by callers that have no
 * browser at all (cron ticks, chat integrations, A2A), and those callers would
 * otherwise fall back to the host zone and schedule the user's 8am job in UTC.
 */
export function SchedulingTimezoneField() {
  const t = useT();
  const detected = browserTimezone();
  const preference = useActionQuery<LocalizationPreferenceResult>(
    "get-localization-preference",
  );
  const save = useActionMutation<
    LocalizationPreferenceResult,
    { timezone: string }
  >("set-localization-preference");

  const stored = preference.data?.timezone ?? SYSTEM;
  const [value, setValue] = useState(SYSTEM);

  useEffect(() => {
    setValue(stored);
  }, [stored]);

  const usingDetected = value === SYSTEM;
  const effective = usingDetected ? detected : value;
  const changed = value !== stored;

  return (
    <div className="space-y-2">
      <div>
        <label
          className="text-sm font-medium"
          htmlFor="agent-native-scheduling-timezone"
        >
          {t("settings.timezoneLabel", { defaultValue: "Timezone" })}
        </label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("settings.timezoneDescription", {
            defaultValue:
              "Used when the agent schedules work for you, so a job set for 8:00 runs at 8:00 here.",
          })}
        </p>
      </div>

      <TimezoneSelect
        id="agent-native-scheduling-timezone"
        value={effective}
        disabled={preference.isLoading || save.isPending}
        suggested={[detected]}
        onChange={setValue}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="min-h-4 text-xs text-muted-foreground">
          {save.error ? (
            <span className="text-destructive">{save.error.message}</span>
          ) : save.isSuccess && !changed ? (
            <span className="text-green-600 dark:text-green-400">
              {t("settings.timezoneSaved", { defaultValue: "Timezone saved" })}
            </span>
          ) : usingDetected ? (
            t("settings.timezoneFollowingBrowser", {
              defaultValue:
                "Following this browser ({{zone}}). Pick a zone to keep schedules fixed to it.",
              zone: detected,
            })
          ) : null}
        </p>
        <ActionButton
          type="button"
          intent="primary"
          emphasis="outline"
          size="compact"
          disabled={!changed || save.isPending}
          onPress={() => save.mutate({ timezone: value })}
        >
          {save.isPending
            ? t("settings.timezoneSaving", { defaultValue: "Saving…" })
            : t("settings.timezoneSave", { defaultValue: "Save timezone" })}
        </ActionButton>
      </div>
    </div>
  );
}
