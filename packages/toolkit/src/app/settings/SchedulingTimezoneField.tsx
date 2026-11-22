import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";

import {
  TimezoneSelect,
  browserTimezone,
} from "../agent-page/TimezoneSelect.js";

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
  >("set-localization-preference", { errorNotification: "caller" });

  const loadFailed = preference.isError && !preference.data;
  const stored = preference.data?.timezone ?? SYSTEM;
  const pending = save.isPending ? save.variables?.timezone : undefined;
  const value = pending ?? stored;

  const select = (
    <TimezoneSelect
      id="agent-native-scheduling-timezone"
      value={value}
      disabled={preference.isLoading || loadFailed || save.isPending}
      suggested={[detected]}
      systemLabel={t("settings.timezoneSystem", {
        defaultValue: "Follow this browser ({{zone}})",
        zone: detected,
      })}
      onChange={(timezone) => save.mutate({ timezone })}
      size={compact ? "sm" : "default"}
      unavailable={loadFailed}
    />
  );

  const loadError = loadFailed ? (
    <p
      role="alert"
      className="flex items-center gap-1 text-xs text-destructive"
    >
      {t("agentChat.settings.timezoneLoadFailed")}
      <Button
        type="button"
        variant="link"
        size="sm"
        disabled={preference.isFetching}
        aria-busy={preference.isFetching}
        onClick={() => void preference.refetch()}
      >
        {t("agentChat.common.retry")}
      </Button>
    </p>
  ) : null;

  if (compact) {
    return (
      <div className="w-full sm:w-72">
        {select}
        {loadError}
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
      {loadError ?? (
        <p className="min-h-4 text-xs text-muted-foreground">
          {save.error ? (
            <span className="text-destructive">{save.error.message}</span>
          ) : (
            t("settings.timezoneHint", {
              defaultValue: "Used for timestamps and scheduled automations.",
            })
          )}
        </p>
      )}
    </div>
  );
}
