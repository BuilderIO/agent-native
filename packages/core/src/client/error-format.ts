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
 * regex stays narrow; `buildUpgradeUrl` emits org-name URLs that may
 * contain `(` (e.g. `Acme%20(staging)`) and we don't want to reject them.
 */
export const BUILDER_SPACE_SETTINGS_URL = "https://builder.io/account/space";

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
  const normalized = normalizeChatError(errorMessage);
  if (
    errorCode === "gateway_not_enabled" ||
    /space has not enabled the LLM gateway/i.test(normalized.message)
  ) {
    return `Error: ${normalized.message}\n\n[Open Builder space settings](${BUILDER_SPACE_SETTINGS_URL})`;
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

export function normalizeChatError(errorMessage: string): NormalizedChatError {
  const raw = String(errorMessage || "Unknown error");
  const looksHtml = /<html[\s>]|<body[\s>]|<head[\s>]/i.test(raw);
  const text = looksHtml ? htmlToText(raw) : raw.trim();

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
