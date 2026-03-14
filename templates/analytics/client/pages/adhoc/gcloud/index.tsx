import { useState, useMemo } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { ServiceSelector } from "./ServiceSelector";
import { MetricsCharts } from "./MetricsCharts";
import { LogsPanel } from "./LogsPanel";
import { useGCloudMetrics, useGCloudServices } from "./hooks";
import type { TimePeriod, SelectedService } from "./types";

const TIME_OPTIONS: { label: string; value: TimePeriod }[] = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
];

const SA_EMAIL = "fusion-analytics@builder-3b0a2.iam.gserviceaccount.com";

const REQUIRED_ROLES = [
  { role: "roles/monitoring.viewer", purpose: "Read metrics" },
  { role: "roles/logging.viewer", purpose: "Read logs" },
  { role: "roles/run.viewer", purpose: "List Cloud Run services" },
  { role: "roles/cloudfunctions.viewer", purpose: "List Cloud Functions" },
];

export default function GCloudDashboard() {
  const [selected, setSelected] = useState<SelectedService | null>({
    name: "ai-codegen",
    type: "cloud_run",
  });
  const [period, setPeriod] = useState<TimePeriod>("24h");
  const [showSetup, setShowSetup] = useState(false);
  const queryClient = useQueryClient();

  const { data: servicesData } = useGCloudServices();
  const hasPermissionWarning = !!servicesData?.permissionWarning;

  const serviceName = selected?.name;
  const serviceType = selected?.type ?? "cloud_run";

  const requestMetric =
    serviceType === "cloud_function"
      ? "cloudfunctions.googleapis.com/function/execution_count"
      : "run.googleapis.com/request_count";
  const latencyMetric =
    serviceType === "cloud_function"
      ? "cloudfunctions.googleapis.com/function/execution_times"
      : "run.googleapis.com/request_latencies";
  const instanceMetric =
    serviceType === "cloud_function"
      ? "cloudfunctions.googleapis.com/function/active_instances"
      : "run.googleapis.com/container/instance_count";

  const { data: requestResp } = useGCloudMetrics(
    serviceName,
    requestMetric,
    period,
    serviceType,
  );
  const { data: latencyResp } = useGCloudMetrics(
    serviceName,
    latencyMetric,
    period,
    serviceType,
  );
  const { data: instanceResp } = useGCloudMetrics(
    serviceName,
    instanceMetric,
    period,
    serviceType,
  );

  const metricsBlocked = !!(
    requestResp?.permissionWarning ||
    latencyResp?.permissionWarning ||
    instanceResp?.permissionWarning
  );

  const requestData = requestResp?.timeSeries;
  const latencyData = latencyResp?.timeSeries;
  const instanceData = instanceResp?.timeSeries;

  const stats = useMemo(() => {
    const avgOf = (series: typeof requestData) => {
      if (!series?.length) return null;
      const points = series.flatMap((s) => s.points);
      if (!points.length) return null;
      return points.reduce((sum, p) => sum + p.value, 0) / points.length;
    };
    const maxOf = (series: typeof requestData) => {
      if (!series?.length) return null;
      const points = series.flatMap((s) => s.points);
      if (!points.length) return null;
      return Math.max(...points.map((p) => p.value));
    };
    const latestOf = (series: typeof requestData) => {
      if (!series?.length) return null;
      const points = series.flatMap((s) => s.points);
      if (!points.length) return null;
      return points[points.length - 1]?.value ?? null;
    };

    return {
      avgRequests: avgOf(requestData),
      avgLatency: avgOf(latencyData),
      maxInstances: maxOf(instanceData),
      currentInstances: latestOf(instanceData),
    };
  }, [requestData, latencyData, instanceData]);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["gcloud-metrics"] });
    queryClient.invalidateQueries({ queryKey: ["gcloud-logs"] });
    queryClient.invalidateQueries({ queryKey: ["gcloud-services"] });
  };

  return (
    <div className="space-y-6">
      <DashboardHeader description="Cloud Run and Cloud Functions metrics, health, and logs for the builder-3b0a2 project" />

      {/* Permission setup banner */}
      {(hasPermissionWarning || metricsBlocked) && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium text-amber-300">
                IAM permissions needed
              </h3>
              <p className="text-xs text-amber-300/70 mt-1">
                The service account needs additional roles to access Cloud
                Monitoring, Logging, and service listing APIs.
                {!showSetup && (
                  <button
                    onClick={() => setShowSetup(true)}
                    className="text-amber-300 underline ml-1"
                  >
                    Show setup commands
                  </button>
                )}
              </p>
              {showSetup && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Run these in your Google Cloud console:
                  </p>
                  <pre className="text-[11px] bg-black/40 rounded-md p-3 overflow-x-auto text-green-400 font-mono">
                    {REQUIRED_ROLES.map(
                      (r) =>
                        `gcloud projects add-iam-policy-binding builder-3b0a2 \\\n  --member="serviceAccount:${SA_EMAIL}" \\\n  --role="${r.role}"\n`,
                    ).join("\n")}
                  </pre>
                  <div className="text-[10px] text-muted-foreground mt-2 space-y-0.5">
                    {REQUIRED_ROLES.map((r) => (
                      <div key={r.role}>
                        <code className="text-amber-300/60">{r.role}</code> —{" "}
                        {r.purpose}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowSetup(false)}
                    className="text-xs text-muted-foreground hover:text-foreground mt-1"
                  >
                    Hide
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-md border border-border overflow-hidden">
            {TIME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            className="px-3 py-1.5 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          {selected && (
            <span className="text-xs text-muted-foreground">
              Viewing:{" "}
              <span className="text-foreground font-medium">
                {selected.name}
              </span>{" "}
              (
              {selected.type === "cloud_function"
                ? "Cloud Function"
                : "Cloud Run"}
              )
            </span>
          )}
        </div>
        <ServiceSelector selected={selected} onChange={setSelected} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Avg Request Rate"
          value={
            stats.avgRequests != null
              ? `${stats.avgRequests.toFixed(1)}/s`
              : "-"
          }
          hasData={!!serviceName}
        />
        <StatCard
          label="Avg Latency"
          value={
            stats.avgLatency != null
              ? stats.avgLatency >= 1000
                ? `${(stats.avgLatency / 1000).toFixed(1)}s`
                : `${stats.avgLatency.toFixed(0)}ms`
              : "-"
          }
          hasData={!!serviceName}
          variant={
            stats.avgLatency != null && stats.avgLatency > 2000
              ? "danger"
              : "default"
          }
        />
        <StatCard
          label="Max Instances"
          value={
            stats.maxInstances != null
              ? String(Math.round(stats.maxInstances))
              : "-"
          }
          hasData={!!serviceName}
        />
        <StatCard
          label="Current Instances"
          value={
            stats.currentInstances != null
              ? String(Math.round(stats.currentInstances))
              : "-"
          }
          hasData={!!serviceName}
        />
      </div>

      {/* Charts */}
      <MetricsCharts service={serviceName} period={period} type={serviceType} />

      {/* Logs */}
      <LogsPanel service={serviceName} period={period} type={serviceType} />
    </div>
  );
}

function StatCard({
  label,
  value,
  hasData,
  variant = "default",
}: {
  label: string;
  value: string;
  hasData: boolean;
  variant?: "default" | "danger";
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {!hasData ? (
        <div className="text-lg font-bold text-muted-foreground">-</div>
      ) : (
        <div
          className={`text-2xl font-bold ${variant === "danger" ? "text-red-400" : "text-foreground"}`}
        >
          {value}
        </div>
      )}
    </div>
  );
}
