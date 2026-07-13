import { AgentTabsPage, useT } from "@agent-native/core/client";
import { useMemo } from "react";

import { useAppHeaderControls } from "@/components/layout/AppLayout";
import { messagesByLocale } from "@/i18n-data";

export function meta() {
  return [{ title: messagesByLocale["en-US"].settings.agentTitle }];
}

export default function AgentRoute() {
  const t = useT();
  const controls = useMemo(
    () => ({
      left: (
        <h1 className="truncate text-lg font-semibold tracking-tight">
          {t("settings.agentTitle")}
        </h1>
      ),
    }),
    [t],
  );
  useAppHeaderControls(controls);
  return <AgentTabsPage appName="Calendar" />;
}
