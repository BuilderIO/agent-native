import { useT } from "@agent-native/core/client/i18n";
import { IconDatabaseCog, IconRefresh } from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  CrmSettingsPanelHeader,
  crmSettingsPanelClassName,
  type CrmSettingsPanelProps,
} from "./SettingsPanelHeader";

/**
 * The irreversible-looking corner of CRM settings. It is deliberately thin:
 * CRM has no delete path. Archiving an attribute, an option, or a list keeps
 * every stored value, which is the one thing worth stating here.
 */
export function AdvancedSettings({ embedded }: CrmSettingsPanelProps = {}) {
  const t = useT();
  return (
    <div className={crmSettingsPanelClassName(embedded)}>
      <CrmSettingsPanelHeader
        embedded={embedded}
        title={t("advanced.title")}
        description={t("advanced.description")}
      />

      <div className={cn("mt-6 grid gap-3", embedded && "mt-0")}>
        <section className="flex flex-wrap items-center gap-4 rounded-lg border border-border/70 bg-card px-4 py-3.5">
          <IconRefresh className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("advanced.reconfigure")}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("advanced.reconfigureHelp")}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/setup">{t("advanced.openSetup")}</Link>
          </Button>
        </section>

        <section className="flex flex-wrap items-center gap-4 rounded-lg border border-border/70 bg-card px-4 py-3.5">
          <IconDatabaseCog className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("advanced.retention")}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("advanced.retentionHelp")}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
