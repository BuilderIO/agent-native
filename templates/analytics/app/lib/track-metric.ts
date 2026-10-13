import { appApiPath } from "@agent-native/core/client/api-path";
import { isSyntheticTrafficValue } from "@agent-native/core/shared";

import { getIdToken } from "./auth";

function isSyntheticBrowserTraffic(): boolean {
  return (
    typeof window !== "undefined" &&
    isSyntheticTrafficValue(
      (
        window as Window & {
          __AGENT_NATIVE_SYNTHETIC_TRAFFIC__?: unknown;
        }
      ).__AGENT_NATIVE_SYNTHETIC_TRAFFIC__,
    )
  );
}

export async function trackMetricViewed(
  metricName: string,
  dashboardId: string,
  queryUsed?: string,
): Promise<void> {
  if (isSyntheticBrowserTraffic()) return;
  try {
    const token = await getIdToken();
    const userId = token ? await getUserIdFromToken(token) : null;

    const eventData = {
      event: "metric viewed",
      data: JSON.stringify({
        metricName,
        dashboardId,
        queryUsed: queryUsed ? truncateQuery(queryUsed) : undefined,
      }),
      userId,
      timestamp: new Date().toISOString(),
    };

    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(eventData)], {
        type: "application/json",
      });
      navigator.sendBeacon(appApiPath("/api/events/track"), blob);
    } else {
      fetch(appApiPath("/api/events/track"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(eventData),
        // Don't await - fire and forget
      }).catch(() => {
        // Silently fail - tracking shouldn't break the app
      });
    }
  } catch (err) {
    console.debug("Metric tracking failed:", err);
  }
}

/**
 * Extract user ID from a Firebase ID token by decoding its JWT payload.
 * Returns null if the token can't be parsed.
 */
async function getUserIdFromToken(token: string): Promise<string | null> {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.user_id || payload.sub || null;
  } catch {
    return null;
  }
}

function truncateQuery(query: string): string {
  const trimmed = query.trim();
  return trimmed.length > 500 ? trimmed.slice(0, 500) + "..." : trimmed;
}

export function useTrackMetrics(metrics: string[], dashboardId: string): void {
  React.useEffect(() => {
    metrics.forEach((metricName) => {
      if (metricName && metricName.trim()) {
        void trackMetricViewed(metricName, dashboardId);
      }
    });
  }, [metrics.join(","), dashboardId]);
}

import React from "react";
