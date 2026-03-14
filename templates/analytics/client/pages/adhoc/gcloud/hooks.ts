import { useQuery } from "@tanstack/react-query";
import { getIdToken } from "@/lib/auth";
import type {
  CloudRunService,
  CloudFunction,
  MetricTimeSeries,
  LogEntry,
  TimePeriod,
  ServiceType,
} from "./types";

async function apiFetch<T>(path: string): Promise<T> {
  const token = await getIdToken();
  const res = await fetch(path, {
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export interface ServicesResponse {
  cloudRun: CloudRunService[];
  cloudFunctions: CloudFunction[];
  permissionWarning?: string;
}

export function useGCloudServices() {
  return useQuery<ServicesResponse>({
    queryKey: ["gcloud-services"],
    queryFn: () =>
      apiFetch<ServicesResponse>("/api/gcloud/services"),
    staleTime: 10 * 60 * 1000,
  });
}

export interface MetricsResponse {
  timeSeries: MetricTimeSeries[];
  permissionWarning?: string;
}

export function useGCloudMetrics(
  service: string | undefined,
  metric: string,
  period: TimePeriod,
  type: ServiceType = "cloud_run",
  extraFilter?: string
) {
  return useQuery<MetricsResponse>({
    queryKey: ["gcloud-metrics", service, metric, period, type, extraFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        service: service!,
        metric,
        period,
        type,
      });
      if (extraFilter) params.set("extraFilter", extraFilter);
      return apiFetch<MetricsResponse>(
        `/api/gcloud/metrics?${params.toString()}`
      );
    },
    enabled: !!service,
    staleTime: 2 * 60 * 1000,
  });
}

export function useGCloudLogs(
  service: string | undefined,
  severity: string | undefined,
  limit: number,
  type: ServiceType = "cloud_run"
) {
  return useQuery<LogEntry[]>({
    queryKey: ["gcloud-logs", service, severity, limit, type],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (service) params.set("service", service);
      if (severity) params.set("severity", severity);
      params.set("limit", String(limit));
      params.set("type", type);
      const data = await apiFetch<{ entries: LogEntry[] }>(
        `/api/gcloud/logs?${params.toString()}`
      );
      return data.entries;
    },
    enabled: !!service,
    staleTime: 60 * 1000,
  });
}
