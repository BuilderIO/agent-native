/**
 * Typed codes the action boundary emits for expected user states, shared so
 * the server classification and the client retry policy cannot drift.
 */
export const LLM_PROVIDER_MISSING_ERROR_CODE = "llm_provider_missing";

/** 424 Failed Dependency: the request needs an LLM provider that is not connected. */
export const LLM_PROVIDER_MISSING_STATUS = 424;
