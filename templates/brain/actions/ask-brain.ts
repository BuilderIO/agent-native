import { defineAction } from "@agent-native/core";
import { buildDeepLink } from "@agent-native/core/server";
import { z } from "zod";
import {
  readBrainAgentGuidance,
  searchKnowledgeRows,
  serializeKnowledge,
} from "../server/lib/brain.js";
import {
  buildFederatedSearchCoverage,
  searchEverythingRows,
  type UniversalSearchResult,
} from "../server/lib/search.js";

const STOPWORDS = new Set([
  "about",
  "does",
  "from",
  "have",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "why",
  "the",
  "and",
  "for",
  "our",
  "did",
]);

function facetsFromQuestion(question: string) {
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  const facets = new Set<string>([question]);
  for (let i = 0; i < words.length; i += 1) {
    facets.add(words[i]);
    if (words[i + 1]) facets.add(`${words[i]} ${words[i + 1]}`);
  }
  return Array.from(facets).slice(0, 8);
}

type KnowledgeSearchRow = Awaited<
  ReturnType<typeof searchKnowledgeRows>
>[number];

function questionTerms(question: string) {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
    ),
  );
}

function rowText(row: KnowledgeSearchRow) {
  return [
    row.title,
    row.summary,
    row.body,
    row.topic,
    row.tagsJson,
    row.entitiesJson,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreRowForQuestion(row: KnowledgeSearchRow, terms: string[]) {
  const text = rowText(row);
  const title = row.title.toLowerCase();
  return terms.reduce((score, term) => {
    if (!text.includes(term)) return score;
    return score + (title.includes(term) ? 3 : 1);
  }, 0);
}

function rankRowsForQuestion(rows: KnowledgeSearchRow[], question: string) {
  const terms = questionTerms(question);
  if (!terms.length) return rows;
  const ranked = rows
    .map((row) => ({ row, score: scoreRowForQuestion(row, terms) }))
    .sort((a, b) => b.score - a.score);
  const bestScore = ranked[0]?.score ?? 0;
  const minimumScore = bestScore >= 3 ? Math.max(2, bestScore - 2) : 0;
  return ranked
    .filter((entry) => entry.score >= minimumScore)
    .slice(0, 6)
    .map((entry) => entry.row);
}

function knowledgeDeepLink(knowledgeId: string): string {
  return buildDeepLink({
    app: "brain",
    view: "knowledge",
    params: { knowledgeId },
  });
}

function captureDeepLink(captureId: string): string {
  return buildDeepLink({
    app: "brain",
    view: "capture",
    params: { captureId },
  });
}

export default defineAction({
  description:
    "Answer a company-memory question from published Brain knowledge, falling back to cited raw capture matches when approved knowledge is thin. The external-facing public-agent company lookup: returns a cited answer plus deep links into the Brain knowledge/capture records.",
  schema: z.object({
    question: z.string().min(1),
    mode: z.enum(["cited"]).default("cited"),
    filters: z.record(z.string(), z.string()).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async ({ question, filters }) => {
    const { guidance } = await readBrainAgentGuidance();
    const federatedCoveragePromise = buildFederatedSearchCoverage({
      query: question,
      provider: filters?.provider,
      status: filters?.status,
    });
    const seen = new Set<string>();
    const rows = [];
    for (const facet of facetsFromQuestion(question)) {
      const matches = await searchKnowledgeRows({ query: facet, limit: 6 });
      for (const row of matches) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
      }
      if (rows.length >= 6) break;
    }
    const knowledge = rankRowsForQuestion(rows, question).map(
      serializeKnowledge,
    );
    const captureFallback: UniversalSearchResult[] = [];
    const knowledgeTextLength = knowledge.reduce(
      (total, item) => total + `${item.summary} ${item.body}`.trim().length,
      0,
    );
    const allowRawCaptureFallback =
      guidance.retrieval.rawCaptureFallback === "allowed-leads" ||
      (guidance.retrieval.rawCaptureFallback === "thin-results" &&
        (!knowledge.length || knowledgeTextLength < 260));
    if (allowRawCaptureFallback) {
      const seenCaptures = new Set<string>();
      for (const facet of facetsFromQuestion(question)) {
        const matches = await searchEverythingRows({
          query: facet,
          type: "capture",
          limit: 6,
        });
        for (const match of matches) {
          if (seenCaptures.has(match.id)) continue;
          seenCaptures.add(match.id);
          captureFallback.push(match);
        }
        if (captureFallback.length >= 4) break;
      }
    }

    if (!knowledge.length && !captureFallback.length) {
      const federatedCoverage = await federatedCoveragePromise;
      return {
        answer:
          guidance.retrieval.rawCaptureFallback === "never-answer"
            ? "I could not find enough reviewed Brain knowledge for that question yet."
            : "I could not find approved Brain knowledge or matching raw captures for that question yet.",
        citations: [],
        knowledge: [],
        captures: [],
        results: [],
        policy: guidance.retrieval,
        responseGuidance: guidance.response,
        federatedCoverage,
      };
    }

    const knowledgeCitations = knowledge.flatMap((item) =>
      item.evidence.slice(0, 2).map((evidence, index) => ({
        id: `${item.id}-${index}`,
        knowledgeId: item.id,
        title: item.title,
        sourceName: evidence.captureTitle,
        excerpt: evidence.quote,
        confidence: item.confidence / 100,
        url: evidence.sourceUrl ?? evidence.url ?? null,
        deepLink: knowledgeDeepLink(item.id),
      })),
    );
    const captureCitations = captureFallback.map((item) => ({
      id: item.id,
      captureId: item.id,
      title: item.title,
      sourceName: item.source?.title ?? item.title,
      excerpt: item.snippet,
      url: item.sourceUrl,
      deepLink: captureDeepLink(item.id),
    }));
    const answerParts = [];
    const hasCitations = knowledgeCitations.length || captureCitations.length;
    if (guidance.retrieval.requireCitations && !hasCitations) {
      const federatedCoverage = await federatedCoveragePromise;
      return {
        answer:
          "I found possible Brain context, but workspace settings require citations and these results did not include usable evidence.",
        citations: [],
        knowledge,
        captures: captureFallback,
        results: captureFallback,
        policy: guidance.retrieval,
        responseGuidance: guidance.response,
        federatedCoverage,
      };
    }
    if (knowledge.length) {
      answerParts.push(
        knowledge
          .map((item) => `${item.title}: ${item.summary || item.body}`)
          .join("\n\n"),
      );
    }
    if (captureFallback.length) {
      const prefix = knowledge.length
        ? "Related raw capture matches:"
        : "I could not find approved Brain knowledge, but I found matching raw captures:";
      answerParts.push(
        [
          prefix,
          ...captureFallback.map(
            (item) =>
              `${item.title}${item.source?.title ? ` (${item.source.title})` : ""}: ${item.snippet}`,
          ),
        ].join("\n\n"),
      );
    }

    const federatedCoverage = await federatedCoveragePromise;
    const citations = [...knowledgeCitations, ...captureCitations];
    const primary = citations[0] ?? null;
    return {
      answer: formatAnswer(answerParts.join("\n\n"), guidance),
      citations,
      deepLink: primary?.deepLink ?? null,
      knowledge,
      captures: captureFallback,
      results: captureFallback,
      policy: guidance.retrieval,
      responseGuidance: guidance.response,
      federatedCoverage,
    };
  },
  link: ({ result }) => {
    const r = result as {
      deepLink?: string | null;
      citations?: Array<{
        knowledgeId?: string;
        captureId?: string;
      }>;
    } | null;
    const url = r?.deepLink;
    if (!url) return null;
    const first = r?.citations?.[0];
    return {
      url,
      label: first?.knowledgeId
        ? "Open knowledge in Brain"
        : "Open capture in Brain",
      view: first?.knowledgeId ? "knowledge" : "capture",
    };
  },
});

function formatAnswer(
  answer: string,
  guidance: Awaited<ReturnType<typeof readBrainAgentGuidance>>["guidance"],
) {
  switch (guidance.identity.tone) {
    case "friendly":
      return `Here's what ${guidance.identity.assistantName} found:\n\n${answer}`;
    case "formal":
      return `Based on ${guidance.identity.companyName ?? "the workspace"} Brain records:\n\n${answer}`;
    case "technical":
      return `Relevant ${guidance.identity.assistantName} records:\n\n${answer}`;
    case "direct":
    default:
      return answer;
  }
}
