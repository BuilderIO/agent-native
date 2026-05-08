/**
 * The framework-wide default model for the managed Builder gateway.
 *
 * Builder gateway public model IDs use hyphenated version numbers. Direct
 * provider SDKs can use provider-native IDs, so keep those in separate
 * constants below.
 *
 * Templates and apps can still override per-call by passing `model: "..."`
 * in their plugin options; this is just the value used when no override is
 * provided.
 */
export const DEFAULT_MODEL = "gpt-5-5";

/**
 * Provider-native IDs for direct BYOK engines. These must stay valid for
 * their provider even when the framework-wide managed default changes.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-5.5";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
