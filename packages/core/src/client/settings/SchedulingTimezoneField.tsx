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

export function SchedulingTimezoneField({
  compact = false,
}: {
  compact?: boolean;
}) {
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
  const pending = save.isPending ? save.variables?.timezone : undefined;
  const value = pending ?? stored;

  const select = (
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
  );

  if (compact) {
    return (
      <div className="w-full sm:w-72">
        {select}
        {save.error && (
          <p className="mt-1 text-xs text-destructive">{save.error.message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label
        className="text-sm font-medium"
        htmlFor="agent-native-scheduling-timezone"
      >
        {t("settings.timezoneLabel", { defaultValue: "Timezone" })}
      </label>
      {select}
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
