/**
 * What a monitor shows to callers that are not the signed-in app UI: the
 * agent, MCP and A2A callers, and the public status page. The UI edit form
 * posts every field it reads back through `save-monitor`, so only the
 * `frontend` caller gets the stored values.
 */
import type { ActionCaller } from "@agent-native/core/action";

import type { Monitor } from "./uptime-monitors";

const SECRET_NAME_PATTERN =
  /key|token|secret|passw|pwd|auth|sig|credential|session|sid|jwt|bearer|code|otp|cookie/;
export const UNREADABLE_URL = "[unreadable URL]";

function isSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/**
 * Drops userinfo and the fragment, and hides the value of every query
 * parameter whose name looks like a credential. Null when the URL cannot be
 * parsed, so a caller never publishes a string it could not inspect.
 */
export function maskMonitorUrl(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  for (const name of new Set(parsed.searchParams.keys())) {
    if (isSecretName(name)) parsed.searchParams.set(name, "***");
  }
  return parsed.toString();
}

function maskWebhookUrl(url: string | null): string | null {
  if (!url) return null;
  return URL.canParse(url) ? `${new URL(url).origin}/***` : UNREADABLE_URL;
}

export type CallerMonitor<T extends Monitor> = Omit<
  T,
  "requestHeaders" | "requestBody"
> & {
  hasAuthHeader: boolean;
  hasRequestBody: boolean;
};

export function monitorForCaller<T extends Monitor>(
  monitor: T,
  caller: ActionCaller | undefined,
): T | CallerMonitor<T> {
  if (caller === "frontend") return monitor;
  const { requestHeaders, requestBody, ...rest } = monitor;
  const url = maskMonitorUrl(monitor.url) ?? UNREADABLE_URL;
  return {
    ...rest,
    url,
    // A check error can quote the monitor URL, and errors stored before they
    // were masked at the source still hold it as typed.
    lastError: monitor.lastError?.split(monitor.url).join(url) ?? null,
    slackWebhookUrl: maskWebhookUrl(monitor.slackWebhookUrl),
    webhookUrl: maskWebhookUrl(monitor.webhookUrl),
    hasAuthHeader: Object.keys(requestHeaders).some(isSecretName),
    hasRequestBody: Boolean(requestBody),
  };
}
