import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { SettingsGroup, SettingsRow } from "@agent-native/core/client/settings";
import type { SlidesNotificationPreferences } from "@shared/slides-user-prefs";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

export const COMMENT_EMAILS_ROW_ID = "comments-and-replies";

/**
 * The comment-email switch, backed by the same actions the agent calls.
 * While the preference loads the switch is a skeleton, and a failed read
 * offers Retry instead of showing a guessed value.
 */
function CommentEmailsControl({ label }: { label: string }): ReactNode {
  const t = useT();
  const query = useActionQuery<SlidesNotificationPreferences>(
    "get-slides-notification-prefs",
    undefined,
    { retry: false },
  );
  const mutation = useActionMutation<
    SlidesNotificationPreferences,
    { emailNotifications: boolean }
  >("update-slides-notification-prefs");
  const [optimistic, setOptimistic] = useState<boolean | undefined>();

  useEffect(() => {
    if (query.data) setOptimistic(undefined);
  }, [query.data]);

  if (query.isError) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => query.refetch()}
      >
        {t("settings.retry")}
      </Button>
    );
  }
  if (!query.data) {
    return <Skeleton className="h-6 w-11" />;
  }

  const enabled = optimistic ?? query.data.emailNotifications;
  return (
    <Switch
      aria-label={label}
      checked={enabled}
      disabled={mutation.isPending}
      onCheckedChange={(checked) => {
        const previous = enabled;
        setOptimistic(checked);
        mutation.mutate(
          { emailNotifications: checked },
          {
            onSuccess: (saved) => setOptimistic(saved.emailNotifications),
            onError: (error) => {
              setOptimistic(previous);
              toast.error(error.message || t("settings.saveFailed"));
            },
          },
        );
      }}
    />
  );
}

/** Slides' Notifications page in the redesigned Settings. */
export function NotificationSettings() {
  const t = useT();
  const label = t("settings.commentsAndReplies");
  return (
    <SettingsGroup id="email" title={t("settings.notificationsEmail")}>
      <SettingsRow
        id={COMMENT_EMAILS_ROW_ID}
        label={label}
        description={t("settings.commentsAndRepliesDescription")}
        control={<CommentEmailsControl label={label} />}
      />
    </SettingsGroup>
  );
}

/** Today's Email notifications row on the General tab. */
export function LegacyEmailNotificationsRow() {
  const t = useT();
  const label = t("settings.emailNotifications");
  return (
    <SettingsRow
      id="notifications"
      label={label}
      description={t("settings.emailNotificationsDescription")}
      control={<CommentEmailsControl label={label} />}
    />
  );
}
