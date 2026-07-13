import {
  agentNativePath,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { IconCheck, IconCopy, IconPlugConnected } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ActionQueryError } from "../../components/action-query-error";
import {
  AgentsPanel,
  type ConnectedAgent,
} from "../../components/agents-panel";
import { DispatchShell } from "../../components/dispatch-shell";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Switch } from "../../components/ui/switch";

export function meta() {
  return [{ title: "Agents — Dispatch" }];
}

interface McpAccessApp {
  id: string;
  name: string;
  description: string;
  url: string;
  color: string;
  granted: boolean;
}

type McpAccessMode = "all-apps" | "selected-apps";

interface McpAccessState {
  mode: McpAccessMode;
  selectedAppIds: string[];
}

function dispatchMcpUrl(): string {
  const path = agentNativePath("/_agent-native/mcp");
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).href;
}

function DispatchMcpAccessPanel() {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useActionQuery(
    "list-mcp-app-access",
    {},
  );
  const [optimistic, setOptimistic] = useState<McpAccessState | null>(null);
  const saveAccess = useActionMutation("set-mcp-app-access", {
    onSuccess: () => {
      setOptimistic(null);
      toast.success(t("dispatch.pages.mcpAccessUpdated"));
    },
    onError: (error) => {
      setOptimistic(null);
      toast.error(error.message);
    },
  });

  const apps = ((data as { apps?: McpAccessApp[] } | undefined)?.apps ??
    []) as McpAccessApp[];
  const access =
    optimistic ??
    ({
      mode: ((data as { mode?: McpAccessMode } | undefined)?.mode ??
        "all-apps") as McpAccessMode,
      selectedAppIds:
        (data as { selectedAppIds?: string[] } | undefined)?.selectedAppIds ??
        [],
    } satisfies McpAccessState);
  const selected = useMemo(
    () => new Set(access.selectedAppIds),
    [access.selectedAppIds],
  );
  const grantedCount =
    access.mode === "all-apps" ? apps.length : access.selectedAppIds.length;
  const mcpUrl = dispatchMcpUrl();

  function persist(next: McpAccessState) {
    setOptimistic(next);
    saveAccess.mutate(next);
  }

  function toggleApp(appId: string) {
    const next = selected.has(appId)
      ? access.selectedAppIds.filter((id) => id !== appId)
      : [...access.selectedAppIds, appId];
    persist({ mode: "selected-apps", selectedAppIds: next });
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      toast.success(t("dispatch.pages.mcpUrlCopied"));
    } catch {
      toast.error(t("dispatch.pages.mcpUrlCopyFailed"));
    }
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <IconPlugConnected size={16} />
            {t("dispatch.pages.unifiedMcpGateway")}
          </div>
          <div className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("dispatch.pages.unifiedMcpGatewayDescription")}{" "}
            <code>list_apps</code>, <code>ask_app</code>, and{" "}
            <code>open_app</code>.
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
          <div>
            <div className="text-xs font-medium text-foreground">
              {access.mode === "all-apps"
                ? t("dispatch.pages.allApps")
                : t("dispatch.pages.selectedApps")}
            </div>
            <div className="text-xs text-muted-foreground">
              {isLoading
                ? t("dispatch.pages.loading")
                : t("dispatch.pages.grantedCount", { count: grantedCount })}
            </div>
          </div>
          <Switch
            checked={access.mode === "all-apps"}
            disabled={saveAccess.isPending || apps.length === 0}
            onCheckedChange={(checked) =>
              persist({
                mode: checked ? "all-apps" : "selected-apps",
                selectedAppIds: checked
                  ? access.selectedAppIds
                  : apps.map((app) => app.id),
              })
            }
            aria-label={t("dispatch.pages.exposeAllAppsMcp")}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={mcpUrl} className="font-mono text-xs" />
        <Button type="button" variant="outline" onClick={copyUrl}>
          <IconCopy size={15} />
          {t("dispatch.pages.copyUrl")}
        </Button>
      </div>

      {isError ? (
        <ActionQueryError
          className="mt-4"
          error={error}
          onRetry={() => void refetch()}
        />
      ) : access.mode === "selected-apps" ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {apps.map((app) => {
            const isSelected = selected.has(app.id);
            return (
              <button
                key={app.id}
                type="button"
                disabled={
                  saveAccess.isPending &&
                  optimistic?.selectedAppIds.includes(app.id) !== isSelected
                }
                onClick={() => toggleApp(app.id)}
                className="flex min-h-[76px] items-start gap-3 rounded-xl border bg-muted/20 px-3 py-3 text-left transition hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
                aria-pressed={isSelected}
              >
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                  style={{ backgroundColor: app.color }}
                >
                  {app.name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {app.name}
                    {isSelected ? (
                      <IconCheck size={14} className="text-emerald-500" />
                    ) : null}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                    {app.description || app.url}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export default function AgentsRoute() {
  const t = useT();
  const agentsQuery = useActionQuery("list-connected-agents", {});

  return (
    <DispatchShell
      title={t("dispatch.nav.agents")}
      description={t("dispatch.pages.agentsDescription")}
    >
      <div className="space-y-4">
        <DispatchMcpAccessPanel />
        {agentsQuery.isError ? (
          <ActionQueryError
            error={agentsQuery.error}
            onRetry={() => void agentsQuery.refetch()}
          />
        ) : (
          <AgentsPanel
            agents={(agentsQuery.data || []) as ConnectedAgent[]}
            onRefresh={agentsQuery.refetch}
          />
        )}
      </div>
    </DispatchShell>
  );
}
