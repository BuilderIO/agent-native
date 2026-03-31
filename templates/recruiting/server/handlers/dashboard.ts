import { defineEventHandler } from "h3";
import { getSetting } from "@agent-native/core/settings";
import type {
  DashboardStats,
  GreenhouseJob,
  GreenhouseApplication,
  GreenhouseScheduledInterview,
} from "@shared/types";

const BASE_URL = "https://harvest.greenhouse.io/v1";

/** Lightweight single-page fetch for dashboard — avoids paginating entire dataset */
async function dashboardFetch<T>(
  path: string,
  params: Record<string, string> = {},
  perPage = 100,
): Promise<T[]> {
  const setting = await getSetting("greenhouse-api-key");
  if (!setting || typeof setting !== "object" || !("apiKey" in setting)) {
    throw new Error("Greenhouse API key not configured");
  }
  const apiKey = (setting as { apiKey: string }).apiKey;
  const encoded = Buffer.from(`${apiKey}:`).toString("base64");
  const qs = new URLSearchParams({
    ...params,
    per_page: String(perPage),
    page: "1",
  });
  const res = await fetch(`${BASE_URL}${path}?${qs}`, {
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Greenhouse API error ${res.status}: ${body}`);
  }
  return res.json();
}

export const getDashboardHandler = defineEventHandler(
  async (): Promise<DashboardStats> => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Fetch only what we need — single pages, no full pagination
    const [jobs, recentApps, interviews] = await Promise.all([
      dashboardFetch<GreenhouseJob>("/jobs", { status: "open" }),
      dashboardFetch<GreenhouseApplication>(
        "/applications",
        { created_after: weekAgo.toISOString() },
        100,
      ),
      dashboardFetch<GreenhouseScheduledInterview>(
        "/scheduled_interviews",
        {},
        50,
      ),
    ]);

    const upcomingInterviews = interviews.filter(
      (i) => new Date(i.start.date_time) > now,
    );

    const recentApplications = recentApps
      .sort(
        (a, b) =>
          new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime(),
      )
      .slice(0, 10);

    return {
      openJobs: jobs.length,
      activeCandidates: recentApps.length,
      upcomingInterviews: upcomingInterviews.length,
      recentApplications,
    };
  },
);
