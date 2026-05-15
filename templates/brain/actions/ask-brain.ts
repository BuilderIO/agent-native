import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  searchKnowledgeRows,
  serializeKnowledge,
} from "../server/lib/brain.js";

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
    "Answer a company-memory question from published Brain knowledge with citations.",
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
    if (!knowledge.length) {
      return {
        answer:
          "I could not find approved Brain knowledge for that question yet.",
        citations: [],
        knowledge: [],
      };
    }

    const citations = knowledge.flatMap((item) =>
      item.evidence.slice(0, 2).map((evidence, index) => ({
        id: `${item.id}-${index}`,
        title: item.title,
        sourceName: evidence.captureTitle,
        excerpt: evidence.quote,
        confidence: item.confidence / 100,
        url: evidence.sourceUrl ?? evidence.url ?? null,
      })),
    );

    return {
      answer: knowledge
        .map((item) => `${item.title}: ${item.summary || item.body}`)
        .join("\n\n"),
      citations,
      knowledge,
    };
  },
});
