import { PROVIDER_ENV_VARS } from "./provider-env-vars.js";

export const LLM_MISSING_CREDENTIALS_ERROR_CODE = "missing_credentials";

/**
 * Set by {@link ../../server/credential-provider.js CredentialStoreUnavailableError}
 * when the credential store could not be read. Lives here so the classifier can
 * recognize it without importing server-only code into the browser bundle.
 */
export const CREDENTIAL_STORE_UNAVAILABLE_ERROR_CODE =
  "credential_store_unavailable";

export const LLM_MISSING_CREDENTIALS_MESSAGE =
  "No LLM provider is connected. Open this app's Manage agent > LLM, then connect Builder.io (free tier available) or add a provider key.";

const LLM_CREDENTIAL_KEYS = new Set([
  ...PROVIDER_ENV_VARS,
  "BUILDER_PRIVATE_KEY",
  "BUILDER_PUBLIC_KEY",
]);

const MISSING_CREDENTIAL_PATTERNS = [
  /\b(?:llm|model provider|ai engine)\b.*\b(?:missing|not set|not configured|required|connected)\b/i,
  /\b(?:missing|not set|not configured|required|connected)\b.*\b(?:llm|model provider|ai engine)\b/i,
  /\b(?:llm|model provider|ai engine)\b.*\b(?:api\s*key|credential|credentials|provider key)\b/i,
  /\b(?:api\s*key|credential|credentials|provider key)\b.*\b(?:llm|model provider|ai engine)\b/i,
];

export function isLlmCredentialError(
  error: unknown,
  errorCode?: string | null,
): boolean {
  const code =
    errorCode ??
    (typeof error === "object" && error && "errorCode" in error
      ? String((error as { errorCode?: unknown }).errorCode ?? "")
      : "");
  if (code === LLM_MISSING_CREDENTIALS_ERROR_CODE) return true;
  // "We could not read the credential store" is a retryable failure, not a
  // setup problem. Telling this user to connect a provider is the bug.
  if (code === CREDENTIAL_STORE_UNAVAILABLE_ERROR_CODE) return false;

  const message = getErrorMessage(error);
  if (!message) return false;

  const mentionsKnownLlmCredential = [...LLM_CREDENTIAL_KEYS].some((key) =>
    message.includes(key),
  );
  if (mentionsKnownLlmCredential) return true;

  return MISSING_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(message));
}

export function formatLlmCredentialErrorMessage(options?: {
  agentName?: string;
}): string {
  const agentName = options?.agentName?.trim();
  if (agentName) {
    return `The ${agentName} agent could not finish this request because that app needs an LLM connection. Open ${agentName}'s Manage agent > LLM, then connect Builder.io (free tier available) or add a provider key.`;
  }
  return LLM_MISSING_CREDENTIALS_MESSAGE;
}

export function userFacingLlmCredentialError(
  error: unknown,
  options?: { agentName?: string },
): string | null {
  return isLlmCredentialError(error)
    ? formatLlmCredentialErrorMessage(options)
    : null;
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return "";
}
