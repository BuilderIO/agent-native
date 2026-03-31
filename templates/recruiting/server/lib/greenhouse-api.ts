import { getSetting } from "@agent-native/core/settings";
import type {
  GreenhouseJob,
  GreenhouseCandidate,
  GreenhouseApplication,
  GreenhouseJobStage,
  GreenhouseScheduledInterview,
  GreenhouseScorecard,
  GreenhouseDepartment,
  GreenhouseOffice,
} from "@shared/types";

const BASE_URL = "https://harvest.greenhouse.io/v1";

export async function getApiKey(): Promise<string | null> {
  const setting = await getSetting("greenhouse-api-key");
  if (setting && typeof setting === "object" && "apiKey" in setting) {
    return (setting as { apiKey: string }).apiKey;
  }
  return null;
}

async function greenhouseFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Greenhouse API key not configured");

  const encoded = Buffer.from(`${apiKey}:`).toString("base64");
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Greenhouse API error ${res.status}: ${res.statusText} — ${body}`,
    );
  }

  return res.json();
}

async function greenhouseFetchAll<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const qs = new URLSearchParams({
      ...params,
      per_page: String(perPage),
      page: String(page),
    });
    const items = await greenhouseFetch<T[]>(`${path}?${qs}`);
    all.push(...items);
    if (items.length < perPage) break;
    page++;
  }

  return all;
}

/** Fetch a single page (no auto-pagination). Good for dashboards/previews. */
async function greenhouseFetchPage<T>(
  path: string,
  params: Record<string, string> = {},
  perPage = 100,
  page = 1,
): Promise<T[]> {
  const qs = new URLSearchParams({
    ...params,
    per_page: String(perPage),
    page: String(page),
  });
  return greenhouseFetch<T[]>(`${path}?${qs}`);
}

// --- Jobs ---

export async function listJobs(
  params: { status?: string; per_page?: number; page?: number } = {},
): Promise<GreenhouseJob[]> {
  const qs: Record<string, string> = {};
  if (params.status) qs.status = params.status;
  if (params.per_page) {
    qs.per_page = String(params.per_page);
    qs.page = String(params.page || 1);
    return greenhouseFetch<GreenhouseJob[]>(`/jobs?${new URLSearchParams(qs)}`);
  }
  return greenhouseFetchAll<GreenhouseJob>("/jobs", qs);
}

export async function getJob(id: number): Promise<GreenhouseJob> {
  return greenhouseFetch<GreenhouseJob>(`/jobs/${id}`);
}

export async function getJobStages(
  jobId: number,
): Promise<GreenhouseJobStage[]> {
  return greenhouseFetch<GreenhouseJobStage[]>(
    `/jobs/${jobId}/stages?per_page=500`,
  );
}

// --- Candidates ---

export async function listCandidates(
  params: {
    job_id?: number;
    updated_after?: string;
    created_after?: string;
    per_page?: number;
    page?: number;
  } = {},
): Promise<GreenhouseCandidate[]> {
  const qs: Record<string, string> = {};
  if (params.job_id) qs.job_id = String(params.job_id);
  if (params.updated_after) qs.updated_after = params.updated_after;
  if (params.created_after) qs.created_after = params.created_after;
  if (params.per_page) {
    qs.per_page = String(params.per_page);
    qs.page = String(params.page || 1);
    return greenhouseFetch<GreenhouseCandidate[]>(
      `/candidates?${new URLSearchParams(qs)}`,
    );
  }
  return greenhouseFetchAll<GreenhouseCandidate>("/candidates", qs);
}

export async function getCandidate(id: number): Promise<GreenhouseCandidate> {
  return greenhouseFetch<GreenhouseCandidate>(`/candidates/${id}`);
}

// --- Applications ---

export async function listApplications(
  params: {
    job_id?: number;
    status?: string;
    created_after?: string;
  } = {},
): Promise<GreenhouseApplication[]> {
  const qs: Record<string, string> = {};
  if (params.job_id) qs.job_id = String(params.job_id);
  if (params.status) qs.status = params.status;
  if (params.created_after) qs.created_after = params.created_after;
  return greenhouseFetchAll<GreenhouseApplication>("/applications", qs);
}

export async function getApplication(
  id: number,
): Promise<GreenhouseApplication> {
  return greenhouseFetch<GreenhouseApplication>(`/applications/${id}`);
}

export async function advanceApplication(
  applicationId: number,
  fromStageId: number,
): Promise<void> {
  await greenhouseFetch(`/applications/${applicationId}/advance`, {
    method: "POST",
    body: JSON.stringify({ from_stage_id: fromStageId }),
  });
}

export async function moveApplication(
  applicationId: number,
  fromStageId: number,
  toStageId: number,
): Promise<void> {
  await greenhouseFetch(`/applications/${applicationId}/move`, {
    method: "POST",
    body: JSON.stringify({
      from_stage_id: fromStageId,
      to_stage_id: toStageId,
    }),
  });
}

export async function rejectApplication(
  applicationId: number,
  rejectionReasonId?: number,
  notes?: string,
): Promise<void> {
  const body: Record<string, any> = {};
  if (rejectionReasonId) body.rejection_reason_id = rejectionReasonId;
  if (notes) body.notes = notes;
  await greenhouseFetch(`/applications/${applicationId}/reject`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// --- Create ---

export async function createCandidate(data: {
  first_name: string;
  last_name: string;
  emails?: { value: string; type: string }[];
  phone_numbers?: { value: string; type: string }[];
  applications?: { job_id: number }[];
}): Promise<GreenhouseCandidate> {
  return greenhouseFetch<GreenhouseCandidate>("/candidates", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// --- Interviews ---

export async function listScheduledInterviews(
  params: { application_id?: number; created_after?: string } = {},
): Promise<GreenhouseScheduledInterview[]> {
  const qs: Record<string, string> = {};
  if (params.application_id) qs.application_id = String(params.application_id);
  if (params.created_after) qs.created_after = params.created_after;
  return greenhouseFetchAll<GreenhouseScheduledInterview>(
    "/scheduled_interviews",
    qs,
  );
}

// --- Scorecards ---

export async function listScorecards(
  applicationId: number,
): Promise<GreenhouseScorecard[]> {
  return greenhouseFetch<GreenhouseScorecard[]>(
    `/applications/${applicationId}/scorecards?per_page=500`,
  );
}

// --- Organization ---

export async function listDepartments(): Promise<GreenhouseDepartment[]> {
  return greenhouseFetchAll<GreenhouseDepartment>("/departments");
}

export async function listOffices(): Promise<GreenhouseOffice[]> {
  return greenhouseFetchAll<GreenhouseOffice>("/offices");
}

// --- Validation ---

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const encoded = Buffer.from(`${apiKey}:`).toString("base64");
    const res = await fetch(`${BASE_URL}/jobs?per_page=1`, {
      headers: {
        Authorization: `Basic ${encoded}`,
        "Content-Type": "application/json",
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}
