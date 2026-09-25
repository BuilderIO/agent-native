import { createHash } from "node:crypto";

import {
  availableEmbeddingFamilies,
  defaultEmbeddingFamily,
  type EmbeddingFamily,
} from "@agent-native/core/embeddings";
import { getActiveEmbeddingSet } from "@agent-native/creative-context/store";

import {
  candidateTrustTier,
  searchAnalyticsQueryCatalog,
  type AnalyticsQueryCatalogCandidate,
} from "./analytics-query-catalog";
import { renderDataDictionary } from "./data-dictionary-context";

const CATALOG_CANDIDATE_LIMIT = 24;
const PROMPT_CANDIDATE_LIMIT = 8;
const FALLBACK_CANDIDATE_LIMIT = 2;
const MAX_REFERENCE_CONTENT_CHARS = 4_000;
const MAX_EMBEDDING_CACHE_ENTRIES = 256;
const MAX_EMBEDDING_SUMMARY_CHARS = 400;

export interface AnalyticsPromptCandidate {
  id: string;
  description: string;
  metadata: Record<string, string>;
  name: string;
  scope: string;
  content: string;
}

export interface AnalyticsPromptReferences {
  jevPromptCandidates: AnalyticsPromptCandidate[];
  jevFallbackCandidateIds: string[];
}

const CATALOG_TOOL_NAMES = new Set([
  "search-analytics-query-catalog",
  "search-dashboard-references",
  "list-data-dictionary",
  "search-bigquery-schema",
]);
const QUERY_TOOL_NAMES = new Set([
  "bigquery",
  "query-agent-native-analytics",
  "query-dashboard-panel",
  "query-staged-dataset",
]);

export function summarizeAnalyticsRun(input: {
  events: readonly unknown[];
  preloadedReferenceCount: number;
  queryActionNames?: readonly string[];
}): Record<string, number | boolean> {
  type ToolEvent = {
    type: "tool_start" | "tool_done";
    tool: string;
    id?: string;
    isError?: boolean;
  };
  const toolEvents = input.events.flatMap((entry): ToolEvent[] => {
    if (!entry || typeof entry !== "object") return [];
    const event = (entry as { event?: unknown }).event;
    if (!event || typeof event !== "object") return [];
    const value = event as Record<string, unknown>;
    if (
      (value.type !== "tool_start" && value.type !== "tool_done") ||
      typeof value.tool !== "string"
    ) {
      return [];
    }
    return [
      {
        type: value.type,
        tool: value.tool,
        ...(typeof value.id === "string" ? { id: value.id } : {}),
        ...(typeof value.isError === "boolean"
          ? { isError: value.isError }
          : {}),
      },
    ];
  });
  const startedTools = toolEvents.filter(
    (event) => event.type === "tool_start",
  );
  const completedTools = toolEvents.filter(
    (event) => event.type === "tool_done",
  );
  const queryToolNames = new Set([
    ...QUERY_TOOL_NAMES,
    ...(input.queryActionNames ?? []),
  ]);
  const queries = startedTools.filter((event) =>
    queryToolNames.has(String(event.tool)),
  );
  const toolSearchCalls = startedTools.filter((event) =>
    /^tool[-_]search(?:$|[-_])/.test(String(event.tool)),
  ).length;
  const properties: Record<string, number | boolean> = {
    preloaded_reference_count: Math.max(
      0,
      Math.floor(input.preloadedReferenceCount),
    ),
    tool_search_calls: toolSearchCalls,
    catalog_calls: startedTools.filter((event) =>
      CATALOG_TOOL_NAMES.has(String(event.tool)),
    ).length,
    query_calls: queries.length,
  };
  const firstQuery = queries[0];
  const firstQueryDone = firstQuery
    ? typeof firstQuery.id === "string"
      ? completedTools.find(
          (event) =>
            event.tool === firstQuery.tool && event.id === firstQuery.id,
        )
      : undefined
    : undefined;
  const firstQueryError = firstQueryDone?.isError;
  if (typeof firstQueryError === "boolean") {
    properties.first_query_errored = firstQueryError;
  }
  return properties;
}

const documentEmbeddingCache = new Map<string, number[]>();

function jsonText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new Error("Saved dashboard query is not JSON-serializable.");
  }
  return serialized;
}

function candidateContent(candidate: AnalyticsQueryCatalogCandidate): string {
  const lines = [
    "Retrieved Analytics reference. Use it to guide metric definitions and query shape; run a live source query before reporting values.",
  ];
  if (candidate.kind === "data-dictionary") {
    lines.push(
      renderDataDictionary([
        {
          metric: candidate.metric,
          definition: candidate.definition,
          source: candidate.source,
          action: candidate.action,
          table: candidate.table,
          columnsUsed: candidate.columnsUsed,
          queryTemplate: candidate.queryTemplate,
          knownGotchas: candidate.knownGotchas,
          commonQuestions: candidate.commonQuestions,
          cuts: candidate.cuts,
          joinPattern: candidate.joinPattern,
          updateFrequency: candidate.updateFrequency,
          dataLag: candidate.dataLag,
          dependencies: candidate.dependencies,
          validDateRange: candidate.validDateRange,
          owner: candidate.owner,
          approved: candidate.approved,
          aiGenerated: candidate.aiGenerated,
        },
      ]),
      candidate.source?.toLowerCase().includes("bigquery")
        ? "Source dialect: BigQuery GoogleSQL; use STRING, not TEXT, and avoid ILIKE."
        : "",
      candidate.action ? `Query action: ${candidate.action}` : "",
    );
  } else {
    lines.push(
      `Reference type: ${candidate.origin === "saved-dashboard" ? "saved dashboard" : "dashboard template"} panel`,
      `Dashboard: ${candidate.dashboardTitle}`,
      candidate.dashboardDescription
        ? `Dashboard purpose: ${candidate.dashboardDescription}`
        : "",
      `Panel: ${candidate.panelTitle}`,
      candidate.panelDescription
        ? `Panel purpose: ${candidate.panelDescription}`
        : "",
      candidate.source ? `Source: ${candidate.source}` : "",
      candidate.timeScope ? `Time scope: ${candidate.timeScope}` : "",
      `Certification: ${candidate.dashboardCertified ? "certified" : "not certified"}`,
      candidate.query ? `Query: ${jsonText(candidate.query)}` : "",
    );
  }
  return lines.filter(Boolean).join("\n").slice(0, MAX_REFERENCE_CONTENT_CHARS);
}

function candidateEmbeddingSummary(
  candidate: AnalyticsQueryCatalogCandidate,
): string {
  const fields =
    candidate.kind === "data-dictionary"
      ? [
          `Metric: ${candidate.metric}`,
          candidate.definition,
          candidate.source ? `Source: ${candidate.source}` : "",
          candidate.table ? `Table: ${candidate.table}` : "",
        ]
      : [
          `Dashboard: ${candidate.dashboardTitle}`,
          `Panel: ${candidate.panelTitle}`,
          candidate.panelDescription,
          candidate.source ? `Source: ${candidate.source}` : "",
        ];
  return fields
    .filter(Boolean)
    .join(". ")
    .replace(/\s+/g, " ")
    .slice(0, MAX_EMBEDDING_SUMMARY_CHARS);
}

function candidateName(candidate: AnalyticsQueryCatalogCandidate): string {
  return candidate.kind === "data-dictionary"
    ? `Data dictionary: ${candidate.metric}`
    : `${candidate.dashboardTitle}: ${candidate.panelTitle}`;
}

function candidateEmbeddingKey(
  family: EmbeddingFamily,
  content: string,
): string {
  const digest = createHash("sha256").update(content).digest("hex");
  return `${family.id}:${family.model}:${family.version}:${digest}`;
}

function validVector(value: unknown, dimensions: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === dimensions &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function cosineSimilarity(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length === 0) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return null;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

async function resolveEmbeddingFamily(
  deadlineAt: number,
): Promise<EmbeddingFamily | null> {
  const families = await availableEmbeddingFamilies();
  if (Date.now() >= deadlineAt || families.length === 0) return null;
  const activeSet = await getActiveEmbeddingSet();
  if (Date.now() >= deadlineAt) return null;
  if (!activeSet) return defaultEmbeddingFamily(families);
  return (
    families.find(
      (family) =>
        family.id === activeSet.family &&
        family.model === activeSet.model &&
        family.version === activeSet.version &&
        family.dimensions === activeSet.dimensions,
    ) ?? null
  );
}

async function embedDocuments(
  family: EmbeddingFamily,
  documents: string[],
  shouldCache: () => boolean,
): Promise<number[][]> {
  const vectors = new Array<number[] | undefined>(documents.length);
  const missing = new Map<string, string>();
  const newlyEmbedded = new Map<string, number[]>();
  const keys = documents.map((content, index) => {
    const key = candidateEmbeddingKey(family, content);
    const cached = documentEmbeddingCache.get(key);
    if (cached) vectors[index] = cached;
    else missing.set(key, content);
    return key;
  });

  if (missing.size > 0) {
    const entries = [...missing.entries()];
    const embedded = await family.embed(
      entries.map(([, text]) => ({ text })),
      "document",
    );
    if (
      embedded.length !== entries.length ||
      embedded.some((vector) => !validVector(vector, family.dimensions))
    ) {
      throw new Error("Embedding provider returned invalid Analytics vectors.");
    }
    entries.forEach(([key], index) => {
      const vector = embedded[index]!;
      newlyEmbedded.set(key, vector);
      if (!shouldCache()) return;
      // ponytail: Keep this 256-vector FIFO process-local; use templates/brain/server/lib/hybrid-search.ts for pgvector + FTS + RRF when cold-start misses justify persistent embeddings.
      if (documentEmbeddingCache.size >= MAX_EMBEDDING_CACHE_ENTRIES) {
        const oldest = documentEmbeddingCache.keys().next().value;
        if (oldest !== undefined) documentEmbeddingCache.delete(oldest);
      }
      documentEmbeddingCache.set(key, vector);
    });
  }

  for (let index = 0; index < keys.length; index += 1) {
    vectors[index] ??=
      newlyEmbedded.get(keys[index]!) ??
      documentEmbeddingCache.get(keys[index]!);
  }
  if (vectors.some((vector) => !vector)) {
    throw new Error("Analytics document embeddings were not returned.");
  }
  return vectors as number[][];
}

async function rankWithEmbeddings(
  request: string,
  candidates: AnalyticsQueryCatalogCandidate[],
  shouldCache: () => boolean,
  deadlineAt: number,
): Promise<RankedCandidate[]> {
  const family = await resolveEmbeddingFamily(deadlineAt);
  if (Date.now() >= deadlineAt || !family || candidates.length === 0) {
    return candidates.map((candidate) => ({ candidate }));
  }
  const contents = candidates.map(candidateEmbeddingSummary);
  const [queryVectors, documentVectors] = await Promise.all([
    family.embed([{ text: request }], "query"),
    embedDocuments(family, contents, shouldCache),
  ]);
  const queryVector = queryVectors[0];
  if (!validVector(queryVector, family.dimensions)) {
    throw new Error(
      "Embedding provider returned an invalid Analytics query vector.",
    );
  }
  const scores = documentVectors.map((vector) =>
    cosineSimilarity(queryVector, vector),
  );
  if (scores.some((score) => score === null || !Number.isFinite(score))) {
    throw new Error("Analytics embedding similarity could not be calculated.");
  }
  return candidates
    .map((candidate, index) => ({
      candidate,
      similarity: scores[index]!,
      lexicalScore: candidate.score,
    }))
    .sort(
      (left, right) =>
        candidateTrustTier(right.candidate) -
          candidateTrustTier(left.candidate) ||
        right.similarity - left.similarity ||
        right.lexicalScore - left.lexicalScore ||
        candidateName(left.candidate).localeCompare(
          candidateName(right.candidate),
        ),
    );
}

function jevDescription(
  candidate: AnalyticsQueryCatalogCandidate,
  retrievalRank: number,
  similarity?: number,
): string {
  const kind =
    candidate.kind === "data-dictionary"
      ? "dictionary entry"
      : "dashboard panel";
  const trust =
    candidate.kind === "data-dictionary"
      ? candidate.approved
        ? "approved"
        : candidate.aiGenerated
          ? "AI generated and unapproved"
          : "unreviewed"
      : candidate.dashboardCertified
        ? "certified"
        : "not certified";
  const similarityText =
    similarity === undefined
      ? ""
      : `; embedding similarity ${similarity.toFixed(3)}`;
  return `Analytics ${kind}; retrieval rank ${retrievalRank}${similarityText}; ${trust}. ${candidateEmbeddingSummary(candidate)}`.slice(
    0,
    MAX_EMBEDDING_SUMMARY_CHARS,
  );
}

type RankedCandidate = {
  candidate: AnalyticsQueryCatalogCandidate;
  similarity?: number;
  lexicalScore?: number;
};

function emptyPromptReferences(): AnalyticsPromptReferences {
  return { jevPromptCandidates: [], jevFallbackCandidateIds: [] };
}

async function beforeDeadline<T>(
  work: () => Promise<T>,
  deadlineAt: number,
): Promise<{ status: "completed"; value: T } | { status: "expired" }> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return { status: "expired" };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    Promise.resolve()
      .then(work)
      .then((value) => ({ status: "completed" as const, value })),
    new Promise<{ status: "expired" }>((resolve) => {
      timeout = setTimeout(() => resolve({ status: "expired" }), remaining);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  return result;
}

export async function retrieveAnalyticsPromptReferences(input: {
  request: string;
  email: string;
  orgId: string | null;
  deadlineAt?: number;
}): Promise<AnalyticsPromptReferences> {
  const deadlineAt = input.deadlineAt ?? Date.now() + 1_300;
  let cacheAllowed = true;
  let searchResults: AnalyticsQueryCatalogCandidate[];
  try {
    const search = await beforeDeadline(
      () =>
        searchAnalyticsQueryCatalog({
          search: input.request,
          email: input.email,
          orgId: input.orgId,
          limit: CATALOG_CANDIDATE_LIMIT,
        }),
      deadlineAt,
    );
    if (search.status === "expired") {
      console.warn(
        "[analytics] Reference catalog exceeded the context budget.",
      );
      return emptyPromptReferences();
    }
    searchResults = search.value.candidates;
  } catch (error) {
    console.warn(
      "[analytics] Reference catalog unavailable; continuing without preload.",
      error instanceof Error ? error.message : "unknown error",
    );
    return emptyPromptReferences();
  }
  if (searchResults.length === 0) {
    return emptyPromptReferences();
  }

  let ranked: RankedCandidate[] = searchResults.map((candidate) => ({
    candidate,
  }));
  try {
    const semanticRanking = await beforeDeadline(
      () =>
        rankWithEmbeddings(
          input.request,
          searchResults,
          () => cacheAllowed,
          deadlineAt,
        ),
      deadlineAt,
    );
    if (semanticRanking.status === "completed") {
      ranked = semanticRanking.value;
    } else {
      cacheAllowed = false;
      console.warn(
        "[analytics] Embedding ranking exceeded the context budget; keeping catalog order.",
      );
    }
  } catch (error) {
    cacheAllowed = false;
    console.warn(
      "[analytics] Semantic reference ranking unavailable; keeping catalog ranking.",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  const jevPromptCandidates = ranked
    .slice(0, PROMPT_CANDIDATE_LIMIT)
    .map(({ candidate, similarity }, index) => {
      const id = `analytics-reference-${index + 1}`;
      return {
        id,
        description: jevDescription(candidate, index + 1, similarity),
        metadata: {
          kind: "analytics-reference",
          referenceType: candidate.kind,
          retrievalRank: String(index + 1),
          ...(similarity === undefined
            ? {}
            : { similarity: similarity.toFixed(3) }),
        },
        name: candidateName(candidate),
        scope: "analytics-catalog",
        content: candidateContent(candidate),
      };
    });

  return {
    jevPromptCandidates,
    jevFallbackCandidateIds: jevPromptCandidates
      .slice(0, FALLBACK_CANDIDATE_LIMIT)
      .map((candidate) => candidate.id),
  };
}
