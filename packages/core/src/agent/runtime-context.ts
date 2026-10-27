export interface RuntimeContextOptions {
  now?: Date;
  timezone?: string | null;
  delegationDepth?: number;
}

export const MAX_SUBAGENT_DELEGATION_DEPTH = 2;

const MAX_SUBAGENT_DELEGATION_DEPTH_CEILING = 16;

export const MAX_SUBAGENT_DELEGATION_DEPTH_ENV =
  "AGENT_NATIVE_MAX_SUBAGENT_DEPTH";

export function resolveMaxSubagentDelegationDepth(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[MAX_SUBAGENT_DELEGATION_DEPTH_ENV];
  if (raw === undefined) return MAX_SUBAGENT_DELEGATION_DEPTH;
  const trimmed = raw.trim();
  if (trimmed === "") return MAX_SUBAGENT_DELEGATION_DEPTH;
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

function resolveTimezone(timezone?: string | null): string {
  return typeof timezone === "string" && isValidTimezone(timezone)
    ? timezone
    : "UTC";
}

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

export function buildCurrentTimeUserContext(
  options: CurrentTimeContextOptions = {},
): string {
  const now = options.now ?? new Date();
  const timezone = resolveTimezone(options.timezone);

  return `\n\n<current-time>\ncurrentUtc: ${now.toISOString()}\ncurrentTimezone: ${timezone}\ncurrentTimeInTimezone: ${formatDateTime(now, timezone)}\n</current-time>`;
}
