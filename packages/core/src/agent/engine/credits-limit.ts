/**
 * One owner for everything a `credits-limit-*` rejection says to a user.
 *
 * Two separate reports converge here. The gateway's own sentence names no
 * number and no reset, so "you've reached the daily limit" leaves the reader
 * with nothing to decide; and the gateway says "AI credits" while every
 * Builder.io billing surface the upgrade CTA lands on says "Agent Credits",
 * so the reader is told to top up a currency that does not appear on the page.
 *
 * The limit itself is deliberately NOT a constant here. Builder's published
 * free-tier daily allowance has been 15, 25, and 50 across its own pricing
 * page, docs, and plan listings within a single year, and paid plans are
 * per-contract. A hardcoded number would render a confident wrong answer, so
 * a number is shown only when the gateway sent one and the docs CTA carries
 * the rest.
 */

/** Builder.io's authoritative page for per-plan Agent Credit allowances. */
export const BUILDER_AGENT_CREDITS_DOCS_URL =
  "https://www.builder.io/c/docs/agent-credits";

export type CreditsLimitWindow = "daily" | "monthly" | "unknown";

export interface CreditsLimitInfo {
  window: CreditsLimitWindow;
  /** Plan name as the gateway reported it, e.g. "free". */
  plan?: string;
  /** Credits included in the exceeded window, when the gateway sent it. */
  limit?: number;
  /** Credits consumed in the exceeded window, when the gateway sent it. */
  used?: number;
  /** Milliseconds until the window resets, from `Retry-After` when present. */
  resetsInMs?: number;
}

export function isCreditsLimitCode(code: string | undefined): boolean {
  return typeof code === "string" && code.startsWith("credits-limit");
}

export function creditsLimitWindowFromCode(
  code: string | undefined,
): CreditsLimitWindow {
  const normalized = String(code ?? "").toLowerCase();
  if (normalized.includes("daily")) return "daily";
  if (normalized.includes("monthly")) return "monthly";
  return "unknown";
}

/**
 * A missing or non-finite number is absent, never zero: `0` here would read as
 * "your plan includes no credits" and send the reader to support instead of to
 * the reset they are actually waiting on.
 */
function finitePositive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Read whatever the gateway actually sent. Every field is optional on purpose:
 * the shipped `usageInfo` payload carries `plan` / `limitExceeded` /
 * `isEnterprise` and no counts, so the numeric branch stays dormant until the
 * gateway starts sending them rather than guessing on its behalf.
 */
export function parseCreditsLimitInfo(
  body: unknown,
  code: string | undefined,
  retryAfterMs?: number,
): CreditsLimitInfo {
  const root = readRecord(body) ?? {};
  const usage = readRecord(root.usageInfo) ?? {};

  const windowFromUsage =
    typeof usage.limitExceeded === "string"
      ? creditsLimitWindowFromCode(usage.limitExceeded)
      : "unknown";
  const window =
    windowFromUsage === "unknown"
      ? creditsLimitWindowFromCode(code)
      : windowFromUsage;

  const plan =
    typeof usage.plan === "string" && usage.plan.trim()
      ? usage.plan.trim()
      : undefined;

  return {
    window,
    ...(plan ? { plan } : {}),
    ...(finitePositive(usage.limit) !== undefined
      ? { limit: finitePositive(usage.limit) }
      : {}),
    ...(finitePositive(usage.used) !== undefined
      ? { used: finitePositive(usage.used) }
      : {}),
    ...(finitePositive(retryAfterMs) !== undefined
      ? { resetsInMs: retryAfterMs }
      : {}),
  };
}

/**
 * Rewrite the gateway's "AI credits" into Builder.io's own product name.
 *
 * Applied to prose we did not write, so it is a term swap and nothing else: the
 * upgrade CTA lands on a Builder.io page that says "Agent Credits" everywhere,
 * and a reader who just read "AI credits" has no way to tell they are the same
 * balance.
 */
export function normalizeAgentCreditsTerminology(text: string): string {
  return text
    .replace(/\bAI(\s+)credits\b/gi, (_m, gap: string) => `Agent${gap}Credits`)
    .replace(/\bAI(\s+)credit\b/gi, (_m, gap: string) => `Agent${gap}Credit`);
}

function titleCasePlan(plan: string): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function humanizeDuration(ms: number): string | undefined {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Builder.io's published reset policy, not a per-plan number: daily credits
 * reset at midnight UTC and monthly credits on the first of the calendar
 * month. Safe to state without knowing the reader's plan.
 */
function resetSentence(info: CreditsLimitInfo): string | undefined {
  if (info.resetsInMs !== undefined) {
    const humanized = humanizeDuration(info.resetsInMs);
    if (humanized) return `They reset in about ${humanized}.`;
  }
  if (info.window === "daily") return "Daily credits reset at midnight UTC.";
  if (info.window === "monthly") {
    return "Monthly credits reset on the first of the month.";
  }
  return undefined;
}

/**
 * The three no-number variants are fixed strings on purpose: they are the path
 * the current gateway payload always takes, and `KNOWN_CHAT_ERROR_KEYS` can
 * only localize copy it can match exactly.
 */
export const CREDITS_LIMIT_DAILY_MESSAGE =
  "You've reached the daily Agent Credits limit for your current plan. Daily credits reset at midnight UTC.";
export const CREDITS_LIMIT_MONTHLY_MESSAGE =
  "You've reached the monthly Agent Credits limit for your current plan. Monthly credits reset on the first of the month.";
export const CREDITS_LIMIT_GENERIC_MESSAGE =
  "You've reached the Agent Credits limit for your current plan.";

export function formatCreditsLimitMessage(info: CreditsLimitInfo): string {
  const reset = resetSentence(info);
  const windowWord = info.window === "unknown" ? "" : `${info.window} `;
  if (info.limit === undefined) {
    if (info.resetsInMs === undefined) {
      if (info.window === "daily") return CREDITS_LIMIT_DAILY_MESSAGE;
      if (info.window === "monthly") return CREDITS_LIMIT_MONTHLY_MESSAGE;
      return CREDITS_LIMIT_GENERIC_MESSAGE;
    }
    return `You've reached the ${windowWord}Agent Credits limit for your current plan. ${reset}`;
  }
  const planPhrase = info.plan
    ? `included with the ${titleCasePlan(info.plan)} plan`
    : "included with your current plan";
  const usedPhrase =
    info.used !== undefined && info.used < info.limit
      ? `You've used ${info.used} of ${info.limit} ${windowWord}Agent Credits ${planPhrase}.`
      : `You've used all ${info.limit} ${windowWord}Agent Credits ${planPhrase}.`;
  return reset ? `${usedPhrase} ${reset}` : usedPhrase;
}
