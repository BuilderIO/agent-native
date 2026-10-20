import { useT } from "@agent-native/core/client/i18n";
import { IconArrowLeft } from "@tabler/icons-react";
import { Link } from "react-router";

import { FactoryAgentsView } from "@/components/factory/FactoryAgentsView";
import { FactoryWorkspaceActions } from "@/components/factory/FactoryWorkspaceActions";
import { Button } from "@/components/ui/button";

export default function AgentsRoute() {
  const t = useT();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
      <div className="flex items-center gap-3 px-4 py-4 lg:px-6">
        <Button asChild type="button" variant="ghost" size="icon">
          <Link to="/factory" aria-label={t("factoryRoute.backToFactories")}>
            <IconArrowLeft className="size-4" />
          </Link>
        </Button>
        <h1 className="text-sm font-medium sm:text-base">
          {t("factoryRoute.agentsTitle")}
        </h1>
        <div className="ms-auto">
          <FactoryWorkspaceActions />
        </div>
      </div>
      <FactoryAgentsView />
    </div>
  );
}
