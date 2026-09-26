import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAssetsPrefs } from "@/hooks/use-assets-prefs";

/** Assets › Notifications in the redesigned Settings. */
export function AssetsNotificationSettings() {
  const t = useT();
  const { prefs, loading, loadFailed, save } = useAssetsPrefs();
  const label = t("settings.emailNotifications");

  return (
    <SettingsGroup id="email" title={t("settings.emailGroup")}>
      <SettingsRow
        id="notifications"
        label={label}
        description={
          loadFailed ? (
            <span role="alert" className="text-destructive">
              {t("settings.notificationsLoadFailed")}
            </span>
          ) : (
            t("settings.emailNotificationsDescription")
          )
        }
        control={
          loading ? (
            <Skeleton className="h-5 w-9" />
          ) : loadFailed ? null : (
            <Switch
              aria-label={label}
              checked={prefs.emailNotifications !== false}
              onCheckedChange={(checked) => {
                save({ emailNotifications: checked }).catch((err) => {
                  toast.error(
                    err instanceof Error
                      ? err.message
                      : t("settings.saveFailed"),
                  );
                });
              }}
            />
          )
        }
      />
    </SettingsGroup>
  );
}
