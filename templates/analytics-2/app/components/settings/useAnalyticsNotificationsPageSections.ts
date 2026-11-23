import { useT } from "@agent-native/core/client/i18n";
import {
  useCreateResource,
  useResource,
  useResources,
  useUpdateResource,
} from "@agent-native/core/client/resources/use-resources";
import type { SettingsSectionDefinition } from "@agent-native/toolkit/app/settings";
import { useEffect, useRef, useState } from "react";

import { requestDesktopNotificationPermission } from "@/lib/desktop-notifications";

/** Where this app keeps the signed-in person's notification choices. */
const NOTIFICATIONS_PATH = "settings/notifications.json";

interface NotificationSettings {
  desktopNotifications: boolean;
}

const DEFAULTS: NotificationSettings = { desktopNotifications: false };

function parseSettings(content: string | undefined): NotificationSettings {
  if (!content) return DEFAULTS;
  try {
    const parsed = JSON.parse(content) as Partial<NotificationSettings>;
    return {
      desktopNotifications:
        typeof parsed.desktopNotifications === "boolean"
          ? parsed.desktopNotifications
          : DEFAULTS.desktopNotifications,
    };
  } catch {
    return DEFAULTS;
  }
}

export function useAnalyticsNotificationsPageSections(): SettingsSectionDefinition[] {
  const t = useT();
  const resourceList = useResources("personal");
  const meta = resourceList.data?.find(
    (resource) => resource.path === NOTIFICATIONS_PATH,
  );
  const settings = useResource(meta?.id ?? null);
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const savedContents = useRef<NotificationSettings>(DEFAULTS);

  useEffect(() => {
    if (settings.data?.content) {
      savedContents.current = parseSettings(settings.data.content);
      setDraft(null);
    }
  }, [settings.data?.content]);

  const value = draft ?? parseSettings(settings.data?.content);
  const saving = createResource.isPending || updateResource.isPending;

  const setDesktopNotifications = async (next: boolean) => {
    const previous = value;
    const merged: NotificationSettings = {
      ...value,
      desktopNotifications: next,
    };
    setDraft(merged);
    // Turning the switch on is the click that asks the browser for permission;
    // without it the notice the run raises could never appear.
    if (next) void requestDesktopNotificationPermission();
    try {
      const content = JSON.stringify(merged, null, 2);
      if (meta) {
        await updateResource.mutateAsync({ id: meta.id, content });
      } else {
        await createResource.mutateAsync({
          path: NOTIFICATIONS_PATH,
          content,
          mimeType: "application/json",
        });
      }
      savedContents.current = merged;
      setDraft(null);
    } catch {
      // Put the switch back where it was, so the control never shows a state
      // the store does not hold.
      setDraft(previous);
    }
  };

  const title = t("analytics.settings.notifications.desktopNotifications");
  return [
    {
      id: "notifications",
      label: title,
      state:
        resourceList.isPending || (meta && settings.isPending)
          ? { status: "loading", label: title, rows: 2 }
          : { status: "ready" },
      rows: [
        {
          id: "settings.notifications.desktop-notifications",
          kind: "toggle",
          label: t("analytics.settings.notifications.responseCompleted"),
          description: t(
            "analytics.settings.notifications.desktopNotificationsDescription",
          ),
          binding: {
            value: value.desktopNotifications,
            set: setDesktopNotifications,
            pending: saving,
          },
        },
      ],
    },
  ];
}
