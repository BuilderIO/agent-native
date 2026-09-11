export interface RuntimeContextOptions {
  now?: Date;
  timezone?: string | null;
  /**
   * Delegation depth of the agent this prompt is built for. 0 = the top-level
   * (user-facing) agent, 1 = a sub-agent spawned by the top-level agent, and so
   * on. Threaded through so a spawned sub-agent knows how deep it sits and
   * whether it is still allowed to delegate further. Omitted (or 0) for the
   * top-level chat. See `MAX_SUBAGENT_DELEGATION_DEPTH`.
   */
  delegationDepth?: number;
}

/**
 * Default hard cap on sub-agent delegation depth. The top-level agent is depth
 * 0 and may spawn sub-agents (depth 1); those may spawn once more (depth 2);
 * a spawn that would create a depth-3 sub-agent is refused. Borrowed from the
 * "sub-agents must not infinitely spawn sub-agents" runaway/cost safety rail.
 *
 * Override at deploy time via `AGENT_NATIVE_MAX_SUBAGENT_DEPTH` (see
 * `resolveMaxSubagentDelegationDepth`).
 */
export const MAX_SUBAGENT_DELEGATION_DEPTH = 2;

/**
 * Upper bound the env override is clamped to. A misconfigured very-large value
 * would defeat the guardrail entirely, so we cap it at a still-generous depth.
 */
const MAX_SUBAGENT_DELEGATION_DEPTH_CEILING = 16;

/** Env var name that overrides the default sub-agent delegation-depth cap. */
export const MAX_SUBAGENT_DELEGATION_DEPTH_ENV =
  "AGENT_NATIVE_MAX_SUBAGENT_DEPTH";

/**
 * Resolve the effective maximum sub-agent delegation depth.
 *
 * Reads `AGENT_NATIVE_MAX_SUBAGENT_DEPTH` and, when it parses to a finite
 * non-negative integer, clamps it to `[0, MAX_SUBAGENT_DELEGATION_DEPTH_CEILING]`.
 * Any invalid value (non-numeric, negative, NaN, Infinity, fractional) falls
 * back to `MAX_SUBAGENT_DELEGATION_DEPTH` so a typo can never silently disable
 * the guardrail. `0` is a valid override meaning "no sub-agents may be spawned".
 */
export function resolveMaxSubagentDelegationDepth(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[MAX_SUBAGENT_DELEGATION_DEPTH_ENV];
  if (raw === undefined) return MAX_SUBAGENT_DELEGATION_DEPTH;
  const trimmed = raw.trim();
  if (trimmed === "") return MAX_SUBAGENT_DELEGATION_DEPTH;
  // Only accept plain non-negative integers; reject "2.5", "1e3", "0x4", etc.
  if (!/^\d+$/.test(trimmed)) return MAX_SUBAGENT_DELEGATION_DEPTH;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return MAX_SUBAGENT_DELEGATION_DEPTH;
  }
  return Math.min(parsed, MAX_SUBAGENT_DELEGATION_DEPTH_CEILING);
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function formatDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/** Resolve the effective timezone for runtime-context helpers: the provided
 * value when it parses as a valid IANA timezone, otherwise "UTC". */
function resolveTimezone(timezone?: string | null): string {
  return typeof timezone === "string" && isValidTimezone(timezone)
    ? timezone
    : "UTC";
}

/**
 * Build the stable, day-granular runtime-context block embedded in the
 * SYSTEM prompt.
 *
 * This block is part of the cached prompt prefix, so it must stay byte-for-
 * byte identical across requests within the same calendar day — anything
 * with sub-day granularity (a millisecond/second timestamp) here would
 * invalidate the Anthropic prompt cache on every single turn, since the
 * cache matches prefixes and this block sits near the start of the system
 * prompt. Precise current time is injected separately, per-turn, into the
 * USER message instead (see `buildCurrentTimeUserContext` below) so the
 * model can still answer "what time is it" accurately without destabilizing
 * the cached prefix.
 */
export function buildRuntimeContextPrompt(
  options: RuntimeContextOptions = {},
): string {
  const now = options.now ?? new Date();
  const timezone = resolveTimezone(options.timezone);

  const depth =
    typeof options.delegationDepth === "number" &&
    Number.isFinite(options.delegationDepth) &&
    options.delegationDepth > 0
      ? Math.floor(options.delegationDepth)
      : 0;
  const maxDepth = resolveMaxSubagentDelegationDepth();
  const delegationLine =
    depth > 0
      ? `\ndelegationDepth: ${depth}\nmaxDelegationDepth: ${maxDepth}\n${
          depth >= maxDepth
            ? `You are a sub-agent at the maximum delegation depth (${maxDepth}); you cannot spawn further sub-agents. Do the work yourself.`
            : `You are a sub-agent at delegation depth ${depth} (limit ${maxDepth}); spawn additional sub-agents only when truly necessary.`
        }`
      : "";

  return `

<runtime-context>
currentDate: ${formatDate(now, "UTC")}
currentTimezone: ${timezone}
currentDateInTimezone: ${formatDate(now, timezone)}${delegationLine}
Use this runtime context as authoritative for relative dates such as today, yesterday, tomorrow, this week, and last month. Resolve relative dates to explicit calendar dates before querying data or creating artifacts, and include the exact date or date range in factual answers. This block only carries day-granularity; for the precise current time, see the <current-time> block in the user message.
</runtime-context>`;
}

export interface CurrentTimeContextOptions {
  now?: Date;
  timezone?: string | null;
}

/**
 * Build the precise, per-turn current-time block injected into the USER
 * message (not the system prompt). Millisecond-precision time changes every
 * request, so it must never live in the cached system-prompt prefix — see
 * `buildRuntimeContextPrompt`. This follows the same volatile-context pattern
 * as the current-screen/current-url/selection blocks in production-agent.ts.
 */
export function buildCurrentTimeUserContext(
  options: CurrentTimeContextOptions = {},
): string {
  const now = options.now ?? new Date();
  const timezone = resolveTimezone(options.timezone);

  return `\n\n<current-time>\ncurrentUtc: ${now.toISOString()}\ncurrentTimezone: ${timezone}\ncurrentTimeInTimezone: ${formatDateTime(now, timezone)}\n</current-time>`;
}
