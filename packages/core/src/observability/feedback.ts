import { getDbExec } from "../db/client.js";
import type {
  FeedbackEntry,
  FeedbackType,
  SatisfactionScore,
} from "./types.js";
import {
  insertFeedback,
  upsertSatisfactionScore,
  ensureObservabilityTables,
} from "./store.js";

function generateId(): string {
  return `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Feedback submission ────────────────────────────────────────────

export interface SubmitFeedbackOpts {
  threadId: string;
  runId?: string;
  messageSeq?: number;
  feedbackType: FeedbackType;
  value?: string;
  userId?: string;
}

export async function submitFeedback(
  opts: SubmitFeedbackOpts,
): Promise<FeedbackEntry> {
  if (!opts.threadId) throw new Error("threadId is required");
  if (!opts.feedbackType) throw new Error("feedbackType is required");

  const validTypes: FeedbackType[] = [
    "thumbs_up",
    "thumbs_down",
    "category",
    "text",
  ];
  if (!validTypes.includes(opts.feedbackType)) {
    throw new Error(`Invalid feedbackType: ${opts.feedbackType}`);
  }

  const entry: FeedbackEntry = {
    id: generateId(),
    runId: opts.runId ?? null,
    threadId: opts.threadId,
    messageSeq: opts.messageSeq ?? null,
    feedbackType: opts.feedbackType,
    value: opts.value ?? "",
    userId: opts.userId ?? null,
    createdAt: Date.now(),
  };

  await insertFeedback(entry);
  return entry;
}

// ─── Satisfaction scoring ───────────────────────────────────────────

interface ThreadMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
}

async function getThreadMessages(threadId: string): Promise<ThreadMessage[]> {
  await ensureObservabilityTables();
  const client = getDbExec();

  const { rows } = await client.execute({
    sql: `SELECT thread_data FROM chat_threads WHERE id = ?`,
    args: [threadId],
  });

  if (rows.length === 0) return [];

  const raw = (rows[0] as Record<string, unknown>).thread_data;
  if (!raw) return [];

  try {
    const data = JSON.parse(String(raw));
    const messages: unknown[] = data.messages ?? data;
    if (!Array.isArray(messages)) return [];

    return messages
      .filter(
        (m: any) =>
          m &&
          typeof m.role === "string" &&
          (typeof m.content === "string" ||
            (Array.isArray(m.content) &&
              m.content.some((p: any) => p.type === "text"))),
      )
      .map((m: any) => ({
        role: m.role as "user" | "assistant",
        content:
          typeof m.content === "string"
            ? m.content
            : (m.content as any[])
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text ?? "")
                .join(""),
        createdAt: m.createdAt ? Number(m.createdAt) : undefined,
      }));
  } catch {
    return [];
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function computeRephrasingScore(userMessages: string[]): number {
  if (userMessages.length < 2) return 0;

  const tokenSets = userMessages.map(tokenize);
  let maxConsecutiveSimilarity = 0;
  let highSimilarityCount = 0;

  for (let i = 1; i < tokenSets.length; i++) {
    const sim = jaccardSimilarity(tokenSets[i - 1], tokenSets[i]);
    if (sim > maxConsecutiveSimilarity) maxConsecutiveSimilarity = sim;
    if (sim >= 0.4) highSimilarityCount++;
  }

  const pairCount = tokenSets.length - 1;
  const rephrasingRatio = pairCount > 0 ? highSimilarityCount / pairCount : 0;

  // Blend peak similarity with overall rephrasing frequency
  return Math.min(
    100,
    ((maxConsecutiveSimilarity * 60 + rephrasingRatio * 40) * 100) / 100,
  );
}

function computeAbandonmentScore(messages: ThreadMessage[]): number {
  if (messages.length === 0) return 0;

  const last = messages[messages.length - 1];

  // Thread ends with a user message and no agent response
  if (last.role === "user") return 80;

  // Thread ends with agent response, but check if last user message
  // was very close to it (agent responded but user never replied back)
  if (messages.length >= 3) {
    const secondToLast = messages[messages.length - 2];
    if (secondToLast.role === "user") {
      const userMsg = secondToLast.content.trim();
      // Short user messages right before end suggest giving up
      if (userMsg.length < 15) return 40;
    }
  }

  return 0;
}

const NEGATIVE_PATTERNS = [
  /\bno\b/i,
  /\bwrong\b/i,
  /\bnot what i/i,
  /\btry again\b/i,
  /\bnever mind\b/i,
  /\bnevermind\b/i,
  /\bthat's not\b/i,
  /\bthats not\b/i,
  /\bincorrect\b/i,
  /\bdoesn't work\b/i,
  /\bdoesnt work\b/i,
  /\bstill wrong\b/i,
  /\bnope\b/i,
  /\bstop\b/i,
  /\bforget it\b/i,
  /\buseless\b/i,
  /\bbroken\b/i,
];

function computeSentimentScore(userMessages: string[]): number {
  if (userMessages.length === 0) return 0;

  let negativeCount = 0;
  let terseCount = 0;

  for (const msg of userMessages) {
    const trimmed = msg.trim();

    // Terse single-word or very short responses
    if (trimmed.split(/\s+/).length <= 2 && trimmed.length < 20) {
      terseCount++;
    }

    for (const pattern of NEGATIVE_PATTERNS) {
      if (pattern.test(trimmed)) {
        negativeCount++;
        break;
      }
    }
  }

  const negativeRatio = negativeCount / userMessages.length;
  const terseRatio = terseCount / userMessages.length;

  return Math.min(100, (negativeRatio * 70 + terseRatio * 30) * 100);
}

function computeLengthTrendScore(userMessages: string[]): number {
  if (userMessages.length < 3) return 0;

  const lengths = userMessages.map((m) => m.trim().length);
  const n = lengths.length;

  // Simple linear regression: y = mx + b, we care about slope m
  const xMean = (n - 1) / 2;
  const yMean = lengths.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const xDiff = i - xMean;
    numerator += xDiff * (lengths[i] - yMean);
    denominator += xDiff * xDiff;
  }

  if (denominator === 0) return 0;

  const slope = numerator / denominator;

  // Normalize: negative slope = messages getting shorter = frustration
  // Scale by average length to get a relative measure
  if (yMean === 0) return 0;
  const normalizedSlope = slope / yMean;

  // Only negative slopes (shrinking messages) contribute to frustration
  if (normalizedSlope >= 0) return 0;

  // Map normalized slope to 0-100; -1 (halving each message) = 100
  return Math.min(100, Math.abs(normalizedSlope) * 100);
}

const RETRY_PATTERNS = [
  /\btry again\b/i,
  /\bthat's wrong\b/i,
  /\bthats wrong\b/i,
  /\bno,?\s*(that's|thats|it's|its)\b/i,
  /\bredo\b/i,
  /\bdo it again\b/i,
  /\bone more time\b/i,
  /\bregenerate\b/i,
  /\bfix (it|this|that)\b/i,
  /\btry (this|that) instead\b/i,
  /\bi (said|meant|asked)\b/i,
  /\bstill (not|wrong|broken|doesn't|doesnt)\b/i,
];

function computeRetryScore(userMessages: string[]): number {
  if (userMessages.length === 0) return 0;

  let retryCount = 0;
  for (const msg of userMessages) {
    for (const pattern of RETRY_PATTERNS) {
      if (pattern.test(msg)) {
        retryCount++;
        break;
      }
    }
  }

  const retryRatio = retryCount / userMessages.length;
  return Math.min(100, retryRatio * 150);
}

export async function computeSatisfactionScore(
  threadId: string,
): Promise<SatisfactionScore> {
  const messages = await getThreadMessages(threadId);
  const userMessages = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content);

  const rephrasingScore = computeRephrasingScore(userMessages);
  const abandonmentScore = computeAbandonmentScore(messages);
  const sentimentScore = computeSentimentScore(userMessages);
  const lengthTrendScore = computeLengthTrendScore(userMessages);
  const retryScore = computeRetryScore(userMessages);

  // Weighted composite: rephrasing 30, abandonment 20, sentiment 15, length trend 15, retry 20
  const frustrationScore = Math.min(
    100,
    rephrasingScore * 0.3 +
      abandonmentScore * 0.2 +
      sentimentScore * 0.15 +
      lengthTrendScore * 0.15 +
      retryScore * 0.2,
  );

  const score: SatisfactionScore = {
    id: `sat-${threadId}`,
    threadId,
    frustrationScore: Math.round(frustrationScore * 100) / 100,
    rephrasingScore: Math.round(rephrasingScore * 100) / 100,
    abandonmentScore: Math.round(abandonmentScore * 100) / 100,
    sentimentScore: Math.round(sentimentScore * 100) / 100,
    lengthTrendScore: Math.round(lengthTrendScore * 100) / 100,
    computedAt: Date.now(),
  };

  await upsertSatisfactionScore(score);
  return score;
}
