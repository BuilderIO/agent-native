import { AgentToggleButton } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconPlus } from "@tabler/icons-react";
import { Link, useLocation, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";

export const FACTORY_AGENTS_HREF = "/factory?tab=agents";
export const NEW_FACTORY_HREF = "/new-factory";

export function FactoryWorkspaceActions() {
  const t = useT();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const onAgents =
    location.pathname === "/agents" ||
    (location.pathname === "/factory" &&
      searchParams.get("tab") === "agents" &&
      !searchParams.get("factoryId"));
  const onNewFactoryPage = location.pathname === "/new-factory";

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant={onAgents ? "default" : "outline"} size="sm">
        <Link to={FACTORY_AGENTS_HREF}>{t("factoryRoute.agentsTab")}</Link>
      </Button>
      {!onNewFactoryPage ? (
        <Button asChild variant="outline" size="sm">
          <Link to={NEW_FACTORY_HREF}>
            <IconPlus className="size-4" />
            {t("factoryRoute.newFactory")}
          </Link>
        </Button>
      ) : null}
      <AgentToggleButton />
    </div>
  );
}
