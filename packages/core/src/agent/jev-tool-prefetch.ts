import {
  getBuilderProxyOrigin,
  type BuilderGatewayAuth,
} from "../server/credential-provider.js";
import { getBuilderGatewayRequestHeaders } from "./engine/builder-gateway-headers.js";
import type { EngineTool } from "./engine/types.js";
import type { ActionEntry, JevContextCredentials } from "./production-agent.js";
import { searchToolRegistry, TOOL_SEARCH_ACTION_NAME } from "./tool-search.js";
import type {
  AgentChatStructuredContentPart,
  AgentChatStructuredMessage,
  AgentMessage,
} from "./types.js";

const MAX_JEV_CANDIDATES = 128;
const DEFAULT_PREFETCH_LIMIT = 3;
const MAX_PREFETCH_LIMIT = 5;
export const JEV_TIMEOUT_MS = 750;
const JEV_MODEL = "jev-latest";
const MAX_JEV_THREAD_CONTEXT_CHARS = 6_000;
const MAX_JEV_PRIOR_USER_MESSAGES = 4;
const MAX_JEV_PRIOR_MESSAGE_CHARS = 1_100;
const MAX_JEV_CURRENT_MESSAGE_CHARS = 3_600;
const MAX_RETRIEVAL_CONTEXT_CHARS = 3_600;
const MAX_RETRIEVAL_PRIOR_USER_MESSAGES = 2;
const MAX_RETRIEVAL_PRIOR_MESSAGE_CHARS = 900;

type JevChoiceAnswer = {
  choice?: unknown;
  probabilities?: unknown;
};

export type JevResponse = {
  answers?: Record<string, JevChoiceAnswer & { noul?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
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
  personalApiKey?: string;
  builderAuth?: BuilderGatewayAuth | null;
  /** IDs, descriptions, and metadata are sent to Jev; callers provide summaries only. */
  candidates: readonly JevCandidate[];
  candidateStateKey: string;
  answerKey: string;
  question: string;
  limit?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface JevCandidateRanking {
  status: "selected" | "no-match" | "unavailable";
  ids: string[];
}

function compactJevText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  const ellipsis = " … ";
  const startChars = Math.ceil((maxChars - ellipsis.length) * 0.75);
  return `${text.slice(0, startChars)}${ellipsis}${text.slice(
    -(maxChars - startChars - ellipsis.length),
  )}`;
}

type VisiblePriorMessage = { role: "user" | "assistant"; content: string };

function visiblePriorMessages(input: {
  request: string;
  history?: readonly AgentMessage[];
  structuredHistory?: readonly AgentChatStructuredMessage[];
}): VisiblePriorMessage[] {
  const structured = Array.isArray(input.structuredHistory)
    ? input.structuredHistory.flatMap((message) => {
        if (
          !message ||
          (message.role !== "user" && message.role !== "assistant") ||
          !Array.isArray(message.content)
        ) {
          return [];
        }
        const text = message.content
          .flatMap((part: AgentChatStructuredContentPart) =>
            part?.type === "text" && typeof part.text === "string"
              ? [part.text]
              : [],
          )
          .join(" ")
          .trim();
        return text ? [{ role: message.role, content: text }] : [];
      })
    : [];
  return structured.length
    ? structured
    : (Array.isArray(input.history) ? input.history : []).flatMap((message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim()
          ? [{ role: message.role, content: message.content }]
          : [],
      );
}

/** Keep Jev grounded in recent user requests without sending assistant results. */
export function buildJevRequestContext(input: {
  request: string;
  history?: readonly AgentMessage[];
  structuredHistory?: readonly AgentChatStructuredMessage[];
}): string {
  const priorMessages = visiblePriorMessages(input);
  const current = compactJevText(input.request, MAX_JEV_CURRENT_MESSAGE_CHARS);
  const currentBlock = `Current request:\n${current}`;
  let remaining = MAX_JEV_THREAD_CONTEXT_CHARS - currentBlock.length - 40;
  const recentLines: string[] = [];
  const priorUsers = priorMessages.filter((message) => message.role === "user");
  const selectedMessages = priorUsers.slice(-MAX_JEV_PRIOR_USER_MESSAGES);
  for (const message of selectedMessages.reverse()) {
    if (remaining < 80) break;
    const content = compactJevText(
      message.content,
      Math.min(MAX_JEV_PRIOR_MESSAGE_CHARS, remaining - 12),
    );
    const line = `User: ${content}`;
    if (line.length > remaining) break;
    recentLines.push(line);
    remaining -= line.length + 1;
  }
  const recent = recentLines.reverse();
  return recent.length
    ? `Recent conversation:\n${recent.join("\n")}\n\n${currentBlock}`
    : currentBlock;
}

/** Current request plus the last two user turns for semantic/catalog retrieval. */
export function buildRecentUserRequestContext(input: {
  request: string;
  history?: readonly AgentMessage[];
  structuredHistory?: readonly AgentChatStructuredMessage[];
}): string {
  const priorUsers = visiblePriorMessages(input)
    .filter((message) => message.role === "user")
    .slice(-MAX_RETRIEVAL_PRIOR_USER_MESSAGES);
  const current = compactJevText(input.request, MAX_JEV_CURRENT_MESSAGE_CHARS);
  const currentBlock = `Current request:\n${current}`;
  let remaining = MAX_RETRIEVAL_CONTEXT_CHARS - currentBlock.length - 32;
  const recentLines: string[] = [];
  for (const message of priorUsers.reverse()) {
    if (remaining < 80) break;
    const content = compactJevText(
      message.content,
      Math.min(MAX_RETRIEVAL_PRIOR_MESSAGE_CHARS, remaining - 12),
    );
    const line = `User: ${content}`;
    if (line.length > remaining) break;
    recentLines.push(line);
    remaining -= line.length + 1;
  }
  const recent = recentLines.reverse();
  return recent.length
    ? `Recent user requests:\n${recent.join("\n")}\n\n${currentBlock}`
    : currentBlock;
}

/**
 * Rank a bounded metadata-only catalog with Jev. Direct keys send bounded
 * request text and candidate IDs, descriptions, and metadata to a third party;
 * callers must omit paths, raw bodies, SQL, tool inputs/results, and row data.
 * A missing key, malformed response, timeout, or provider failure returns no
 * ranking so callers keep their existing deterministic fallback.
 */
export async function rankJevCandidates(
  options: JevRankCandidatesOptions,
): Promise<string[]> {
  return (await rankJevCandidatesWithStatus(options)).ids;
}

export async function rankJevCandidatesWithStatus(
  options: JevRankCandidatesOptions,
): Promise<JevCandidateRanking> {
  const request = options.request.trim();
  const apiKey = options.personalApiKey?.trim();
  const builderAuth = options.builderAuth;
  if (
    !request ||
    (!apiKey && !builderAuth) ||
    options.candidates.length === 0 ||
    options.signal?.aborted ||
    (options.timeoutMs !== undefined && options.timeoutMs <= 0)
  ) {
    return { status: "unavailable", ids: [] };
  }

  const candidates = shortlistJevCandidates(request, options.candidates);
  if (candidates.length === 0) return { status: "unavailable", ids: [] };
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
      personalApiKey: options.personalApiKey,
      builderAuth,
      request: jevRequest,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });

    const answer = response.answers?.[options.answerKey];
    if (answer?.choice === noMatchId) {
      return { status: "no-match", ids: [] };
    }
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
      return { status: "unavailable", ids: [] };
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
        return { status: "unavailable", ids: [] };
      }
    }
    const ids = candidates
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
    return ids.length > 0
      ? { status: "selected", ids }
      : { status: "no-match", ids: [] };
  } catch (error) {
    console.warn(
      "[agent] Jev context prefetch unavailable; continuing with the existing context.",
      error instanceof Error ? error.message : "unknown error",
    );
    return { status: "unavailable", ids: [] };
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
  skip?: boolean;
  deadlineAt?: number;
  apiKey?: string;
  personalApiKey?: string;
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
  if (options.skip) return options.initialTools;
  const request = options.request.trim();
  const apiKey = options.personalApiKey?.trim();
  const builderAuth = options.builderAuth;
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
  const remaining = Math.min(
    JEV_TIMEOUT_MS,
    options.deadlineAt === undefined
      ? JEV_TIMEOUT_MS
      : options.deadlineAt - Date.now(),
  );
  if (remaining <= 0) return options.initialTools;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const selectedNames = await Promise.race([
    rankJevCandidates({
      request,
      apiKey,
      personalApiKey: options.personalApiKey,
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
      signal: controller.signal,
      timeoutMs: remaining,
    }),
    new Promise<string[]>((resolve) => {
      timeout = setTimeout(() => {
        controller.abort();
        resolve([]);
      }, remaining);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
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
  personalApiKey?: string;
  builderAuth?: BuilderGatewayAuth | null;
  request: JevRequest;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<JevResponse> {
  options.signal?.throwIfAborted();
  const personalApiKey = options.personalApiKey?.trim();
  if (options.builderAuth) {
    try {
      return await requestJevThroughBuilder(
        options.builderAuth,
        options.request,
        { signal: options.signal, timeoutMs: options.timeoutMs },
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!personalApiKey) throw error;
      console.warn(
        "[agent] Builder Jev proxy unavailable; falling back to the direct Jev API.",
        error instanceof Error ? error.message : "unknown error",
      );
      return requestJevDirect(personalApiKey, options.request, options);
    }
  }

  if (!personalApiKey) {
    throw new Error("Builder Jev proxy is unavailable.");
  }

  return requestJevDirect(personalApiKey, options.request, options);
}

async function requestJevDirect(
  apiKey: string,
  request: JevRequest,
  options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<JevResponse> {
  options.signal?.throwIfAborted();
  const { choice, TypeSafeClient } = await import("@typesafe-ai/sdk");
  options.signal?.throwIfAborted();
  const client = new TypeSafeClient({
    apiKey,
    timeout: Math.max(
      1,
      Math.min(JEV_TIMEOUT_MS, options.timeoutMs ?? JEV_TIMEOUT_MS),
    ),
    retry: { maxRetries: 0 },
  });
  const systemOne = client.systemOne.bind(client) as unknown as (
    request: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
  return (await systemOne(
    {
      ...request,
      questions: {
        [Object.keys(request.questions)[0]!]: choice(
          Object.values(request.questions)[0]!.instructions,
          Object.values(request.questions)[0]!.criteria,
        ),
      },
    },
    options.signal ? { signal: options.signal } : undefined,
  )) as JevResponse;
}

export async function requestJevThroughBuilder(
  auth: BuilderGatewayAuth,
  request: Record<string, unknown>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<JevResponse> {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? JEV_TIMEOUT_MS,
  );
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      signal.throwIfAborted();
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
          signal,
        },
      );
      if (!response.ok) {
        if (attempt === 0 && [429, 529].includes(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          await waitForJevRetry(signal);
          continue;
        }
        throw new Error(`Builder Jev proxy returned HTTP ${response.status}.`);
      }
      const result = (await response.json()) as unknown;
      if (!isJevResponse(result)) {
        throw new Error("Builder Jev proxy returned an invalid response.");
      }
      return result;
    }
    throw new Error("Builder Jev proxy request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

function waitForJevRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, 200);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export async function isBuilderJevEnabled(
  auth: BuilderGatewayAuth,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 3_000,
  );
  try {
    const response = await fetch(
      `${getBuilderProxyOrigin().replace(/\/+$/, "")}/agent-native/jev/v1/status`,
      {
        method: "GET",
        headers: {
          Authorization: auth.authorization,
          ...(auth.spaceId ? { "x-builder-api-key": auth.spaceId } : {}),
          ...(auth.userId ? { "x-builder-user-id": auth.userId } : {}),
          ...getBuilderGatewayRequestHeaders(),
        },
        signal: options.signal
          ? AbortSignal.any([options.signal, controller.signal])
          : controller.signal,
      },
    );
    if (response.status === 403) return false;
    if (!response.ok) {
      throw new Error(`Builder Jev status returned HTTP ${response.status}.`);
    }
    const result = (await response.json()) as unknown;
    if (
      typeof result !== "object" ||
      result === null ||
      !("enabled" in result) ||
      typeof result.enabled !== "boolean"
    ) {
      throw new Error("Builder Jev status returned an invalid response.");
    }
    return result.enabled;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isJevEnabled(
  credentials: JevContextCredentials,
): Promise<boolean> {
  if (credentials.personalApiKey) return true;
  if (credentials.builderAuth) {
    const enabled = await isBuilderJevEnabled(credentials.builderAuth);
    if (enabled || !credentials.apiKeyLookupFailed) return enabled;
  }
  if (credentials.apiKeyLookupFailed || credentials.builderAuthLookupFailed) {
    throw new Error("Could not check Jev credentials or Builder entitlement.");
  }
  return false;
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
