import { useMemo } from "react";
import Team from "@/pages/Team";
import { useAppHeaderControls } from "@/components/layout/AppLayout";
import { messagesByLocale } from "@/i18n-data";
import { useT } from "@agent-native/core/client";

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
