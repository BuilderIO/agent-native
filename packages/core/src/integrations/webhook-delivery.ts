import {
  isBlockedExtensionUrl,
  ssrfSafeFetch,
} from "../extensions/url-safety.js";

export function escapeSlackMrkdwn(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function isWebhookUrlAllowed(url: string): boolean {
  return !isBlockedExtensionUrl(url);
}

export interface DeliverJsonWebhookOptions {
  url: string;
  payload: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
}

export type JsonWebhookDeliveryResult =
  | { ok: true; status: number }
  | { ok: false; blocked: true }
  | { ok: false; blocked: false; status?: number; error?: unknown };

export async function deliverJsonWebhook(
  options: DeliverJsonWebhookOptions,
): Promise<JsonWebhookDeliveryResult> {
  if (!isWebhookUrlAllowed(options.url)) return { ok: false, blocked: true };

  try {
    const response = await ssrfSafeFetch(
      options.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...options.headers,
        },
        body: JSON.stringify(options.payload),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      },
      { maxRedirects: options.maxRedirects ?? 3 },
    );
    return response.ok
      ? { ok: true, status: response.status }
      : { ok: false, blocked: false, status: response.status };
  } catch (error) {
    return { ok: false, blocked: false, error };
  }
}
