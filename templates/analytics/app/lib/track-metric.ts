import { getIdToken } from "./auth";
import { appApiPath } from "@agent-native/core/client";

/**
 * Track when a metric is viewed in a dashboard.
 * Emits a "metric viewed" event to BigQuery for discovery purposes.
 *
 * @param metricName - The name of the metric being viewed
 * @param dashboardId - The ID of the dashboard displaying the metric
 * @param queryUsed - Optional SQL query used to calculate the metric
 */
export async function trackMetricViewed(
  metricName: string,
  dashboardId: string,
  queryUsed?: string,
): Promise<void> {
  try {
    const token = await getIdToken();
    const userId = token ? await getUserIdFromToken(token) : null;

    // Send event to BigQuery via the existing event logging system
    // For now, we'll use a simple beacon to avoid blocking the UI
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

    // Use sendBeacon if available for non-blocking fire-and-forget
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(eventData)], {
        type: "application/json",
      });
      navigator.sendBeacon(appApiPath("/api/events/track"), blob);
    } else {
      // Fallback to fetch with no-cors if sendBeacon not available
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
    // Silently fail - tracking shouldn't break the app
    console.debug("Metric tracking failed:", err);
  }
}

/**
 * Extract user ID from a Firebase ID token.
 * For now, returns null - will be implemented when we have user auth.
 */
async function getUserIdFromToken(token: string): Promise<string | null> {
  try {
    // Parse JWT to get user ID
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.user_id || payload.sub || null;
  } catch {
    return null;
  }
}

/**
 * Truncate SQL query to first 500 characters to avoid bloating event data.
 */
function truncateQuery(query: string): string {
  const trimmed = query.trim();
  return trimmed.length > 500 ? trimmed.slice(0, 500) + "..." : trimmed;
}

/**
 * React hook to track metric views automatically.
 * Call this in dashboard components to emit tracking events.
 *
 * @param metrics - Array of metric names displayed in the dashboard
 * @param dashboardId - The ID of the current dashboard
 */
export function useTrackMetrics(metrics: string[], dashboardId: string): void {
  // Track on mount and when metrics change
  React.useEffect(() => {
    metrics.forEach((metricName) => {
      if (metricName && metricName.trim()) {
        trackMetricViewed(metricName, dashboardId);
      }
    });
  }, [metrics.join(","), dashboardId]);
}

// Import React for the hook
import React from "react";
