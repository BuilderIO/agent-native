export const SYSTEM_PROMPT_CACHE_SPLIT = "\u200b";

export function splitSystemPromptForCache(systemPrompt: string): {
  stable: string;
  volatile: string;
} {
  const at = systemPrompt.indexOf(SYSTEM_PROMPT_CACHE_SPLIT);
  if (at < 0) return { stable: systemPrompt, volatile: "" };
  return {
    stable: systemPrompt.slice(0, at),
    volatile: systemPrompt.slice(at + SYSTEM_PROMPT_CACHE_SPLIT.length),
  };
}

export type PromptCacheControl = { type: "ephemeral"; ttl?: "1h" };

export function stablePrefixCacheControl(): PromptCacheControl {
  return process.env.AGENT_PROMPT_CACHE_TTL === "1h"
    ? { type: "ephemeral", ttl: "1h" }
    : { type: "ephemeral" };
}
