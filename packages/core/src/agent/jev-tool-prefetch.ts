import type { BuilderGatewayAuth } from "../server/credential-provider.js";
import { getBuilderGatewayRequestHeaders } from "./engine/builder-gateway-headers.js";
import type { EngineTool } from "./engine/types.js";
import type { ActionEntry } from "./production-agent.js";
import { searchToolRegistry, TOOL_SEARCH_ACTION_NAME } from "./tool-search.js";

const MAX_JEV_CANDIDATES = 128;
const DEFAULT_PREFETCH_LIMIT = 3;
const MAX_PREFETCH_LIMIT = 5;
const JEV_TIMEOUT_MS = 750;
const JEV_MODEL = "jev-latest";

export const BUILDER_JEV_PROXY_ENABLED = true;

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
  builderAuth?: BuilderGatewayAuth | null;
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
  const builderAuth = BUILDER_JEV_PROXY_ENABLED ? options.builderAuth : null;
  if (
    !request ||
    (!apiKey && !builderAuth) ||
    options.candidates.length === 0
  ) {
    return [];
  }

  const candidates = shortlistJevCandidates(request, options.candidates);
  if (candidates.length === 0) return [];
  const limit = Math.max(
    1,
    Math.min(options.limit ?? DEFAULT_PREFETCH_LIMIT, MAX_PREFETCH_LIMIT),
  );

  try {
    let noMatchId = "__no_match__";
    while (candidates.some((candidate) => candidate.id === noMatchId)) {
      noMatchId += "_";
    }
    const criteria = Object.fromEntries(
      candidates.map((candidate) => [
        candidate.id,
        candidate.description || candidate.id,
      ]),
    );
    criteria[noMatchId] = "None of these candidates is relevant to the task.";
    const jevRequest = {
      model: JEV_MODEL,
      state: {
        task: request,
        [options.candidateStateKey]: candidates.map((candidate) => ({
          id: candidate.id,
          description: candidate.description,
          ...candidate.metadata,
        })),
      },
      questions: {
        [options.answerKey]: {
          type: "choice" as const,
          instructions: `${options.question} Choose ${noMatchId} when no candidate is relevant.`,
          criteria,
        },
      },
    };

    const response = await requestJev({
      apiKey,
      builderAuth,
      request: jevRequest,
    });

    const answer = response.answers?.[options.answerKey];
    if (answer?.choice === noMatchId) return [];
    const probabilities =
      answer?.probabilities && typeof answer.probabilities === "object"
        ? (answer.probabilities as Record<string, unknown>)
        : {};
    const noMatchProbability = probabilities[noMatchId];
    if (
      typeof noMatchProbability !== "number" ||
      !Number.isFinite(noMatchProbability) ||
      noMatchProbability < 0 ||
      noMatchProbability > 1
    ) {
      return [];
    }
    for (const candidate of candidates) {
      const probability = probabilities[candidate.id];
      if (
        probability !== undefined &&
        (typeof probability !== "number" ||
          !Number.isFinite(probability) ||
          probability < 0 ||
          probability > 1)
      ) {
        return [];
      }
    }
    return candidates
      .filter(
        (candidate) =>
          typeof probabilities[candidate.id] === "number" &&
          (probabilities[candidate.id] as number) > noMatchProbability,
      )
      .map((candidate) => ({
        name: candidate.id,
        probability: probabilities[candidate.id] as number,
      }))
      .sort(
        (a, b) => b.probability - a.probability || a.name.localeCompare(b.name),
      )
      .map((candidate) => candidate.name)
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
  builderAuth?: BuilderGatewayAuth | null;
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
  const builderAuth = BUILDER_JEV_PROXY_ENABLED ? options.builderAuth : null;
  if (!request || (!apiKey && !builderAuth)) {
    return options.initialTools;
  }

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
    builderAuth,
    question:
      "Which tools should be loaded into the agent context first for this task? Pick the most useful tool; probabilities may be used to keep a small ranked shortlist.",
    limit: prefetchLimit,
  });
  return selectedNames.length > 0
    ? prependSelectedTools(options, selectedNames)
    : options.initialTools;
}

type JevRequest = {
  model: string;
  state: Record<string, unknown>;
  questions: Record<
    string,
    {
      type: "choice";
      instructions: string;
      criteria: Record<string, string>;
    }
  >;
};

async function requestJev(options: {
  apiKey?: string;
  builderAuth?: BuilderGatewayAuth | null;
  request: JevRequest;
}): Promise<JevResponse> {
  if (BUILDER_JEV_PROXY_ENABLED && options.builderAuth) {
    try {
      return await requestJevThroughBuilder(
        options.builderAuth,
        options.request,
      );
    } catch (error) {
      if (!options.apiKey) throw error;
      console.warn(
        "[agent] Builder Jev proxy unavailable; falling back to the direct Jev API.",
        error instanceof Error ? error.message : "unknown error",
      );
    }
  }

  if (!options.apiKey) {
    throw new Error("Builder Jev proxy is unavailable.");
  }

  const { choice, TypeSafeClient } = await import("@typesafe-ai/sdk");
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    timeout: JEV_TIMEOUT_MS,
    retry: { maxRetries: 0 },
  });
  const systemOne = client.systemOne as unknown as (
    request: unknown,
  ) => Promise<unknown>;
  return (await systemOne({
    ...options.request,
    questions: {
      [Object.keys(options.request.questions)[0]!]: choice(
        Object.values(options.request.questions)[0]!.instructions,
        Object.values(options.request.questions)[0]!.criteria,
      ),
    },
  })) as JevResponse;
}

async function requestJevThroughBuilder(
  auth: BuilderGatewayAuth,
  request: JevRequest,
): Promise<JevResponse> {
  const { getBuilderProxyOrigin } =
    await import("../server/credential-provider.js");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JEV_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${getBuilderProxyOrigin().replace(/\/+$/, "")}/agent-native/jev/v1/system-one`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth.authorization,
          ...(auth.spaceId ? { "x-builder-api-key": auth.spaceId } : {}),
          ...(auth.userId ? { "x-builder-user-id": auth.userId } : {}),
          ...getBuilderGatewayRequestHeaders(),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      throw new Error(`Builder Jev proxy returned HTTP ${response.status}.`);
    }
    const result = (await response.json()) as unknown;
    if (!isJevResponse(result)) {
      throw new Error("Builder Jev proxy returned an invalid response.");
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function isJevResponse(value: unknown): value is JevResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "answers" in value &&
    typeof value.answers === "object" &&
    value.answers !== null
  );
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
