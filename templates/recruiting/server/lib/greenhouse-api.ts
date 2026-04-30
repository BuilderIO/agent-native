import { AsyncLocalStorage } from "node:async_hooks";
import { getSetting } from "@agent-native/core/settings";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
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

/**
 * AsyncLocalStorage to thread the caller's identity (email + optional orgId)
 * through Greenhouse API calls so the Greenhouse API key is looked up under
 * the correct per-user / per-org settings prefix.
 *
 * SECURITY: The unprefixed `greenhouse-api-key` setting must NEVER be read
 * — every Neon deployment is shared across solo users, so an unscoped read
 * would leak whichever user wrote it last to every other user.
 */
const credentialContextStore = new AsyncLocalStorage<{
  email: string | null;
  orgId: string | null;
}>();

/**
 * Run a function with the caller's credential context (email + optional
 * orgId) so that Greenhouse API calls look up the API key from
 * `o:<orgId>:greenhouse-api-key` (when an org is active) or
 * `u:<email>:greenhouse-api-key` (solo user).
 */
export function withCredentialContext<T>(
  ctx: { email: string | null; orgId: string | null },
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return credentialContextStore.run({ email: ctx.email, orgId: ctx.orgId }, fn);
}

/**
 * Build the per-user / per-org settings key for the Greenhouse API key.
 * Throws when the caller has no authenticated identity to scope to —
 * silently falling back to a global key would leak credentials between
 * solo users on the same database.
 */
function settingsKey(): string {
  const ctx = credentialContextStore.getStore();
  // Fall back to the active request context when no explicit
  // withCredentialContext wrapper is in place (covers actions auto-mounted
  // by the framework).
  const orgId = ctx?.orgId ?? getRequestOrgId() ?? null;
  const email = ctx?.email ?? getRequestUserEmail() ?? null;

  if (orgId) return `o:${orgId}:greenhouse-api-key`;
  if (email) return `u:${email.toLowerCase()}:greenhouse-api-key`;

  throw new Error(
    "Greenhouse API key lookup requires an authenticated user (no orgId or email in context).",
  );
}

export async function getApiKey(): Promise<string | null> {
  const setting = await getSetting(settingsKey());
  if (setting && typeof setting === "object" && "apiKey" in setting) {
    return (setting as { apiKey: string }).apiKey;
  }
  // No fall-back to an unprefixed global key — that's the leak we're
  // fixing. If the user previously stored their key under the global
  // key they need to re-enter it via Settings on first access after this
  // fix; otherwise we'd let one user's key be served to a different user.
  return null;
}

async function greenhouseFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("Greenhouse API key not configured");

  const encoded = Buffer.from(`${apiKey}:`).toString("base64");
  const mergedOptions: RequestInit = {
    ...options,
    headers: {
      Authorization: `Basic ${encoded}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  };

  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${BASE_URL}${path}`, mergedOptions);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "1", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    break;
  }
  if (!res) throw new Error("Greenhouse rate limit: max retries exceeded");

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
    per_page?: number;
  } = {},
): Promise<GreenhouseApplication[]> {
  const qs: Record<string, string> = {};
  if (params.job_id) qs.job_id = String(params.job_id);
  if (params.status) qs.status = params.status;
  if (params.created_after) qs.created_after = params.created_after;
  // When per_page is specified, fetch only a single page (fast for pipeline views)
  if (params.per_page) {
    return greenhouseFetchPage<GreenhouseApplication>(
      "/applications",
      qs,
      params.per_page,
    );
  }
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
