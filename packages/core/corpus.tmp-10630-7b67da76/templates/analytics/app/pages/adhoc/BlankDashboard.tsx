import { useT } from "@agent-native/core/client";
import { IconFlask } from "@tabler/icons-react";

import { useSetPageTitle } from "@/components/layout/HeaderActions";

export default function BlankDashboard() {
  const t = useT();

  useSetPageTitle(
    <h1 className="text-lg font-semibold tracking-tight truncate">
      {t("common.emptyDashboard")}
    </h1>,
  );

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-6">
        <IconFlask className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">
        {t("common.emptyDashboard")}
      </h3>
      <p className="text-sm text-muted-foreground max-w-md">
        {t("common.emptyDashboardDescription")}
      </p>
    </div>
  );
}
