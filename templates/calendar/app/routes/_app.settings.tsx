import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";

import { useAppHeaderControls } from "@/components/layout/AppLayout";
import enUSMessages from "@/i18n/en-US";
import Settings from "@/pages/Settings";

export function meta() {
  return [{ title: enUSMessages.routeTitles.settings }];
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
