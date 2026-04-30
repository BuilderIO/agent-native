/**
 * The framework-wide default model.
 *
 * One place to bump the default when a new Claude model ships. Everything
 * that needs a default model fallback (agent chat, A2A handler, integration
 * agent, MCP askAgent, etc.) imports this constant — there are no hardcoded
 * model ID literals scattered across the codebase.
 *
 * Templates and apps can still override per-call by passing `model: "..."`
 * in their plugin options; this is just the value used when no override is
 * provided.
 *
 * Why sonnet (not haiku): the agent makes user-facing decisions (URLs, IDs,
 * delegated answers). Haiku is fast and cheap but hallucinates slugs and
 * paths in user-facing text often enough that we hit it during normal use
 * (e.g. a Slack reply with a deck URL pointing to a host that doesn't exist).
 * Sonnet's accuracy at the same task is dramatically better and the latency
 * cost is acceptable for the cross-app A2A path.
 */
export const DEFAULT_MODEL = "claude-sonnet-4-6";
