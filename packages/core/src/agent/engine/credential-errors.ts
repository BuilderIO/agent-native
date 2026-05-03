import { PROVIDER_ENV_VARS } from "./provider-env-vars.js";

export const LLM_MISSING_CREDENTIALS_ERROR_CODE = "missing_credentials";

export const LLM_MISSING_CREDENTIALS_MESSAGE =
  "No LLM provider is connected. Connect an LLM provider or Builder, then try again.";

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
    return `The ${agentName} agent could not finish this request because that app needs an LLM connection. Connect an LLM provider or Builder for the ${agentName} app, then try again.`;
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
