import { ObservabilityDashboard, useT } from "@agent-native/core/client";
import { DbAdminPage } from "@agent-native/core/client/db-admin";
import {
  IconActivity,
  IconChevronDown,
  IconDatabase,
} from "@tabler/icons-react";
import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type AgentAdminView = "monitoring" | "database";

const AGENT_ADMIN_VIEWS: AgentAdminView[] = ["monitoring", "database"];

function parseView(value: string | null): AgentAdminView {
  return AGENT_ADMIN_VIEWS.includes(value as AgentAdminView)
    ? (value as AgentAdminView)
    : "monitoring";
}

export default function AgentsPage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));

  function setView(next: AgentAdminView) {
    const params = new URLSearchParams(searchParams);
    if (next === "monitoring") {
      params.delete("view");
    } else {
      params.set("view", next);
    }
    setSearchParams(params, { replace: true });
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-5 px-4 py-5 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold">{t("agents.title")}</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {t("agents.description")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/catalog">{t("agents.openCatalog")}</Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                {t("agents.advanced")}
                <IconChevronDown className="ms-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{t("agents.advanced")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setView("database")}>
                <IconDatabase className="me-2 h-4 w-4" />
                {t("agents.database")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <button
          type="button"
          onClick={() => setView("monitoring")}
          className={cn(
            "inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
            view === "monitoring"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <IconActivity className="h-4 w-4" />
          {t("agents.monitoring")}
        </button>
        {view === "database" && (
          <button
            type="button"
            onClick={() => setView("database")}
            className="inline-flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-sm font-medium text-background"
          >
            <IconDatabase className="h-4 w-4" />
            {t("agents.database")}
          </button>
        )}
      </div>

      {view === "database" ? (
        <div className="min-h-[560px] flex-1 overflow-hidden rounded-lg border bg-background">
          <DbAdminPage />
        </div>
      ) : (
        <div className="min-w-0">
          <div className="mb-4 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("agents.monitoringDescription")}
          </div>
          <ObservabilityDashboard />
        </div>
      )}
    </div>
  );
}
