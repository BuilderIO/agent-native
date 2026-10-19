/**
 * Typed codes the action boundary emits for expected user states, shared so
 * the server classification and the client retry policy cannot drift.
 */
export const LLM_PROVIDER_MISSING_ERROR_CODE = "llm_provider_missing";

/** 424 Failed Dependency: the request needs an LLM provider that is not connected. */
export const LLM_PROVIDER_MISSING_STATUS = 424;

/**
 * 403: the call needs proof it came from the app's signed-in UI. The browser
 * client mints its UI capability and retries once on this code.
 */
export const UI_CAPABILITY_REQUIRED_ERROR_CODE = "ui_capability_required";
