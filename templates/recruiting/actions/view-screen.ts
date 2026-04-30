import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { readAppState } from "@agent-native/core/application-state";
import * as gh from "../server/lib/greenhouse-api.js";
import { withCredentialContext } from "../server/lib/greenhouse-api.js";

async function fetchScreen() {
  const navigation = await readAppState("navigation");
  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  const nav = (navigation || {}) as Record<string, any>;

  if (nav.candidateId) {
    try {
      const candidate = await gh.getCandidate(Number(nav.candidateId));
      if (candidate) {
        screen.candidate = {
          id: candidate.id,
          name: `${candidate.first_name} ${candidate.last_name}`,
          company: candidate.company,
          title: candidate.title,
          emails: candidate.emails,
          tags: candidate.tags,
          applications: (candidate.applications || []).map((a: any) => ({
            id: a.id,
            status: a.status,
            currentStage: a.current_stage?.name,
            jobs: a.jobs?.map((j: any) => j.name),
          })),
          lastActivity: candidate.last_activity,
        };
      }
    } catch {
      // Candidate fetch failed, continue
    }
  }

  if (nav.jobId) {
    try {
      const job = await gh.getJob(Number(nav.jobId));
      if (job) {
        screen.job = {
          id: job.id,
          name: job.name,
          status: job.status,
          departments: job.departments?.map((d: any) => d.name),
          offices: job.offices?.map((o: any) => o.name),
        };
      }
    } catch {
      // Job fetch failed, continue
    }
  }

  if (
    nav.view === "jobs" ||
    nav.view === "dashboard" ||
    (!nav.candidateId && !nav.jobId)
  ) {
    try {
      const jobs = await gh.listJobs({ status: "open" });
      if (jobs && Array.isArray(jobs)) {
        screen.jobsList = {
          count: jobs.length,
          jobs: jobs.slice(0, 20).map((j: any) => ({
            id: j.id,
            name: j.name,
            status: j.status,
            departments: j.departments?.map((d: any) => d.name),
          })),
        };
      }
    } catch {
      // Jobs list fetch failed, continue
    }
  }

  if (nav.view === "candidates") {
    try {
      const candidates = await gh.listCandidates({
        updated_after: new Date(
          Date.now() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        per_page: 20,
        page: 1,
      });
      if (candidates && Array.isArray(candidates)) {
        screen.candidatesList = {
          count: candidates.length,
          candidates: candidates.map((c: any) => ({
            id: c.id,
            name: `${c.first_name} ${c.last_name}`,
            company: c.company,
            title: c.title,
            lastActivity: c.last_activity,
          })),
        };
      }
    } catch {
      // Candidates fetch failed, continue
    }
  }

  if (nav.view === "interviews") {
    try {
      const interviews = await gh.listScheduledInterviews({
        created_after: new Date(
          Date.now() - 365 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      });
      if (interviews && Array.isArray(interviews)) {
        screen.interviewsList = {
          count: interviews.length,
          interviews: interviews.slice(0, 20).map((i: any) => ({
            id: i.id,
            applicationId: i.application_id,
            start: i.start?.date_time,
            end: i.end?.date_time,
            location: i.location,
            status: i.status,
            interviewers: i.interviewers?.map((iv: any) => iv.name),
          })),
        };
      }
    } catch {
      // Interviews fetch failed, continue
    }
  }

  if (Object.keys(screen).length === 0) {
    return {
      message: "No application state found. The UI may not be open.",
      hint: "Open the recruiting app in a browser so navigation state can be written before calling view-screen.",
    };
  }
  return screen;
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current view, job/candidate details, and list data. Always call this first before taking any action.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const orgId = getRequestOrgId() ?? null;
    const email = getRequestUserEmail() ?? null;
    return withCredentialContext({ email, orgId }, fetchScreen);
  },
});
