import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconRefresh } from "@tabler/icons-react";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { CrmDashboardPanel } from "@/components/crm/CrmDashboardPanel";
import { PageHeader, SetupEmptyState } from "@/components/crm/Surface";
import type { CrmDashboard } from "@/lib/types";

export function meta() {
  return [{ title: "Pipeline · CRM" }];
}

export default function DashboardRoute() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dashboards = useActionQuery<CrmDashboard[]>(
    "list-crm-dashboards" as never,
    {} as never,
  );
  const install = useActionMutation<
    { dashboardId: string },
    Record<string, never>
  >("install-crm-pipeline-dashboard" as never);
  const dashboard = useMemo(() => {
    const requested = searchParams.get("id");
    return (
      dashboards.data?.find((item) => item.id === requested) ??
      dashboards.data?.find((item) => item.kind === "pipeline")
    );
  }, [dashboards.data, searchParams]);

  async function installDashboard() {
    try {
      const result = await install.mutateAsync({});
      navigate(`/dashboard?id=${encodeURIComponent(result.dashboardId)}`, {
        replace: true,
      });
      toast.success("Pipeline dashboard is ready.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Pipeline dashboard could not be installed.",
      );
    }
  }

  if (dashboards.isLoading) {
    return (
      <PageHeader
        eyebrow="CRM"
        title="Pipeline"
        description="Loading your access-scoped pipeline dashboard…"
      />
    );
  }

  if (!dashboard) {
    return (
      <>
        <PageHeader
          eyebrow="CRM"
          title="Pipeline"
          description="A live, permission-aware view of opportunity value by stage."
        />
        <SetupEmptyState
          title="Install the Pipeline dashboard"
          description="It creates a CRM-owned data program and a private dashboard for your current workspace."
          onSync={installDashboard}
          isSyncing={install.isPending}
          actionLabel="Install Pipeline dashboard"
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title={dashboard.title}
        description="Live opportunity totals use the current viewer’s CRM access and refresh from a cached data program."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={installDashboard}
            disabled={install.isPending}
          >
            <IconRefresh className="size-4" />
            {install.isPending ? "Updating…" : "Update pack"}
          </Button>
        }
      />
      <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7 xl:grid-cols-3">
        {dashboard.config.panels.map((panel) => (
          <CrmDashboardPanel
            key={panel.id}
            dashboardId={dashboard.id}
            panel={panel}
          />
        ))}
      </div>
    </>
  );
}
