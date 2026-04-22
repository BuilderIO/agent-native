/**
 * Haiku-based natural-language condition evaluator.
 *
 * Given an event payload and a natural-language condition string, asks
 * Haiku whether the condition is satisfied. Results are memoized to
 * avoid redundant API calls for identical (condition, payload) pairs.
 */

import { createHash } from "node:crypto";

// LRU cache: hash → { result: boolean, expiresAt: number }
const _cache = new Map<string, { result: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 500;

function cacheKey(condition: string, payload: unknown): string {
  const raw = JSON.stringify({ condition, payload });
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function pruneCache(): void {
  if (_cache.size <= MAX_CACHE_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of _cache) {
    if (entry.expiresAt < now) _cache.delete(key);
  }
  // If still too large, drop oldest entries
  if (_cache.size > MAX_CACHE_SIZE) {
    const excess = _cache.size - MAX_CACHE_SIZE;
    let deleted = 0;
    for (const key of _cache.keys()) {
      if (deleted >= excess) break;
      _cache.delete(key);
      deleted++;
    }
  }
}

/**
 * Evaluate whether a natural-language condition matches an event payload.
 * Returns true if the condition is empty/undefined (unconditional trigger).
 */
export async function evaluateCondition(
  condition: string | undefined,
  payload: unknown,
  apiKey: string,
): Promise<boolean> {
  if (!condition || !condition.trim()) return true;

  const key = cacheKey(condition, payload);
  const cached = _cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const result = await callHaikuClassifier(condition, payload, apiKey);

  pruneCache();
  _cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

async function callHaikuClassifier(
  condition: string,
  payload: unknown,
  apiKey: string,
): Promise<boolean> {
  let payloadStr: string;
  try {
    payloadStr = JSON.stringify(payload, null, 2);
    if (payloadStr.length > 4000) {
      payloadStr = payloadStr.slice(0, 4000) + "\n... (truncated)";
    }
  } catch {
    payloadStr = String(payload);
  }

  const prompt = `You are a condition evaluator. Given an event payload and a natural-language condition, determine if the condition is satisfied.

Event payload:
${payloadStr}

Condition: "${condition}"

Does the event payload satisfy this condition? Respond with ONLY "yes" or "no".`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 10,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error(
        `[triggers] Condition eval failed: ${res.status} ${res.statusText}`,
      );
      return false;
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const text =
      data.content
        ?.find((b) => b.type === "text")
        ?.text?.trim()
        .toLowerCase() ?? "";
    return text.startsWith("yes");
  } catch (err) {
    console.error("[triggers] Condition eval error:", err);
    return false;
  }
}

/** Clear the condition cache (for testing). */
export function __clearConditionCache(): void {
  _cache.clear();
}
