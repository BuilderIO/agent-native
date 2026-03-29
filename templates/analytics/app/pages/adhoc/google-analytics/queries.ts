import { getIdToken } from "@/lib/auth";

export interface GA4Row {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
}

export interface GA4ReportResponse {
  dimensionHeaders: { name: string }[];
  metricHeaders: { name: string; type: string }[];
  rows: GA4Row[];
  rowCount: number;
  error?: string;
}

export async function fetchGA4Report(params: {
  metrics: string[];
  dimensions: string[];
  days: number;
}): Promise<GA4ReportResponse> {
  const token = await getIdToken();
  const startDate = `${params.days}daysAgo`;
  const endDate = "today";

  const res = await fetch("/api/ga4/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({
      metrics: params.metrics,
      dimensions: params.dimensions,
      startDate,
      endDate,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA4 report failed (${res.status}): ${text}`);
  }

  return res.json();
}
