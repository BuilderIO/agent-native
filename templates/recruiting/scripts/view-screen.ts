/**
 * See what the user is currently looking at on screen.
 *
 * Reads navigation state and fetches the matching candidate/job data via API.
 *
 * Usage:
 *   pnpm script view-screen
 */

import { parseArgs, output, localFetch } from "./helpers.js";
import { readAppState } from "@agent-native/core/application-state";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "See what the user is currently looking at on screen. Returns the current view, job/candidate details, and list data. Always call this first before taking any action.",
  parameters: {
    type: "object",
    properties: {},
  },
};

export async function run(): Promise<string> {
  const navigation = await readAppState("navigation");

  const screen: Record<string, unknown> = {};
  if (navigation) screen.navigation = navigation;

  const nav = (navigation || {}) as Record<string, any>;

  // Fetch contextual data based on current view
  if (nav.candidateId) {
    try {
      const candidate = await localFetch(`/api/candidates/${nav.candidateId}`);
      if (candidate) {
        screen.candidate = {
          id: (candidate as any).id,
          name: `${(candidate as any).first_name} ${(candidate as any).last_name}`,
          company: (candidate as any).company,
          title: (candidate as any).title,
          emails: (candidate as any).emails,
          tags: (candidate as any).tags,
          applications: ((candidate as any).applications || []).map(
            (a: any) => ({
              id: a.id,
              status: a.status,
              currentStage: a.current_stage?.name,
              jobs: a.jobs?.map((j: any) => j.name),
            }),
          ),
          lastActivity: (candidate as any).last_activity,
        };
      }
    } catch {
      // Candidate fetch failed, continue
    }
  }

  if (nav.jobId) {
    try {
      const job = await localFetch(`/api/jobs/${nav.jobId}`);
      if (job) {
        screen.job = {
          id: (job as any).id,
          name: (job as any).name,
          status: (job as any).status,
          departments: (job as any).departments?.map((d: any) => d.name),
          offices: (job as any).offices?.map((o: any) => o.name),
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
      const jobs = await localFetch<any[]>("/api/jobs?status=open");
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
      const candidates = await localFetch<any[]>("/api/candidates?limit=20");
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
      const interviews = await localFetch<any[]>("/api/interviews");
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
    return JSON.stringify({
      error: "No application state found. Is the app running?",
    });
  }
  return JSON.stringify(screen, null, 2);
}

export default async function main(): Promise<void> {
  const result = await run();

  try {
    const parsed = JSON.parse(result);
    const nav = parsed.navigation;

    console.error(
      `Current view: ${nav?.view ?? "unknown"}` +
        (nav?.candidateId ? ` (candidate: ${nav.candidateId})` : "") +
        (nav?.jobId ? ` (job: ${nav.jobId})` : ""),
    );
    output(parsed);
  } catch {
    console.log(result);
  }
}
