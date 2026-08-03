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

  // Selecting a zone commits it, matching the language picker beside it.
  const stored = preference.data?.timezone ?? SYSTEM;
  const pending = save.isPending ? save.variables?.timezone : undefined;
  const value = pending ?? stored;

  return (
    <div className="space-y-2">
      <label
        className="text-sm font-medium"
        htmlFor="agent-native-scheduling-timezone"
      >
        {t("settings.timezoneLabel", { defaultValue: "Timezone" })}
      </label>

      <TimezoneSelect
        id="agent-native-scheduling-timezone"
        value={value}
        disabled={preference.isLoading || save.isPending}
        suggested={[detected]}
        systemLabel={t("settings.timezoneSystem", {
          defaultValue: "Follow this browser ({{zone}})",
          zone: detected,
        })}
        onChange={(timezone) => save.mutate({ timezone })}
      />

      <p className="min-h-4 text-xs text-muted-foreground">
        {save.error ? (
          <span className="text-destructive">{save.error.message}</span>
        ) : (
          t("settings.timezoneHint", {
            defaultValue: "Used for timestamps and scheduled automations.",
          })
        )}
      </p>
    </div>
  );
}
