import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { Button } from "@agent-native/toolkit/ui/button";
import { IconRefresh } from "@tabler/icons-react";
import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { CrmDashboardPanel } from "@/components/crm/CrmDashboardPanel";
import { PageHeader, SetupEmptyState } from "@/components/crm/Surface";
import { crmDashboardMetaTitle } from "@/i18n/en-US";
import type { CrmDashboard } from "@/lib/types";

export function meta() {
  return [{ title: crmDashboardMetaTitle }];
}

export default function DashboardRoute() {
  const t = useT();
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
      toast.success(t("dashboard.ready"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("dashboard.installFailed"),
      );
    }
  }

  if (dashboards.isLoading) {
    return (
      <PageHeader
        eyebrow="CRM"
        title={t("dashboard.pipeline")}
        description={t("dashboard.loadingDescription")}
      />
    );
  }

  if (!dashboard) {
    return (
      <>
        <PageHeader
          eyebrow="CRM"
          title={t("dashboard.pipeline")}
          description={t("dashboard.emptyDescription")}
        />
        <SetupEmptyState
          title={t("dashboard.installTitle")}
          description={t("dashboard.installDescription")}
          onSync={installDashboard}
          isSyncing={install.isPending}
          actionLabel={t("dashboard.installAction")}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="CRM"
        title={dashboard.title}
        description={t("dashboard.liveDescription")}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={installDashboard}
            disabled={install.isPending}
          >
            <IconRefresh className="size-4" />
            {install.isPending
              ? t("dashboard.updating")
              : t("dashboard.updatePack")}
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
