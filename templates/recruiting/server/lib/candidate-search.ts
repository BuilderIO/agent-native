import type { GreenhouseCandidate } from "@shared/types";
import { listCandidates as listGreenhouseCandidates } from "./greenhouse-api.js";

const DEFAULT_RECENT_LOOKBACK_DAYS = 30;
const SEARCH_LOOKBACK_DAYS = 365 * 5;
const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 10;

export function getCandidateDisplayName(
  candidate: GreenhouseCandidate,
): string {
  const name = [candidate.first_name, candidate.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || `Candidate ${candidate.id}`;
}

export function getCandidateSubtitle(candidate: GreenhouseCandidate): string {
  const stageName =
    candidate.applications.find((application) => application.current_stage)
      ?.current_stage?.name ?? null;
  const primaryEmail = candidate.emails?.[0]?.value ?? null;
  const headline =
    candidate.title && candidate.company
      ? `${candidate.title} at ${candidate.company}`
      : candidate.title || candidate.company;

  return [headline, stageName ? `Stage: ${stageName}` : null, primaryEmail]
    .filter(Boolean)
    .join(" • ");
}

export function mapCandidateListItem(candidate: GreenhouseCandidate) {
  return {
    id: candidate.id,
    first_name: candidate.first_name,
    last_name: candidate.last_name,
    title: candidate.title,
    company: candidate.company,
    emails: (candidate.emails || []).slice(0, 1),
    tags: candidate.tags || [],
    last_activity: candidate.last_activity,
    applications: (candidate.applications || []).map((application) => ({
      id: application.id,
      status: application.status,
      current_stage: application.current_stage,
      jobs: application.jobs,
    })),
  };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function getCandidateActivityTs(candidate: GreenhouseCandidate): number {
  if (candidate.last_activity) {
    return new Date(candidate.last_activity).getTime();
  }
  if (candidate.updated_at) {
    return new Date(candidate.updated_at).getTime();
  }
  if (candidate.created_at) {
    return new Date(candidate.created_at).getTime();
  }
  return 0;
}

function sortByRecentActivity<T extends GreenhouseCandidate>(
  candidates: T[],
): T[] {
  return [...candidates].sort(
    (left, right) =>
      getCandidateActivityTs(right) - getCandidateActivityTs(left),
  );
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function candidateMatchesSearch(
  candidate: GreenhouseCandidate,
  search: string,
): boolean {
  const tokens = normalize(search).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;

  const haystack = normalize(
    [
      candidate.first_name,
      candidate.last_name,
      getCandidateDisplayName(candidate),
      candidate.title,
      candidate.company,
      candidate.recruiter?.name,
      candidate.coordinator?.name,
      ...(candidate.tags || []),
      ...(candidate.emails || []).map((email) => email.value),
      ...(candidate.phone_numbers || []).map((phone) => phone.value),
      ...(candidate.applications || []).flatMap((application) => [
        application.status,
        application.current_stage?.name,
        ...(application.jobs || []).map((job) => job.name),
      ]),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return tokens.every((token) => haystack.includes(token));
}

export async function searchCandidates(params: {
  search: string;
  jobId?: number;
  limit?: number;
  maxPages?: number;
}): Promise<GreenhouseCandidate[]> {
  const limit = Math.max(1, params.limit ?? 25);
  const maxPages = Math.max(1, params.maxPages ?? SEARCH_MAX_PAGES);
  const search = params.search.trim();

  if (!search) return [];

  const matches: GreenhouseCandidate[] = [];
  const seen = new Set<number>();

  for (let page = 1; page <= maxPages && matches.length < limit; page++) {
    const batch = await listGreenhouseCandidates({
      job_id: params.jobId,
      updated_after: isoDaysAgo(SEARCH_LOOKBACK_DAYS),
      per_page: SEARCH_PAGE_SIZE,
      page,
    });

    if (batch.length === 0) break;

    for (const candidate of batch) {
      if (seen.has(candidate.id)) continue;
      if (!candidateMatchesSearch(candidate, search)) continue;

      seen.add(candidate.id);
      matches.push(candidate);
      if (matches.length >= limit) break;
    }

    if (batch.length < SEARCH_PAGE_SIZE) break;
  }

  return sortByRecentActivity(matches).slice(0, limit);
}

export async function listRecentCandidates(params?: {
  jobId?: number;
  limit?: number;
}): Promise<GreenhouseCandidate[]> {
  const limit = Math.max(1, params?.limit ?? 8);
  const batch = await listGreenhouseCandidates({
    job_id: params?.jobId,
    updated_after: isoDaysAgo(DEFAULT_RECENT_LOOKBACK_DAYS),
    per_page: Math.min(limit, SEARCH_PAGE_SIZE),
    page: 1,
  });

  return sortByRecentActivity(batch).slice(0, limit);
}
