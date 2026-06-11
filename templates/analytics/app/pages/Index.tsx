import { useEffect } from "react";
import { useNavigate } from "react-router";
import { callAction } from "@agent-native/core/client";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboards } from "@/pages/adhoc/registry";
import { getLastOpenedPath } from "@/lib/last-opened";

type EnsureDemoDashboardsResult = {
  defaultDashboardPath?: string;
};

function isSyntheticDefaultDashboardPath(path: string): boolean {
  return (
    path === "/adhoc/default" &&
    !dashboards.some((dashboard) => dashboard.id === "default")
  );
}

function isSyntheticDefaultDashboardId(id: string): boolean {
  return (
    id === "default" &&
    !dashboards.some((dashboard) => dashboard.id === "default")
  );
}

export default function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const installAndOpenDemoDashboards = async () => {
      try {
        const result = (await callAction("ensure-demo-dashboards", {})) as
          | EnsureDemoDashboardsResult
          | undefined;
        if (cancelled) return;
        if (result?.defaultDashboardPath) {
          navigate(result.defaultDashboardPath, { replace: true });
        } else {
          navigate("/data-sources", { replace: true });
        }
      } catch (err) {
        console.warn("[analytics] demo dashboard install failed", err);
        if (!cancelled) navigate("/data-sources", { replace: true });
      }
    };

    const lastPath = getLastOpenedPath();
    if (lastPath && !isSyntheticDefaultDashboardPath(lastPath)) {
      navigate(lastPath, { replace: true });
      return () => {
        cancelled = true;
      };
    }
    const lastId = localStorage.getItem("last-dashboard-id");
    if (lastId && !isSyntheticDefaultDashboardId(lastId)) {
      navigate(`/adhoc/${lastId}`, { replace: true });
    } else if (dashboards.length > 0) {
      navigate(`/adhoc/${dashboards[0].id}`, { replace: true });
    } else {
      void installAndOpenDemoDashboards();
    }

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[300px] w-full rounded-xl" />
    </div>
  );
}
