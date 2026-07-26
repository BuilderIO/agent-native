/**
 * Sentinel marking the end of the cacheable STABLE system-prompt prefix.
 *
 * Zero-width on purpose: engines that do not split the system prompt forward
 * it to the model verbatim, so anything visible here would leak into their
 * rendered prompt.
 */
export const SYSTEM_PROMPT_CACHE_SPLIT = "\u200b";

/**
 * Split an assembled system prompt into the stable prefix (which carries the
 * cache breakpoint) and the volatile remainder (resources, app extras, model
 * overlay, runtime context). Without a sentinel the whole prompt is stable.
 */
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

/**
 * Cache control for the stable prefix (system prompt + tool definitions).
 *
 * Anthropic's default ephemeral entry lives 5 minutes. Measured hosted chunk
 * boundaries sit ~6 minutes apart on average with a quarter of them past 5
 * minutes, so the default expires between chunks and the whole prefix is
 * re-written at full price. A 1h entry costs 2x to write and 0.1x to read,
 * which is net positive at that boundary rate. Set
 * `AGENT_PROMPT_CACHE_TTL=5m` to fall back to the default if a gateway ever
 * rejects the `ttl` field.
 */
export function stablePrefixCacheControl(): PromptCacheControl {
  return process.env.AGENT_PROMPT_CACHE_TTL === "5m"
    ? { type: "ephemeral" }
    : { type: "ephemeral", ttl: "1h" };
}
