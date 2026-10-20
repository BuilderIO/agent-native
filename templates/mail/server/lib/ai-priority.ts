import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  AI_PRIORITY_MAX_EMAILS,
  aiPriorityEmailKey,
  aiPriorityScoreSchema,
  type AiPriorityScore,
} from "../../shared/ai-priority.js";

const AI_PRIORITY_CACHE_KEY = "ai-priority-cache";

const cacheEntrySchema = aiPriorityScoreSchema.extend({
  fingerprint: z.string().length(64),
  instructionKey: z.string().length(64),
  evaluatedAt: z.number().int().nonnegative(),
});

const cacheSchema = z.object({
  entries: z.array(cacheEntrySchema).max(AI_PRIORITY_MAX_EMAILS),
  model: z
    .object({
      engine: z.string().optional(),
      model: z.string().optional(),
    })
    .nullable(),
});

export type AiPriorityCacheEntry = z.infer<typeof cacheEntrySchema>;
export type AiPriorityCache = z.infer<typeof cacheSchema>;

export function createEmptyAiPriorityCache(): AiPriorityCache {
  return { entries: [], model: null };
}

export async function getAiPriorityCache(
  ownerEmail: string,
): Promise<AiPriorityCache> {
  const stored = await getUserSetting(ownerEmail, AI_PRIORITY_CACHE_KEY);
  if (stored === undefined || stored === null) {
    return createEmptyAiPriorityCache();
  }
  const parsed = cacheSchema.safeParse(stored);
  if (!parsed.success) {
    throw new Error(
      "AI priority cache is unreadable; run Priority sort again to rebuild it.",
    );
  }
  return parsed.data;
}

export async function saveAiPriorityCache(
  ownerEmail: string,
  cache: AiPriorityCache,
): Promise<AiPriorityCache> {
  const parsed = cacheSchema.safeParse(cache);
  if (!parsed.success) throw new Error("Invalid AI priority cache.");
  await putUserSetting(ownerEmail, AI_PRIORITY_CACHE_KEY, parsed.data);
  return parsed.data;
}

export function getCachedPriorityScores(
  cache: AiPriorityCache,
  emails: ReadonlyArray<{
    id: string;
    accountEmail?: string;
    fingerprint: string;
  }>,
  instructionKey: string,
): Map<string, AiPriorityScore> {
  const entriesById = new Map(
    cache.entries
      .filter((entry) => entry.instructionKey === instructionKey)
      .map((entry) => [
        aiPriorityEmailKey(entry.accountEmail, entry.emailId),
        entry,
      ]),
  );
  return new Map(
    emails.flatMap((email) => {
      const key = aiPriorityEmailKey(email.accountEmail, email.id);
      const entry = entriesById.get(key);
      return entry && entry.fingerprint === email.fingerprint
        ? [
            [
              key,
              {
                emailId: entry.emailId,
                ...(entry.accountEmail
                  ? { accountEmail: entry.accountEmail }
                  : {}),
                score: entry.score,
                reason: entry.reason,
              },
            ] as const,
          ]
        : [];
    }),
  );
}

export function mergePriorityCache(
  cache: AiPriorityCache,
  entries: AiPriorityCacheEntry[],
  model: AiPriorityCache["model"],
): AiPriorityCache {
  if (entries.length === 0) return cache;
  const instructionKey = entries[0].instructionKey;
  const byId = new Map(
    cache.entries
      .filter((entry) => entry.instructionKey === instructionKey)
      .map((entry) => [
        aiPriorityEmailKey(entry.accountEmail, entry.emailId),
        entry,
      ]),
  );
  for (const entry of entries) {
    byId.set(aiPriorityEmailKey(entry.accountEmail, entry.emailId), entry);
  }
  return {
    entries: [...byId.values()]
      .sort((a, b) => b.evaluatedAt - a.evaluatedAt)
      .slice(0, AI_PRIORITY_MAX_EMAILS),
    model,
  };
}
