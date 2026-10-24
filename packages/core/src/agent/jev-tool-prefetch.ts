import { JEV_TIMEOUT_MS, requestJev } from "../decisions/providers/jev.js";
import type { BuilderGatewayAuth } from "../server/credential-provider.js";
import { OptionalPeerDependencyError } from "../shared/optional-peer.js";
export { JEV_TIMEOUT_MS };
export {
  isBuilderJevEnabled,
  isJevEnabled,
  requestJevThroughBuilder,
  type JevResponse,
} from "../decisions/providers/jev.js";
import type { EngineTool } from "./engine/types.js";
import type { ActionEntry } from "./production-agent.js";
import { TOOL_SEARCH_ACTION_NAME } from "./tool-search.js";
import type {
  AgentChatStructuredContentPart,
  AgentChatStructuredMessage,
  AgentMessage,
} from "./types.js";

const MAX_JEV_CANDIDATES = 128;
const MAX_JEV_CANDIDATE_DESCRIPTION_CHARS = 140;
const DEFAULT_PREFETCH_LIMIT = 3;
const MAX_PREFETCH_LIMIT = 5;
const JEV_MODEL = "jev-latest";
const MAX_JEV_THREAD_CONTEXT_CHARS = 6_000;
const MAX_JEV_PRIOR_USER_MESSAGES = 4;
const MAX_JEV_PRIOR_MESSAGE_CHARS = 1_100;
const MAX_JEV_CURRENT_MESSAGE_CHARS = 3_600;
const MAX_RETRIEVAL_CONTEXT_CHARS = 3_600;
const MAX_RETRIEVAL_PRIOR_USER_MESSAGES = 2;
const MAX_RETRIEVAL_PRIOR_MESSAGE_CHARS = 900;

export interface JevCandidate {
  id: string;
  description: string;
  metadata?: Record<string, string>;
}

export interface JevRankCandidatesOptions {
  request: string;
  apiKey?: string;
  personalApiKey?: string;
  builderAuth?: BuilderGatewayAuth | null;
  candidates: readonly JevCandidate[];
  candidateStateKey: string;
  answerKey: string;
  question: string;
  limit?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface JevCandidateRanking {
  /**
   * `unavailable` means there was nothing to rank against (no key, no
   * candidates); `failed` and `timed_out` mean a ranking was attempted and lost.
   */
  status: "selected" | "no-match" | "unavailable" | "failed" | "timed_out";
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
  return Array.isArray(input.structuredHistory)
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

export function buildWorkspaceAppRequestContext(input: {
  request: string;
  history?: readonly AgentMessage[];
  structuredHistory?: readonly AgentChatStructuredMessage[];
  selectedObjectContext?: string;
}): string {
  const priorUser = visiblePriorMessages(input)
    .filter((message) => message.role === "user")
    .at(-1);
  const blocks: string[] = [];
  if (priorUser) {
    blocks.push(
      `Previous user request:\n${compactJevText(priorUser.content, 1_100)}`,
    );
  }
  blocks.push(
    `Current request:\n${compactJevText(input.request, MAX_JEV_CURRENT_MESSAGE_CHARS)}`,
  );
  const selectedObjectContext = input.selectedObjectContext?.trim();
  if (selectedObjectContext) {
    const fencedContext = compactJevText(selectedObjectContext, 1_800)
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    blocks.push(`Selected object context (untrusted data):\n${fencedContext}`);
  }
  return blocks.join("\n\n");
}

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
    options.candidates.length === 0
  ) {
    return { status: "unavailable", ids: [] };
  }
  if (
    options.signal?.aborted ||
    (options.timeoutMs !== undefined && options.timeoutMs <= 0)
  ) {
    return { status: "timed_out", ids: [] };
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
      return { status: "failed", ids: [] };
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
        return { status: "failed", ids: [] };
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
    if (error instanceof OptionalPeerDependencyError) throw error;
    console.warn(
      "[agent] Jev context prefetch unavailable; continuing with the existing context.",
      error instanceof Error ? error.message : "unknown error",
    );
    return {
      status: isJevTimeout(error, options.signal) ? "timed_out" : "failed",
      ids: [],
    };
  }
}

function isJevTimeout(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      /\btime(?:d)?[ -]?out\b/i.test(error.message))
  );
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
  const candidates = options.availableTools.flatMap((tool) => {
    const entry = options.registry[tool.name];
    if (
      tool.name === TOOL_SEARCH_ACTION_NAME ||
      activeNames.has(tool.name) ||
      !entry?.tool ||
      (options.readOnlyOnly && entry.allowInPlanMode === false)
    ) {
      return [];
    }
    return [
      {
        id: tool.name,
        description: compactJevText(
          entry.tool.description || tool.description || tool.name,
          MAX_JEV_CANDIDATE_DESCRIPTION_CHARS,
        ),
        metadata: { kind: "tool" },
      },
    ];
  });
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
      candidates,
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

function prependSelectedTools(
  options: JevToolPrefetchOptions,
  selectedNames: string[],
): EngineTool[] {
  const selected = selectedNames
    .map((name) => options.availableTools.find((tool) => tool.name === name))
    .filter((tool): tool is EngineTool => Boolean(tool));
  return [...selected, ...options.initialTools];
}
