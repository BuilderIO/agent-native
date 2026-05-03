export interface RuntimeContextOptions {
  now?: Date;
  timezone?: string | null;
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function formatDateTime(date: Date, timezone: string): string {
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

function formatDate(date: Date, timezone: string): string {
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

export function buildRuntimeContextPrompt(
  options: RuntimeContextOptions = {},
): string {
  const now = options.now ?? new Date();
  const timezone =
    typeof options.timezone === "string" && isValidTimezone(options.timezone)
      ? options.timezone
      : "UTC";

  return `

<runtime-context>
currentUtc: ${now.toISOString()}
currentDateUtc: ${formatDate(now, "UTC")}
currentTimezone: ${timezone}
currentDateInTimezone: ${formatDate(now, timezone)}
currentTimeInTimezone: ${formatDateTime(now, timezone)}
Use this runtime context as authoritative for relative dates such as today, yesterday, tomorrow, this week, and last month. Resolve relative dates to explicit calendar dates before querying data or creating artifacts, and include the exact date or date range in factual answers.
</runtime-context>`;
}
