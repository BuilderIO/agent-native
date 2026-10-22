import type { ActionEntry } from "../agent/production-agent.js";
import { redactedArgsWereCut } from "../audit/redact.js";
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
  /** Every email address the call names under a recipient-like argument. */
  recipients: string[];
  /** Every argument, each value whole. */
  fields: McpApprovalField[];
  /** The stored arguments, indented; undefined unless `stored`. */
  details: string | undefined;
  arguments: "stored" | "not-stored" | "unreadable";
  /**
   * The server cut the arguments to store them, so the fields, recipients
   * and details above are not the whole call.
   */
  cut: boolean;
}

// Keys whose values name people the call reaches: `attendees[].email`,
// `to`, `cc`. A key like `accountEmail` names the caller's own account.
const RECIPIENT_KEY =
  /^(?:to|cc|bcc|recipients?|attendees?|participants?|invitees?|guests?|members?|emails?|shared?_?with|users?)$/i;
const EMAIL = /^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$/;
// Stored arguments are no deeper (`audit/redact.ts`).
const MAX_DEPTH = 6;
// The in-client prompt is a short text; it says what it leaves out.
const PROMPT_MAX_RECIPIENTS = 20;
const PROMPT_MAX_FIELDS = 12;
const PROMPT_MAX_VALUE = 280;

export function humanizeIdentifier(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_.]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : identifier;
}

function collectEmails(value: unknown, into: Set<string>, depth: number) {
  if (depth > MAX_DEPTH) return;
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
// (`startTimeZone` for `start`), beside the start an end closes (`end`
// takes `startTimeZone` when it has none of its own, as calendars read it),
// or once for the whole call.
function zoneArgument(
  key: string,
  args: Record<string, unknown>,
): string | undefined {
  const start = key.replace(/^end/i, (end) =>
    end[0] === "E" ? "Start" : "start",
  );
  const owners = start === key ? [key] : [key, start];
  for (const candidate of [
    ...owners.flatMap((owner) => [
      `${owner}TimeZone`,
      `${owner}Timezone`,
      `${owner}_time_zone`,
      `${owner}_timezone`,
    ]),
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
  if (typeof value === "string") return value;
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
    return items.length > 0 ? items.join(", ") : undefined;
  }
  return JSON.stringify(value);
}

/**
 * The start of the call's JSON, when the call was too large to store and
 * only that prefix was kept (`_auditTruncated`); nothing in it can be read
 * as fields.
 */
function storedPreview(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }
  const envelope = args as { _auditTruncated?: unknown; preview?: unknown };
  if (envelope._auditTruncated !== true) return undefined;
  return typeof envelope.preview === "string" ? envelope.preview : "";
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
      cut: false,
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
      cut: false,
    };
  }
  const preview = storedPreview(args);
  if (preview !== undefined) {
    return {
      title,
      recipients: [],
      fields: [],
      details: preview,
      arguments: "stored",
      cut: true,
    };
  }
  const cut = redactedArgsWereCut(args);
  const recipients = new Set<string>();
  findRecipients(args, recipients, 0);
  const properties = entry?.tool.parameters?.properties ?? {};
  const fields: McpApprovalField[] = [];
  if (args && typeof args === "object" && !Array.isArray(args)) {
    for (const [key, value] of Object.entries(args)) {
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
    cut,
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
 * A form shows what fits in a short text and says what it leaves out, with
 * the review page's link when the page shows more.
 */
export function mcpApprovalPromptText(input: {
  summary: McpApprovalSummary;
  priorRun: McpApprovalPriorRun | undefined;
  messages: McpApprovalMessages;
  locale: string;
  readerZone: string | undefined;
  mode: "form" | "url";
  reviewUrl: string;
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
    const recipients = summary.recipients.slice(0, PROMPT_MAX_RECIPIENTS);
    const moreRecipients = summary.recipients.length - recipients.length;
    if (recipients.length > 0) {
      lines.push(
        `${messages.reaches}: ${recipients.join(", ")}${
          moreRecipients > 0
            ? ` ${messages.moreRecipients.replace("{count}", String(moreRecipients))}`
            : ""
        }`,
      );
    }
    let shortened = false;
    for (const field of summary.fields.slice(0, PROMPT_MAX_FIELDS)) {
      let value = field.value;
      if (field.time) {
        value = describeApprovalTime(field.time, {
          readerZone,
          locale,
          messages,
        });
      } else if (field.wallTime) {
        value = describeWallTime(field.wallTime, locale, messages);
      } else if (value.length > PROMPT_MAX_VALUE) {
        value = `${value.slice(0, PROMPT_MAX_VALUE)}…`;
        shortened = true;
      }
      lines.push(`${field.label}: ${value}`);
    }
    const moreFields = summary.fields.length - PROMPT_MAX_FIELDS;
    if (moreFields > 0) {
      lines.push(messages.moreFields.replace("{count}", String(moreFields)));
    }
    if (shortened) lines.push(messages.valuesShortened);
    if (summary.arguments === "not-stored") {
      lines.push(messages.argumentsNotStored);
    } else if (summary.arguments === "unreadable") {
      lines.push(messages.argumentsUnreadable);
    } else if (summary.cut) {
      lines.push(messages.argumentsCut);
    }
    if (moreRecipients > 0 || moreFields > 0 || shortened) {
      lines.push(messages.reviewWhole.replace("{url}", input.reviewUrl));
    }
  }
  return lines.join("\n");
}
