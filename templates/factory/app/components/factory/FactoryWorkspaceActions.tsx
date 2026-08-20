import { AgentToggleButton } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { IconPlus } from "@tabler/icons-react";
import { Link, useLocation, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";

export const FACTORY_AGENTS_HREF = "/factory?tab=agents";
export const FACTORY_SETTINGS_HREF = "/factory-settings";
export const FACTORY_NEW_HREF = "/factory?new=1";

export function FactoryWorkspaceActions({
  onNewFactory,
}: {
  onNewFactory?: () => void;
}) {
  const t = useT();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const onAgents =
    location.pathname === "/agents" ||
    (location.pathname === "/factory" &&
      searchParams.get("tab") === "agents" &&
      !searchParams.get("factoryId"));
  const onSettings = location.pathname === "/factory-settings";

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant={onAgents ? "default" : "outline"} size="sm">
        <Link to={FACTORY_AGENTS_HREF}>{t("factoryRoute.agentsTab")}</Link>
      </Button>
      <Button asChild variant={onSettings ? "default" : "outline"} size="sm">
        <Link to={FACTORY_SETTINGS_HREF}>
          {t("factoryRoute.factorySettings")}
        </Link>
      </Button>
      {onNewFactory ? (
        <Button type="button" size="sm" onClick={onNewFactory}>
          <IconPlus className="size-4" />
          {t("factoryRoute.newFactory")}
        </Button>
      ) : (
        <Button asChild size="sm">
          <Link to={FACTORY_NEW_HREF}>
            <IconPlus className="size-4" />
            {t("factoryRoute.newFactory")}
          </Link>
        </Button>
      )}
      <AgentToggleButton />
    </div>
  );
}
