import { defineEventHandler } from "h3";
import { getSetting } from "@agent-native/core/settings";
import type {
  DashboardStats,
  GreenhouseJob,
  GreenhouseApplication,
  GreenhouseScheduledInterview,
  GreenhouseCandidate,
} from "@shared/types";

const BASE_URL = "https://harvest.greenhouse.io/v1";

function authHeaders(encoded: string) {
  return {
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/json",
  };
}

async function dashboardFetch<T>(
  encoded: string,
  path: string,
  params: Record<string, string> = {},
  perPage = 100,
): Promise<T[]> {
  const qs = new URLSearchParams({
    ...params,
    per_page: String(perPage),
    page: "1",
  });
  const res = await fetch(`${BASE_URL}${path}?${qs}`, {
    headers: authHeaders(encoded),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Greenhouse API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function fetchCandidate(
  encoded: string,
  id: number,
): Promise<GreenhouseCandidate> {
  const res = await fetch(`${BASE_URL}/candidates/${id}`, {
    headers: authHeaders(encoded),
  });
  if (!res.ok) throw new Error(`Failed to fetch candidate ${id}`);
  return res.json();
}

export const getDashboardHandler = defineEventHandler(
  async (): Promise<DashboardStats> => {
    const setting = await getSetting("greenhouse-api-key");
    if (!setting || typeof setting !== "object" || !("apiKey" in setting)) {
      throw new Error("Greenhouse API key not configured");
    }
    const encoded = Buffer.from(
      `${(setting as { apiKey: string }).apiKey}:`,
    ).toString("base64");

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const [jobs, recentApps, interviews] = await Promise.all([
      dashboardFetch<GreenhouseJob>(encoded, "/jobs", { status: "open" }),
      dashboardFetch<GreenhouseApplication>(
        encoded,
        "/applications",
        { created_after: weekAgo.toISOString() },
        100,
      ),
      dashboardFetch<GreenhouseScheduledInterview>(
        encoded,
        "/scheduled_interviews",
        { created_after: oneYearAgo.toISOString() },
        500,
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

    const uniqueCandidateIds = [
      ...new Set(recentApplications.map((a) => a.candidate_id)),
    ];
    const candidateResults = await Promise.allSettled(
      uniqueCandidateIds.map((id) => fetchCandidate(encoded, id)),
    );
    const candidateNames = new Map<number, string>();
    candidateResults.forEach((result) => {
      if (result.status === "fulfilled") {
        const c = result.value;
        candidateNames.set(c.id, `${c.first_name} ${c.last_name}`);
      }
    });

    const enrichedApplications = recentApplications.map((app) => ({
      ...app,
      candidate_name: candidateNames.get(app.candidate_id) ?? "Unknown",
    }));

    return {
      openJobs: jobs.length,
      activeCandidates: recentApps.length,
      upcomingInterviews: upcomingInterviews.length,
      recentApplications: enrichedApplications,
    };
  },
);
