import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  searchKnowledgeRows,
  serializeKnowledge,
} from "../server/lib/brain.js";
import {
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

export default defineAction({
  description:
    "Answer a company-memory question from published Brain knowledge, falling back to cited raw capture matches when approved knowledge is thin.",
  schema: z.object({
    question: z.string().min(1),
    mode: z.enum(["cited"]).default("cited"),
    filters: z.record(z.string(), z.string()).optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ question }) => {
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
    const knowledge = rows.map(serializeKnowledge);
    const captureFallback: UniversalSearchResult[] = [];
    const knowledgeTextLength = knowledge.reduce(
      (total, item) => total + `${item.summary} ${item.body}`.trim().length,
      0,
    );
    if (!knowledge.length || knowledgeTextLength < 260) {
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
      return {
        answer:
          "I could not find approved Brain knowledge or matching raw captures for that question yet.",
        citations: [],
        knowledge: [],
        captures: [],
        results: [],
      };
    }

    const knowledgeCitations = knowledge.flatMap((item) =>
      item.evidence.slice(0, 2).map((evidence, index) => ({
        id: `${item.id}-${index}`,
        title: item.title,
        sourceName: evidence.captureTitle,
        excerpt: evidence.quote,
        confidence: item.confidence / 100,
        url: evidence.sourceUrl ?? evidence.url ?? null,
      })),
    );
    const captureCitations = captureFallback.map((item) => ({
      id: item.id,
      title: item.title,
      sourceName: item.source?.title ?? item.title,
      excerpt: item.snippet,
      url: item.sourceUrl,
    }));
    const answerParts = [];
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

    return {
      answer: answerParts.join("\n\n"),
      citations: [...knowledgeCitations, ...captureCitations],
      knowledge,
      captures: captureFallback,
      results: captureFallback,
    };
  },
});
