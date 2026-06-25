import { useT } from "@agent-native/core/client";
import { useMemo } from "react";

import { useAppHeaderControls } from "@/components/layout/AppLayout";
import { messagesByLocale } from "@/i18n-data";
import Settings from "@/pages/Settings";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.settings }];
}

export default function SettingsRoute() {
  const t = useT();
  const controls = useMemo(
    () => ({
      left: (
        <h1 className="text-lg font-semibold tracking-tight truncate">
          {t("navigation.settings")}
        </h1>
      ),
    }),
    [t],
  );
  useAppHeaderControls(controls);
  return <Settings />;
}
