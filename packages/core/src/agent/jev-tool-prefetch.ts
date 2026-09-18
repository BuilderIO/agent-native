import type { EngineTool } from "./engine/types.js";
import type { ActionEntry } from "./production-agent.js";
import { searchToolRegistry, TOOL_SEARCH_ACTION_NAME } from "./tool-search.js";

const MAX_JEV_CANDIDATES = 128;
const DEFAULT_PREFETCH_LIMIT = 3;
const MAX_PREFETCH_LIMIT = 5;
const JEV_TIMEOUT_MS = 750;

type JevChoiceAnswer = {
  choice?: unknown;
  probabilities?: unknown;
};

type JevResponse = {
  answers?: Record<string, JevChoiceAnswer>;
};

export interface JevCandidate {
  id: string;
  description: string;
  /** Metadata sent to Jev; callers must not put private content here. */
  metadata?: Record<string, string>;
}

export interface JevRankCandidatesOptions {
  request: string;
  apiKey?: string;
  candidates: readonly JevCandidate[];
  candidateStateKey: string;
  answerKey: string;
  question: string;
  limit?: number;
}

/**
 * Rank a bounded metadata-only catalog with Jev. A missing key, malformed
 * response, timeout, or provider failure returns no ranking so callers keep
 * their existing deterministic fallback.
 */
export async function rankJevCandidates(
  options: JevRankCandidatesOptions,
): Promise<string[]> {
  const request = options.request.trim();
  const apiKey = options.apiKey?.trim();
  if (!request || !apiKey || options.candidates.length === 0) return [];

  const candidates = shortlistJevCandidates(request, options.candidates);
  if (candidates.length === 0) return [];
  const limit = Math.max(
    1,
    Math.min(options.limit ?? DEFAULT_PREFETCH_LIMIT, MAX_PREFETCH_LIMIT),
  );
  if (candidates.length === 1) return [candidates[0]!.id];

  try {
    const { choice, TypeSafeClient } = await import("@typesafe-ai/sdk");
    const client = new TypeSafeClient({
      apiKey,
      timeout: JEV_TIMEOUT_MS,
      retry: { maxRetries: 0 },
    });
    const criteria = Object.fromEntries(
      candidates.map((candidate) => [
        candidate.id,
        candidate.description || candidate.id,
      ]),
    );
    const response = (await client.systemOne({
      state: {
        task: request,
        [options.candidateStateKey]: candidates.map((candidate) => ({
          id: candidate.id,
          description: candidate.description,
          ...candidate.metadata,
        })),
      },
      questions: {
        [options.answerKey]: choice(options.question, criteria),
      },
    })) as JevResponse;

    const answer = response.answers?.[options.answerKey];
    const probabilities =
      answer?.probabilities && typeof answer.probabilities === "object"
        ? (answer.probabilities as Record<string, unknown>)
        : {};
    const rankedNames = candidates
      .filter(
        (candidate) =>
          typeof probabilities[candidate.id] === "number" &&
          Number.isFinite(probabilities[candidate.id]),
      )
      .map((candidate) => ({
        name: candidate.id,
        probability: probabilities[candidate.id] as number,
      }))
      .sort(
        (a, b) => b.probability - a.probability || a.name.localeCompare(b.name),
      )
      .map((candidate) => candidate.name);
    const chosenName =
      typeof answer?.choice === "string" &&
      candidates.some((candidate) => candidate.id === answer.choice)
        ? answer.choice
        : undefined;
    const hasProbabilities = candidates.some(
      (candidate) =>
        typeof probabilities[candidate.id] === "number" &&
        Number.isFinite(probabilities[candidate.id]),
    );
    if (!chosenName && !hasProbabilities) return [];
    return [chosenName, ...rankedNames]
      .filter((name): name is string => Boolean(name))
      .filter((name, index, names) => names.indexOf(name) === index)
      .slice(0, limit);
  } catch (error) {
    console.warn(
      "[agent] Jev context prefetch unavailable; continuing with the existing context.",
      error instanceof Error ? error.message : "unknown error",
    );
    return [];
  }
}

export function shortlistJevCandidates<T extends JevCandidate>(
  request: string,
  candidates: readonly T[],
): T[] {
  if (candidates.length <= MAX_JEV_CANDIDATES) return [...candidates];
  const tokens = request
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  // ponytail: cap Jev's catalog at 128; lexical overlap is the cheap upgrade path before chunked selection exists.
  return candidates
    .map((candidate) => {
      const haystack = `${candidate.id} ${candidate.description}`.toLowerCase();
      const score = tokens.reduce(
        (total, token) => total + (haystack.includes(token) ? 1 : 0),
        0,
      );
      return { candidate, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.candidate.id.localeCompare(b.candidate.id),
    )
    .slice(0, MAX_JEV_CANDIDATES)
    .map(({ candidate }) => candidate);
}

export interface JevToolPrefetchOptions {
  request: string;
  apiKey?: string;
  registry: Record<string, ActionEntry>;
  initialTools: EngineTool[];
  availableTools: EngineTool[];
  readOnlyOnly?: boolean;
  limit?: number;
}

/**
 * Ask Jev which deferred tools deserve first-request schemas.
 *
 * A missing key and a Jev failure both preserve the existing curated surface;
 * Jev is an accelerator, not a dependency of agent execution.
 */
export async function preloadJevTools(
  options: JevToolPrefetchOptions,
): Promise<EngineTool[]> {
  const request = options.request.trim();
  const apiKey = options.apiKey?.trim();
  if (!request || !apiKey) return options.initialTools;

  const activeNames = new Set(options.initialTools.map((tool) => tool.name));
  const availableByName = new Map(
    options.availableTools.map((tool) => [tool.name, tool]),
  );
  const menu = searchToolRegistry(options.registry, {
    readOnlyOnly: options.readOnlyOnly,
  });
  const eligible = menu.results.filter(
    (result) =>
      result.name !== TOOL_SEARCH_ACTION_NAME &&
      !activeNames.has(result.name) &&
      availableByName.has(result.name) &&
      (!options.readOnlyOnly || result.callable),
  );

  let candidates = eligible;
  if (candidates.length > MAX_JEV_CANDIDATES) {
    // ponytail: cap Jev's choice catalog at 128; larger registries use a lexical shortlist until chunked selection exists.
    const lexical = searchToolRegistry(
      options.registry,
      {
        query: request,
        limit: MAX_JEV_CANDIDATES,
        readOnlyOnly: options.readOnlyOnly,
      },
      { defaultLimit: MAX_JEV_CANDIDATES, maxLimit: MAX_JEV_CANDIDATES },
    );
    const eligibleNames = new Set(eligible.map((result) => result.name));
    candidates = lexical.results.filter((result) =>
      eligibleNames.has(result.name),
    );
  }
  if (candidates.length === 0) return options.initialTools;

  const prefetchLimit = Math.max(
    1,
    Math.min(options.limit ?? DEFAULT_PREFETCH_LIMIT, MAX_PREFETCH_LIMIT),
  );
  const selectedNames = await rankJevCandidates({
    request,
    apiKey,
    candidates: candidates.map((candidate) => ({
      id: candidate.name,
      description: candidate.description,
      metadata: { kind: "tool" },
    })),
    candidateStateKey: "candidate_tools",
    answerKey: "best_tool",
    question:
      "Which tools should be loaded into the agent context first for this task? Pick the most useful tool; probabilities may be used to keep a small ranked shortlist.",
    limit: prefetchLimit,
  });
  return selectedNames.length > 0
    ? prependSelectedTools(options, selectedNames)
    : options.initialTools;
}

function prependSelectedTools(
  options: JevToolPrefetchOptions,
  selectedNames: string[],
): EngineTool[] {
  const selected = selectedNames
    .map((name) => options.availableTools.find((tool) => tool.name === name))
    .filter((tool): tool is EngineTool => Boolean(tool));
  return [...selected, ...options.initialTools];
}
