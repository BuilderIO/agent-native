import type { ActionEntry } from "../agent/production-agent.js";
import type { McpApprovalMessages } from "../localization/mcp-approval-messages.js";
import {
  formatApprovalTime,
  formatWallTime,
  isTimeZone,
  readApprovalTime,
  readWallTime,
  zoneOffsetMinutes,
  type McpApprovalTime,
} from "./approval-time.js";
import type { McpApprovalPriorRun } from "./execute-action-call.js";

/** One argument of the call, as a person reads it. */
export interface McpApprovalField {
  label: string;
  /** As the call wrote it. */
  value: string;
  /** Set when `value` names a point in time, to show in the reader's zone. */
  time?: McpApprovalTime;
  /**
   * Set when `value` is a date-time with no zone: `zone` says how the action
   * reads it (`calendar`: in the calendar's own zone), or `none` when the
   * action declares nothing, so the page never shows it as the reader's time.
   */
  wallTime?: { at: number; zone: "none" | "calendar" };
}

/**
 * What a reviewer sees about an MCP call that waits for approval. Built only
 * from the action's own definition and the arguments the server stored with
 * the grant: never from text the calling agent wrote about the call.
 */
export interface McpApprovalSummary {
  title: string;
  /** Email addresses the call names under a recipient-like argument. */
  recipients: string[];
  fields: McpApprovalField[];
  /** The stored arguments, indented; undefined unless `stored`. */
  details: string | undefined;
  arguments: "stored" | "not-stored" | "unreadable";
}

// Keys whose values name people the call reaches: `attendees[].email`,
// `to`, `cc`. A key like `accountEmail` names the caller's own account.
const RECIPIENT_KEY =
  /^(?:to|cc|bcc|recipients?|attendees?|participants?|invitees?|guests?|members?|emails?|shared?_?with|users?)$/i;
const EMAIL = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$/;
const MAX_FIELDS = 12;
const MAX_VALUE = 280;
const MAX_RECIPIENTS = 50;
const MAX_DEPTH = 6;

export function humanizeIdentifier(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : identifier;
}

function clip(value: string): string {
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value;
}

function collectEmails(value: unknown, into: Set<string>, depth: number) {
  if (into.size >= MAX_RECIPIENTS || depth > MAX_DEPTH) return;
  if (typeof value === "string") {
    if (EMAIL.test(value.trim())) into.add(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEmails(item, into, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectEmails(item, into, depth + 1);
    }
  }
}

function findRecipients(value: unknown, into: Set<string>, depth: number) {
  if (depth > MAX_DEPTH || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) findRecipients(item, into, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (RECIPIENT_KEY.test(key)) collectEmails(item, into, depth + 1);
    else findRecipients(item, into, depth + 1);
  }
}

// Where a call gives the zone for a time argument: beside it
// (`startTimeZone` for `start`), or once for the whole call.
function zoneArgument(
  key: string,
  args: Record<string, unknown>,
): string | undefined {
  for (const candidate of [
    `${key}TimeZone`,
    `${key}Timezone`,
    `${key}_time_zone`,
    `${key}_timezone`,
    "timeZone",
    "timezone",
    "time_zone",
  ]) {
    const zone = args[candidate];
    if (isTimeZone(zone)) return zone;
  }
  return undefined;
}

function readableValue(
  value: unknown,
  labels: { yes: string; no: string },
): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return clip(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? labels.yes : labels.no;
  if (Array.isArray(value)) {
    const items = value
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const emails = new Set<string>();
          collectEmails(item, emails, 0);
          if (emails.size > 0) return [...emails].join(", ");
        }
        return readableValue(item, labels);
      })
      .filter((item): item is string => item !== undefined);
    return items.length > 0 ? clip(items.join(", ")) : undefined;
  }
  return clip(JSON.stringify(value));
}

export function summarizeMcpApproval(input: {
  entry: ActionEntry | undefined;
  actionName: string;
  argumentsJson: string | null;
  labels: { yes: string; no: string };
}): McpApprovalSummary {
  const { entry, actionName, argumentsJson, labels } = input;
  const title = entry?.tool.title?.trim() || humanizeIdentifier(actionName);
  if (argumentsJson === null) {
    return {
      title,
      recipients: [],
      fields: [],
      details: undefined,
      arguments: "not-stored",
    };
  }
  let args: unknown;
  try {
    args = JSON.parse(argumentsJson);
  } catch {
    return {
      title,
      recipients: [],
      fields: [],
      details: undefined,
      arguments: "unreadable",
    };
  }
  const recipients = new Set<string>();
  findRecipients(args, recipients, 0);
  const properties = entry?.tool.parameters?.properties ?? {};
  const fields: McpApprovalField[] = [];
  if (args && typeof args === "object" && !Array.isArray(args)) {
    for (const [key, value] of Object.entries(args)) {
      if (fields.length >= MAX_FIELDS) break;
      const readable = readableValue(value, labels);
      if (readable === undefined || readable === "") continue;
      const schemaTitle = (properties[key] as { title?: unknown } | undefined)
        ?.title;
      const time =
        typeof value === "string"
          ? readApprovalTime(
              value,
              zoneArgument(key, args as Record<string, unknown>),
            )
          : undefined;
      const wall =
        typeof value === "string" && !time ? readWallTime(value) : undefined;
      fields.push({
        label:
          typeof schemaTitle === "string" && schemaTitle.trim()
            ? schemaTitle.trim()
            : humanizeIdentifier(key),
        value: readable,
        ...(time ? { time } : {}),
        ...(wall !== undefined
          ? {
              wallTime: {
                at: wall,
                zone: entry?.zonelessTimes === "calendar" ? "calendar" : "none",
              },
            }
          : {}),
      });
    }
  }
  return {
    title,
    recipients: [...recipients],
    fields,
    details: JSON.stringify(args, null, 2),
    arguments: "stored",
  };
}

/**
 * `time` in the reader's zone, followed by the time as the call wrote it
 * when the call's zone is a different offset at that moment. Without a
 * reader zone, the call's own zone is the only honest choice.
 */
export function describeApprovalTime(
  time: McpApprovalTime,
  input: {
    readerZone: string | undefined;
    locale: string;
    messages: Pick<McpApprovalMessages, "requestedAs">;
    style?: "time" | "date-time";
  },
): string {
  const style = input.style ?? "date-time";
  const zone = input.readerZone ?? time.zone;
  const shown = formatApprovalTime(time.at, zone, input.locale, style);
  if (
    zoneOffsetMinutes(time.at, zone) === zoneOffsetMinutes(time.at, time.zone)
  ) {
    return shown;
  }
  return `${shown} (${input.messages.requestedAs.replace(
    "{time}",
    formatApprovalTime(time.at, time.zone, input.locale, style),
  )})`;
}

/** A wall time as written, with how the action reads its missing zone. */
export function describeWallTime(
  wallTime: NonNullable<McpApprovalField["wallTime"]>,
  locale: string,
  messages: Pick<McpApprovalMessages, "noTimeZone" | "calendarTimeZone">,
): string {
  return `${formatWallTime(wallTime.at, locale)} (${
    wallTime.zone === "calendar"
      ? messages.calendarTimeZone
      : messages.noTimeZone
  })`;
}

/**
 * The text of the in-client approval prompt: the same summary the review page
 * shows, built from the stored arguments, never from the agent's own words.
 */
export function mcpApprovalPromptText(input: {
  summary: McpApprovalSummary;
  priorRun: McpApprovalPriorRun | undefined;
  messages: McpApprovalMessages;
  locale: string;
  readerZone: string | undefined;
  mode: "form" | "url";
}): string {
  const { summary, priorRun, messages, locale, readerZone } = input;
  // Without the reader's zone the fields show the call's own, so the prior
  // run uses that too rather than a third zone.
  const priorRunZone =
    readerZone ?? summary.fields.find((field) => field.time)?.time?.zone;
  const lines = [
    (input.mode === "url" ? messages.promptLink : messages.prompt).replace(
      "{action}",
      summary.title,
    ),
  ];
  if (priorRun) {
    lines.push(
      (priorRun.status === "completed"
        ? messages.priorCompleted
        : messages.priorUnknown
      ).replace(
        "{time}",
        formatApprovalTime(priorRun.at, priorRunZone ?? "UTC", locale, "time"),
      ),
    );
  }
  if (input.mode === "form") {
    if (summary.recipients.length > 0) {
      lines.push(`${messages.reaches}: ${summary.recipients.join(", ")}`);
    }
    for (const field of summary.fields) {
      const value = field.time
        ? describeApprovalTime(field.time, { readerZone, locale, messages })
        : field.wallTime
          ? describeWallTime(field.wallTime, locale, messages)
          : field.value;
      lines.push(`${field.label}: ${value}`);
    }
  }
  return lines.join("\n");
}
