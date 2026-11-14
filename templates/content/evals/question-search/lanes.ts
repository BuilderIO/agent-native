import {
  reciprocalRankFusion,
  type RankedCandidate,
} from "@agent-native/core/search";

import type { CorpusDocument } from "../search-relevance/corpus.js";

/**
 * The ranking lanes the question-search bake-off compares. A lane returns
 * corpus keys, best first. Lanes other than the current search only ever see
 * the pages the searcher could open, so none of them can leak a page.
 */

export const LANE_DEPTH = 20;

// Common English words and question words, so "what document shows our Q3
// hiring plan" searches for "document shows q3 hiring plan".
const STOPWORDS = new Set(
  (
    "a about after all also am an and any are as at be been being but by can " +
    "could d did do does doing for from get got had has have how i if in " +
    "into is it its just ll m me my no nobody not of on once or our ours out " +
    "re s so some t than that the their them then there these they this " +
    "those to too up us ve was we were what when where which who whom why " +
    "will with would you your"
  ).split(" "),
);

function suffixless(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

// Dropping a final "e" too keeps "charged" ("charg") matching "charges" and
// "charge".
function stem(word: string): string {
  const base = suffixless(word);
  return base.length > 3 && base.endsWith("e") ? base.slice(0, -1) : base;
}

export function keywordTokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}

const FIELD_WEIGHTS = { title: 3, description: 2, body: 1 } as const;

/**
 * BM25 over title, description and body, weighting a title match three times
 * a body match. It needs no model: the question's own words, minus filler.
 */
export function keywordLane(
  documents: readonly CorpusDocument[],
): (query: string, searchFields?: "all" | "title") => string[] {
  const fields = documents.map((doc) => ({
    key: doc.key,
    title: keywordTokens(doc.title),
    description: keywordTokens(doc.description ?? ""),
    body: keywordTokens(doc.body),
  }));
  const frequency = new Map<string, number>();
  const titleFrequency = new Map<string, number>();
  for (const doc of fields) {
    for (const word of new Set([...doc.title, ...doc.description, ...doc.body]))
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    for (const word of new Set(doc.title))
      titleFrequency.set(word, (titleFrequency.get(word) ?? 0) + 1);
  }
  const averageOf = (length: (doc: (typeof fields)[number]) => number) =>
    fields.reduce((sum, doc) => sum + length(doc), 0) / fields.length || 1;
  const averageLength = averageOf((doc) => doc.body.length);
  const averageTitleLength = averageOf((doc) => doc.title.length);
  const k1 = 1.2;
  const b = 0.75;
  return (query, searchFields = "all") => {
    const words = [...new Set(keywordTokens(query))];
    // A title-only search scores titles alone, as search-documents does.
    const titleOnly = searchFields === "title";
    const scored = titleOnly
      ? (["title"] as const)
      : (Object.keys(FIELD_WEIGHTS) as (keyof typeof FIELD_WEIGHTS)[]);
    // Its words are weighed against titles alone, as their length is.
    const counted = titleOnly ? titleFrequency : frequency;
    const average = titleOnly ? averageTitleLength : averageLength;
    return fields
      .map((doc) => {
        let score = 0;
        for (const word of words) {
          const weighted = scored.reduce(
            (sum, field) =>
              sum +
              FIELD_WEIGHTS[field] *
                doc[field].filter((token) => token === word).length,
            0,
          );
          if (!weighted) continue;
          const containing = counted.get(word) ?? 0;
          const idf = Math.log(
            1 + (fields.length - containing + 0.5) / (containing + 0.5),
          );
          score +=
            (idf * weighted * (k1 + 1)) /
            (weighted +
              k1 *
                (1 -
                  b +
                  (b * (titleOnly ? doc.title.length : doc.body.length)) /
                    average));
        }
        return { key: doc.key, score };
      })
      .filter((doc) => doc.score > 0)
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
      .slice(0, LANE_DEPTH)
      .map((doc) => doc.key);
  };
}

const CHUNK_CHARACTERS = 1_200;

/** A page's text in chunks of about 1,200 characters, each led by its title. */
export function pageChunks(doc: CorpusDocument): string[] {
  const head = [doc.title, doc.description].filter(Boolean).join("\n");
  const sentences = doc.body.split(/(?<=[.!?。])\s+/u);
  const chunks: string[] = [];
  let chunk = "";
  for (const sentence of sentences) {
    if (chunk && chunk.length + sentence.length > CHUNK_CHARACTERS) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk = chunk ? `${chunk} ${sentence}` : sentence;
  }
  if (chunk || !chunks.length) chunks.push(chunk);
  return chunks.map((text) => `${head}\n${text}`.trim());
}

export function cosine(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length)
    throw new Error(
      `Vectors differ in length: ${left.length} and ${right.length}.`,
    );
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const others = right.values();
  for (const value of left) {
    const other = others.next().value ?? 0;
    dot += value * other;
    leftNorm += value ** 2;
    rightNorm += other ** 2;
  }
  return dot / (Math.sqrt(leftNorm * rightNorm) || 1);
}

/** Pages ranked by their closest vector to the query vector. */
export function vectorLane(
  vectors: ReadonlyMap<string, readonly number[][]>,
  query: readonly number[],
  keys: readonly string[],
): string[] {
  return keys
    .map((key) => ({
      key,
      score: Math.max(
        ...(vectors.get(key) ?? []).map((vector) => cosine(vector, query)),
      ),
    }))
    .filter((doc) => Number.isFinite(doc.score))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, LANE_DEPTH)
    .map((doc) => doc.key);
}

/** Lanes merged by reciprocal rank, as a hybrid search would. */
export function fuse(lanes: Record<string, readonly string[]>, limit = 10) {
  const ranked: Record<string, RankedCandidate<null>[]> = {};
  for (const [lane, keys] of Object.entries(lanes))
    ranked[lane] = keys.map((key) => ({ key, value: null, score: 0 }));
  return reciprocalRankFusion(ranked, { limit }).map((hit) => hit.key);
}

/** The first JSON object in a model's reply, or null. */
export function replyJson(reply: string): Record<string, unknown> | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
    // coercion-ok: null is this function's "no JSON in the reply" answer.
  } catch {
    return null;
  }
}

export const REWRITE_PROMPT =
  "You turn a question into keyword searches for a workplace document search " +
  "engine that matches every word of a search. Return JSON " +
  '{"queries": [...]} with up to three short searches of one to three words ' +
  "each, using words the answering page would likely contain. Return only " +
  "the JSON.";

export const HYDE_PROMPT =
  "Write the short passage, three or four sentences, of a company's internal " +
  "document that would answer the question. Invent plausible specifics. " +
  "Return only the passage.";

export const ENRICH_PROMPT =
  "Summarize this workplace page in two sentences, then list five questions " +
  "it answers, one per line. Return only the summary and the questions.";

export const RERANK_PROMPT =
  "You judge workplace search results. Given a question and numbered " +
  "candidate pages, return JSON " +
  '{"ranking": [...]} listing the numbers of the candidates that help answer ' +
  "the question, most useful first. Leave out candidates that don't help. " +
  "Return only the JSON.";

export function excerpt(doc: CorpusDocument, characters = 400) {
  return [doc.title, doc.description, doc.body.slice(0, characters)]
    .filter(Boolean)
    .join(" — ");
}
