/**
 * Append a Builder CTA markdown link to gateway errors that users can fix
 * outside the app. Used by both
 * chat SSE consumers (`sse-event-processor.ts` and `useProductionAgent.ts`)
 * to keep the copy in lockstep.
 *
 * `upgradeUrl` comes from the gateway response body and ends up interpolated
 * into markdown, so we validate it's a plain https URL with no characters
 * that would escape the `[...](url)` link target. Only `)` and whitespace
 * terminate the link target — `(`, `<`, `>` are fine inside it — so the
 * regex stays narrow; the gateway may emit URLs containing `(`
 * (e.g. `?ref=Acme%20(staging)`) and we don't want to reject them.
 */
export const BUILDER_SPACE_SETTINGS_URL =
  "https://builder.io/account/space?utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=space_settings";

// Pseudo-href used to mark an in-app "Start new chat" CTA inside the markdown
// error message. The chat renderer intercepts this href and renders a button
// that dispatches the `agent-native:new-chat` CustomEvent instead of navigating.
export const NEW_CHAT_ACTION_HREF = "agent-native:new-chat";
const OPEN_BUILDER_SPACE_SETTINGS_LABEL = "Open Builder space settings";
const START_NEW_CHAT_LABEL = "Start new chat";
const UPGRADE_AT_BUILDER_LABEL = "Upgrade at builder.io";

function isSafeUpgradeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return !/[\s)]/.test(url);
  } catch {
    return false;
  }
}

export function formatChatErrorText(
  errorMessage: string,
  upgradeUrl?: string,
  errorCode?: string,
): string {
  const normalized = normalizeChatError(errorMessage, errorCode);
  if (
    errorCode === "gateway_not_enabled" ||
    /space has not enabled the LLM gateway/i.test(normalized.message)
  ) {
    return `Error: ${normalized.message}\n\n[${OPEN_BUILDER_SPACE_SETTINGS_LABEL}](${BUILDER_SPACE_SETTINGS_URL})`;
  }
  if (errorCode === "builder_gateway_error") {
    return `Error: ${normalized.message}\n\n[${START_NEW_CHAT_LABEL}](${NEW_CHAT_ACTION_HREF})`;
  }
  if (
    errorCode === "context_length_exceeded" ||
    errorCode === "input_too_long"
  ) {
    return `Error: ${normalized.message}\n\n[${START_NEW_CHAT_LABEL}](${NEW_CHAT_ACTION_HREF})`;
  }
  if (!upgradeUrl || !isSafeUpgradeUrl(upgradeUrl)) {
    return `Error: ${normalized.message}`;
  }
  return `Error: ${normalized.message}\n\n[${UPGRADE_AT_BUILDER_LABEL}](${upgradeUrl})`;
}

export interface NormalizedChatError {
  message: string;
  details?: string;
}

type ErrorTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

const KNOWN_CHAT_ERROR_KEYS = new Map<string, string>([
  [
    "No LLM provider is connected. Open this app's Manage agent > LLM, then connect Builder.io or add a provider key.",
    "agentChat.errorMessages.noProviderConnected",
  ],
  [
    "The provider behind this model rejected the request. Pick a different model, then retry.",
    "agentChat.errorMessages.builderModelUnauthorized",
  ],
  [
    "Builder rejected the connected credentials. Reconnect Builder.io in Settings, then retry.",
    "agentChat.errorMessages.builderAuthentication",
  ],
  [
    "This model can't use tools with the current settings. Switch models in Settings, then retry.",
    "agentChat.errorMessages.providerConfiguration",
  ],
  [
    "The model provider is rate-limiting this chat right now. Wait a moment, then retry.",
    "agentChat.errorMessages.providerRateLimit",
  ],
  [
    "The model provider rejected the saved API key. Update the key in Settings → Integrations → API keys, then retry.",
    "agentChat.errorMessages.providerAuthentication",
  ],
  [
    "The model provider could not be reached. Check your connection and retry.",
    "agentChat.errorMessages.providerNetwork",
  ],
  [
    "The agent connection was interrupted. Check your connection and retry.",
    "agentChat.errorMessages.agentConnection",
  ],
  [
    "The model gateway returned no error details and the chat couldn't recover. Wait a moment and retry, or start a new chat if it keeps happening.",
    "agentChat.errorMessages.gatewayNoDetails",
  ],
  [
    "The agent connection timed out before it could finish. You can continue from the partial work or retry.",
    "agentChat.errorMessages.inactivityTimeout",
  ],
  [
    "A tool schema was invalid, so the model rejected the request before it started. The invalid tool can be skipped and the request retried.",
    "agentChat.errorMessages.invalidToolSchema",
  ],
  [
    "The provider returned an HTML error page.",
    "agentChat.errorMessages.providerHtml",
  ],
]);

const KNOWN_CHAT_ERROR_ACTION_KEYS = new Map<string, string>([
  [
    "Open Builder space settings",
    "agentChat.errorMessages.openBuilderSpaceSettings",
  ],
  ["Start new chat", "agentChat.errorMessages.startNewChat"],
  ["Upgrade at builder.io", "agentChat.errorMessages.upgradeAtBuilder"],
]);

/** Localize only Core's own normalized error copy; preserve provider details. */
export function localizeKnownChatErrorText(
  text: string,
  t: ErrorTranslate,
): string {
  const newlineIndex = text.indexOf("\n");
  const firstLine = newlineIndex >= 0 ? text.slice(0, newlineIndex) : text;
  const suffix = newlineIndex >= 0 ? text.slice(newlineIndex) : "";
  const hasPrefix = firstLine.startsWith("Error: ");
  const message = hasPrefix ? firstLine.slice("Error: ".length) : firstLine;
  const key = KNOWN_CHAT_ERROR_KEYS.get(message);
  let localizedFirstLine = firstLine;
  if (key) {
    const translated = t(key, { defaultValue: message });
    localizedFirstLine = hasPrefix
      ? t("agentChat.errorMessages.errorPrefix", {
          defaultValue: "Error: {{message}}",
          message: translated,
        })
      : translated;
  }
  const localizedSuffix = suffix.replace(
    /\[([^\]]+)]\(([^)]+)\)/g,
    (link, label: string, href: string) => {
      const actionKey = KNOWN_CHAT_ERROR_ACTION_KEYS.get(label);
      if (!actionKey) return link;
      return `[${t(actionKey, { defaultValue: label })}](${href})`;
    },
  );
  return `${localizedFirstLine}${localizedSuffix}`;
}

function normalizeErrorCode(errorCode?: string): string {
  return String(errorCode ?? "")
    .trim()
    .toLowerCase();
}

function isProviderRateLimit(text: string, errorCode?: string): boolean {
  const code = normalizeErrorCode(errorCode);
  return (
    code === "provider_rate_limited" ||
    code === "http_429" ||
    code === "rate_limited" ||
    code === "rate_limit_exceeded" ||
    /^429 status code(?:\s*\(no body\))?$/i.test(text) ||
    /\b(?:http\s*)?429\b.*\b(?:status|too many requests|rate[-_\s]?limit|no body)\b/i.test(
      text,
    ) ||
    /\b(?:too many requests|rate[-_\s]?limit(?:ed| exceeded)?)\b/i.test(text)
  );
}

export function isProviderAuthenticationError(
  text: string,
  errorCode?: string,
): boolean {
  const code = normalizeErrorCode(errorCode);
  const lower = text.toLowerCase();
  return (
    code === "authentication_error" ||
    code === "http_401" ||
    /^401 status code(?:\s*\(no body\))?$/i.test(text) ||
    /\b(?:http\s*)?401\b.*\b(?:status|unauthorized|authentication|auth|no body)\b/i.test(
      text,
    ) ||
    lower.includes("missing authentication header") ||
    lower.includes("invalid x-api-key") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("api key is invalid") ||
    lower.includes("rejected the saved api key") ||
    lower.includes("saved provider key was rejected") ||
    (lower.includes("authentication_error") && lower.includes("api"))
  );
}

function isConnectionError(text: string, errorCode?: string): boolean {
  const code = normalizeErrorCode(errorCode);
  return (
    code === "provider_network_error" ||
    code === "connection_error" ||
    code === "network_error" ||
    /^(?:provider_network_error|connection_error|network_error)$/i.test(
      text.trim(),
    )
  );
}

export function normalizeChatError(
  errorMessage: string,
  errorCode?: string,
): NormalizedChatError {
  const raw = String(errorMessage || "Unknown error");
  const looksHtml = /<html[\s>]|<body[\s>]|<head[\s>]/i.test(raw);
  const text = looksHtml ? htmlToText(raw) : raw.trim();

  const code = normalizeErrorCode(errorCode);

  if (code === "builder_model_unauthorized") {
    return {
      message:
        "The provider behind this model rejected the request. Pick a different model, then retry.",
      details: text,
    };
  }

  if (code === "builder_auth_error") {
    return {
      message:
        "Builder rejected the connected credentials. Reconnect Builder.io (free tier available) in Settings, then retry.",
      details: text,
    };
  }

  // Reaches us as a bare gateway 403 with no upgradeUrl, so before this case
  // it fell all the way through to the raw upstream sentence under a generic
  // "The agent hit an error" headline, with no retry and no action — a dead
  // end. It was the single largest cause of turns ending without an answer in
  // one app, and reads to the user as the chat being broken rather than as
  // something one person can fix in a minute.
  if (code === "email_verification_required") {
    return {
      message:
        "AI is paused until an email address in this workspace is verified. Check the inbox for the verification link, then retry.",
      details: text,
    };
  }

  // A model/parameter combination this provider will never accept. Retrying is
  // pointless and the raw sentence names an API surface the reader has no way
  // to act on, so say what they can actually change.
  if (code === "provider_config_error") {
    return {
      message:
        "This model can't use tools with the current settings. Switch models in Settings, then retry.",
      details: text,
    };
  }

  if (isProviderRateLimit(text, errorCode)) {
    return {
      message:
        "The model provider is rate-limiting this chat right now. Wait a moment, then retry.",
      details: text,
    };
  }

  if (isProviderAuthenticationError(text, errorCode)) {
    return {
      message:
        "The saved provider key was rejected. Connect Builder.io for managed AI, or update your provider key, then retry.",
      details: text,
    };
  }

  if (isConnectionError(text, errorCode)) {
    const providerNetworkError =
      normalizeErrorCode(errorCode) === "provider_network_error" ||
      /provider_network_error/i.test(text);
    return {
      message: providerNetworkError
        ? "The model provider could not be reached. Check your connection and retry."
        : "The agent connection was interrupted. Check your connection and retry.",
      details: text,
    };
  }

  if (/^Gateway error \(no detail; raw event:/i.test(text)) {
    // The previous copy promised auto-recovery and suggested switching models,
    // but neither helps for this code: the server already retried once and
    // the client deliberately skips auto-continuation
    // (see `builder_gateway_error` in sse-event-processor.ts). The error is
    // almost always upstream, so retrying the same conversation with a
    // different model lands on the same wall.
    return {
      message:
        "The model gateway returned no error details and the chat couldn't recover. Wait a moment and retry, or start a new chat if it keeps happening.",
      details: text,
    };
  }

  if (/inactivity timeout/i.test(text)) {
    return {
      message:
        "The agent connection timed out before it could finish. You can continue from the partial work or retry.",
      details: text,
    };
  }

  if (/Invalid request body:\s*tools\.\d+\.input_schema\.type/i.test(text)) {
    return {
      message:
        "A tool schema was invalid, so the model rejected the request before it started. The invalid tool can be skipped and the request retried.",
      details: text,
    };
  }

  if (looksHtml) {
    return {
      message:
        text.slice(0, 240) || "The provider returned an HTML error page.",
      details: text,
    };
  }

  return { message: text };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h1|h2|h3|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
