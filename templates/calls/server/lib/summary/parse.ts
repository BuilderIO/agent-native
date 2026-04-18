import type { CallSummary } from "../../../shared/api.js";

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```[a-zA-Z0-9]*\n?/, "");
    s = s.replace(/\n?```\s*$/, "");
  }
  return s.trim();
}

function extractJsonObject(raw: string): string | null {
  const stripped = stripFences(raw);
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  return stripped.slice(first, last + 1);
}

function toOptionalString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function toString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function toOptionalNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return undefined;
}

function toNumber(v: unknown): number {
  return toOptionalNumber(v) ?? 0;
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parseKeyPoints(raw: unknown): CallSummary["keyPoints"] {
  return toArray(raw)
    .map((item): CallSummary["keyPoints"][number] | null => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const text = toString(r.text);
      if (!text) return null;
      const point: CallSummary["keyPoints"][number] = { text };
      const quoteMs = toOptionalNumber(r.quoteMs);
      if (quoteMs !== undefined) point.quoteMs = quoteMs;
      return point;
    })
    .filter((x): x is CallSummary["keyPoints"][number] => x !== null);
}

function parseNextSteps(raw: unknown): CallSummary["nextSteps"] {
  return toArray(raw)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const text = toString(r.text);
      if (!text) return null;
      const step: CallSummary["nextSteps"][number] = { text };
      const owner = toOptionalString(r.owner);
      if (owner) step.owner = owner;
      const dueAt = toOptionalString(r.dueAt);
      if (dueAt) step.dueAt = dueAt;
      const quoteMs = toOptionalNumber(r.quoteMs);
      if (quoteMs !== undefined) step.quoteMs = quoteMs;
      return step;
    })
    .filter((x): x is CallSummary["nextSteps"][number] => x !== null);
}

function parseTopics(raw: unknown): CallSummary["topics"] {
  return toArray(raw)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const title = toString(r.title);
      if (!title) return null;
      const startMs = toNumber(r.startMs);
      const endMs = toOptionalNumber(r.endMs);
      const topic: CallSummary["topics"][number] = { title, startMs };
      if (endMs !== undefined) topic.endMs = endMs;
      return topic;
    })
    .filter((x): x is CallSummary["topics"][number] => x !== null);
}

function parseQuestions(raw: unknown): CallSummary["questions"] {
  return toArray(raw)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const text = toString(r.text);
      if (!text) return null;
      const q: CallSummary["questions"][number] = {
        text,
        ms: toNumber(r.ms),
      };
      const askedByLabel = toOptionalString(r.askedByLabel);
      if (askedByLabel) q.askedByLabel = askedByLabel;
      return q;
    })
    .filter((x): x is CallSummary["questions"][number] => x !== null);
}

function parseActionItems(raw: unknown): CallSummary["actionItems"] {
  return toArray(raw)
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const r = item as Record<string, unknown>;
      const text = toString(r.text);
      if (!text) return null;
      const ai: CallSummary["actionItems"][number] = { text };
      const owner = toOptionalString(r.owner);
      if (owner) ai.owner = owner;
      const ms = toOptionalNumber(r.ms);
      if (ms !== undefined) ai.ms = ms;
      return ai;
    })
    .filter((x): x is CallSummary["actionItems"][number] => x !== null);
}

function parseSentiment(raw: unknown): CallSummary["sentiment"] {
  if (raw === "positive" || raw === "neutral" || raw === "negative") return raw;
  return undefined;
}

export function parseSummaryJson(raw: string): CallSummary | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const r = parsed as Record<string, unknown>;
  const summary: CallSummary = {
    recap: toString(r.recap),
    keyPoints: parseKeyPoints(r.keyPoints),
    nextSteps: parseNextSteps(r.nextSteps),
    topics: parseTopics(r.topics),
    questions: parseQuestions(r.questions),
    actionItems: parseActionItems(r.actionItems),
  };
  const sentiment = parseSentiment(r.sentiment);
  if (sentiment) summary.sentiment = sentiment;

  return summary;
}
