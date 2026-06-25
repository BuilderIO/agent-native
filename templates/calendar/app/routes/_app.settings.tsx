import { useMemo } from "react";
import Settings from "@/pages/Settings";
import { useAppHeaderControls } from "@/components/layout/AppLayout";
import { messagesByLocale } from "@/i18n-data";
import { useT } from "@agent-native/core/client";

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
