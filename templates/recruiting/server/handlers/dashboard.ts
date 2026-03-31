import { defineEventHandler } from "h3";
import * as gh from "../lib/greenhouse-api.js";
import type { DashboardStats } from "@shared/types";

export const getDashboardHandler = defineEventHandler(
  async (): Promise<DashboardStats> => {
    const [jobs, applications, interviews] = await Promise.all([
      gh.listJobs({ status: "open" }),
      gh.listApplications({ status: "active" }),
      gh.listScheduledInterviews(),
    ]);

    // Count upcoming interviews (future only)
    const now = new Date();
    const upcomingInterviews = interviews.filter(
      (i) => new Date(i.start.date_time) > now,
    );

    // Recent applications (last 7 days)
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentApplications = applications
      .filter((a) => new Date(a.applied_at) > weekAgo)
      .sort(
        (a, b) =>
          new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime(),
      )
      .slice(0, 10);

    return {
      openJobs: jobs.length,
      activeCandidates: applications.length,
      upcomingInterviews: upcomingInterviews.length,
      recentApplications,
    };
  },
);
