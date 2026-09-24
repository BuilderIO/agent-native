import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsLoadingRow,
  SettingsRow,
} from "@agent-native/core/client/settings";
import {
  applyClipsNotificationPrefsPatch,
  CLIPS_NOTIFICATION_CATEGORIES,
  CLIPS_NOTIFICATION_PREFERENCE_FIELDS,
  getClipsNotificationPreferences,
  type ClipsNotificationPreferences,
  type ClipsNotificationPrefsPatch,
} from "@shared/clips-notification-prefs";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const DEFAULT_PREFERENCES = getClipsNotificationPreferences(null);

const CATEGORY_LABELS = {
  views: "recordingInsights.views",
  comments: "notificationsRoute.comments",
  reactions: "notificationsRoute.reactions",
  recaps: "settings.monthlyRecap",
} as const;

export function NotificationSettings() {
  const t = useT();
  const query = useActionQuery<ClipsNotificationPreferences>(
    "get-clips-notification-prefs",
    undefined,
    { retry: false },
  );
  const mutation = useActionMutation<
    ClipsNotificationPreferences,
    ClipsNotificationPrefsPatch
  >("update-clips-notification-prefs");
  const [optimistic, setOptimistic] = useState<
    ClipsNotificationPreferences | undefined
  >();

  useEffect(() => {
    if (query.data) setOptimistic(undefined);
  }, [query.data]);

  const preferences = optimistic ?? query.data ?? DEFAULT_PREFERENCES;
  const allEnabled =
    preferences.emailNotifications &&
    CLIPS_NOTIFICATION_CATEGORIES.every(
      (category) => preferences[CLIPS_NOTIFICATION_PREFERENCE_FIELDS[category]],
    );

  function update(patch: ClipsNotificationPrefsPatch) {
    const previous = preferences;
    const next = getClipsNotificationPreferences(
      applyClipsNotificationPrefsPatch(previous, patch),
    );
    setOptimistic(next);
    mutation.mutate(patch, {
      onSuccess: (saved) => setOptimistic(saved),
      onError: (error) => {
        setOptimistic(previous);
        toast.error(error.message || t("settings.saveFailed"));
      },
    });
  }

  if (query.isError) {
    return (
      <SettingsGroup title={t("settings.notifications")}>
        <SettingsRow
          label={t("settings.emailNotifications")}
          control={
            <Button
              type="button"
              variant="outline"
              onClick={() => query.refetch()}
            >
              {t("libraryGrid.retry")}
            </Button>
          }
        />
      </SettingsGroup>
    );
  }

  if (query.isLoading && !query.data) {
    return (
      <SettingsGroup title={t("settings.notifications")}>
        <SettingsLoadingRow />
        <SettingsLoadingRow />
        <SettingsLoadingRow />
        <SettingsLoadingRow />
        <SettingsLoadingRow />
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title={t("settings.notifications")}>
      <SettingsRow
        id="all-email-notifications"
        label={t("settings.emailNotifications")}
        description={t("settings.emailNotificationsDescription")}
        control={
          <Switch
            id="all-email-notifications-switch"
            aria-label={t("settings.emailNotifications")}
            checked={allEnabled}
            onCheckedChange={(enabled) =>
              update({
                emailNotifications: enabled,
                viewNotifications: enabled,
                commentNotifications: enabled,
                reactionNotifications: enabled,
                recapNotifications: enabled,
              })
            }
            disabled={mutation.isPending}
          />
        }
      />
      {CLIPS_NOTIFICATION_CATEGORIES.map((category) => {
        const field = CLIPS_NOTIFICATION_PREFERENCE_FIELDS[category];
        return (
          <SettingsRow
            key={category}
            id={`${category}-notifications`}
            label={t(CATEGORY_LABELS[category])}
            control={
              <Switch
                id={`${category}-notifications-switch`}
                aria-label={t(CATEGORY_LABELS[category])}
                checked={preferences[field]}
                onCheckedChange={(enabled) =>
                  update({
                    emailNotifications: true,
                    [field]: enabled,
                  } as ClipsNotificationPrefsPatch)
                }
                disabled={!preferences.emailNotifications || mutation.isPending}
              />
            }
          />
        );
      })}
    </SettingsGroup>
  );
}
