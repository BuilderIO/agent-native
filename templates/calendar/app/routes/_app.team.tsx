import { useT } from "@agent-native/core/client";
import { useMemo } from "react";

import { useAppHeaderControls } from "@/components/layout/AppLayout";
import { messagesByLocale } from "@/i18n-data";
import Team from "@/pages/Team";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.team }];
}

export default function TeamRoute() {
  const t = useT();
  const controls = useMemo(
    () => ({
      left: (
        <h1 className="text-lg font-semibold tracking-tight truncate">
          {t("navigation.team")}
        </h1>
      ),
    }),
    [t],
  );
  useAppHeaderControls(controls);
  return <Team />;
}
