import {
  buildAuthHeader,
  flattenMatrix,
  flattenVector,
  parsePanelDescriptor,
  resolveRangeWindow,
  serializePanelDescriptorInput,
  type PanelDescriptor,
} from "./prometheus";

export type DemoDescriptor = PanelDescriptor;

export interface DemoPrometheusConfig {
  url: string;
  username?: string;
  password?: string;
  bearer?: string;
}

export const DEMO_PROMETHEUS_ENV = {
  url: "ANALYTICS_DEMO_PROMETHEUS_URL",
  username: "ANALYTICS_DEMO_PROMETHEUS_USERNAME",
  password: "ANALYTICS_DEMO_PROMETHEUS_PASSWORD",
  bearer: "ANALYTICS_DEMO_PROMETHEUS_BEARER_TOKEN",
} as const;

export function serializeDemoDescriptorInput(raw: unknown): string {
  return serializePanelDescriptorInput(raw);
}

export function parseDemoDescriptor(raw: string): DemoDescriptor {
  try {
    return parsePanelDescriptor(raw);
  } catch (err: any) {
    throw new Error(
      String(err?.message ?? err).replace(
        /^prometheus panel sql/,
        "demo Prometheus panel sql",
      ),
    );
  }
}

export function resolveDemoPrometheusConfig(
  env: Record<string, string | undefined> = process.env,
): DemoPrometheusConfig {
  const url = env[DEMO_PROMETHEUS_ENV.url]?.trim().replace(/\/+$/, "");
  if (!url) {
    throw new Error(`${DEMO_PROMETHEUS_ENV.url} not configured`);
  }
  return {
    url,
    username: env[DEMO_PROMETHEUS_ENV.username]?.trim() || undefined,
    password: env[DEMO_PROMETHEUS_ENV.password] || undefined,
    bearer: env[DEMO_PROMETHEUS_ENV.bearer] || undefined,
  };
}

async function demoPrometheusGet<T>(
  config: DemoPrometheusConfig,
  path: string,
  params: Record<string, string | undefined>,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const authHeader = buildAuthHeader(config);
  if (authHeader) headers.Authorization = authHeader;

  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") qs.set(key, value);
  }

  const res = await fetch(`${config.url}${path}?${qs.toString()}`, {
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Demo Prometheus API error ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  const body = (await res.json()) as {
    status?: string;
    data?: unknown;
    error?: string;
  };
  if (body?.status !== "success") {
    throw new Error(
      `Demo Prometheus query failed: ${body?.error ?? "unknown error"}`,
    );
  }
  return body.data as T;
}

export async function runDemoPanelWithConfig(
  raw: string,
  config: DemoPrometheusConfig,
) {
  const descriptor = parseDemoDescriptor(raw);
  if (descriptor.mode === "instant") {
    const data = await demoPrometheusGet<{
      resultType: string;
      result: unknown;
    }>(config, "/api/v1/query", {
      query: descriptor.promql,
      time: descriptor.endTime,
    });
    return flattenVector(data);
  }

  const { startSec, endSec, stepSec } = resolveRangeWindow(descriptor);
  const data = await demoPrometheusGet<{
    resultType: string;
    result: unknown;
  }>(config, "/api/v1/query_range", {
    query: descriptor.promql,
    start: String(startSec),
    end: String(endSec),
    step: String(stepSec),
  });
  return flattenMatrix(data);
}

export async function runDemoPanel(raw: string) {
  return runDemoPanelWithConfig(raw, resolveDemoPrometheusConfig());
}
