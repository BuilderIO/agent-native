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
export const BUILDER_SPACE_SETTINGS_URL = "https://builder.io/account/space";

// Pseudo-href used to mark an in-app "Start new chat" CTA inside the markdown
// error message. The chat renderer intercepts this href and renders a button
// that dispatches the `agent-native:new-chat` CustomEvent instead of navigating.
export const NEW_CHAT_ACTION_HREF = "agent-native:new-chat";

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
    return `Error: ${normalized.message}\n\n[Open Builder space settings](${BUILDER_SPACE_SETTINGS_URL})`;
  }
  if (errorCode === "builder_gateway_error") {
    return `Error: ${normalized.message}\n\n[Start new chat](${NEW_CHAT_ACTION_HREF})`;
  }
  if (
    errorCode === "context_length_exceeded" ||
    errorCode === "input_too_long"
  ) {
    return `Error: ${normalized.message}\n\n[Start new chat](${NEW_CHAT_ACTION_HREF})`;
  }
  if (!upgradeUrl || !isSafeUpgradeUrl(upgradeUrl)) {
    return `Error: ${normalized.message}`;
  }
  return `Error: ${normalized.message}\n\n[Upgrade at builder.io](${upgradeUrl})`;
}

export interface NormalizedChatError {
  message: string;
  details?: string;
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

function isProviderAuthenticationError(
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
    lower.includes("invalid x-api-key") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("api key is invalid") ||
    (lower.includes("authentication_error") && lower.includes("api"))
  );
}

export function normalizeChatError(
  errorMessage: string,
  errorCode?: string,
): NormalizedChatError {
  const raw = String(errorMessage || "Unknown error");
  const looksHtml = /<html[\s>]|<body[\s>]|<head[\s>]/i.test(raw);
  const text = looksHtml ? htmlToText(raw) : raw.trim();

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
        "The model provider rejected the saved API key. Update the key in API Keys & Connections, then retry.",
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
