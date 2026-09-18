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
  if (candidates.length === 1) {
    return prependSelectedTools(options, [candidates[0].name]);
  }

  try {
    const { choice, TypeSafeClient } = await import("@typesafe-ai/sdk");
    const client = new TypeSafeClient({
      apiKey,
      timeout: JEV_TIMEOUT_MS,
      retry: { maxRetries: 0 },
    });
    const criteria = Object.fromEntries(
      candidates.map((candidate) => [
        candidate.name,
        candidate.description || candidate.name,
      ]),
    );
    const response = (await client.systemOne({
      state: {
        task: request,
        candidate_tools: candidates.map((candidate) => ({
          name: candidate.name,
          description: candidate.description,
        })),
      },
      questions: {
        best_tool: choice(
          "Which tools should be loaded into the agent context first for this task? Pick the most useful tool; probabilities may be used to keep a small ranked shortlist.",
          criteria,
        ),
      },
    })) as JevResponse;

    const answer = response.answers?.best_tool;
    const probabilities =
      answer?.probabilities && typeof answer.probabilities === "object"
        ? (answer.probabilities as Record<string, unknown>)
        : {};
    const rankedNames = candidates
      .map((candidate) => ({
        name: candidate.name,
        probability:
          typeof probabilities[candidate.name] === "number"
            ? (probabilities[candidate.name] as number)
            : 0,
      }))
      .sort(
        (a, b) => b.probability - a.probability || a.name.localeCompare(b.name),
      )
      .map((candidate) => candidate.name);
    const chosenName =
      typeof answer?.choice === "string" &&
      candidates.some((candidate) => candidate.name === answer.choice)
        ? answer.choice
        : undefined;
    const selectedNames = [chosenName, ...rankedNames]
      .filter((name): name is string => Boolean(name))
      .filter((name, index, names) => names.indexOf(name) === index)
      .slice(0, prefetchLimit);
    return prependSelectedTools(options, selectedNames);
  } catch (error) {
    console.warn(
      "[agent] Jev tool prefetch unavailable; continuing with curated tools.",
      error instanceof Error ? error.message : "unknown error",
    );
    return options.initialTools;
  }
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
