import type { ActionEntry } from "../agent/production-agent.js";
import { redactedArgsWereCut } from "../audit/redact.js";
import type { McpApprovalMessages } from "../localization/mcp-approval-messages.js";
import {
  formatApprovalTime,
  formatRequestedTime,
  formatTimeZoneName,
  formatWallTime,
  isTimeZone,
  readApprovalTime,
  readWallTime,
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
  /** Set when `value` is one of the schema's choices: that choice in words. */
  choice?: string;
  /** Set when `value` is a time zone, to show by its name in the reader's language. */
  timeZone?: string;
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
  /**
   * Every argument, each value whole, except one the summary already shows:
   * the call's one recipient argument when it holds nothing but addresses,
   * or a zone a time below shows. `details` keeps them.
   */
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
const ADDRESS_SEPARATOR = /[,;\n]/;
const NAMED_ADDRESS = /^[^<>]*<([^<>]+)>$/;
const TIME_ZONE_KEY = /time_?zone$|^tz$/i;
// A choice written as an identifier (`externalOnly`, `high_priority`) reads
// better split into words; `America/New_York` or `New York` doesn't.
const IDENTIFIER = /^[A-Za-z][\w.-]*$/;
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

/**
 * A recipient string's parts, as it lists them: `a@x.com, "Doe, Jo" <b@x.com>`.
 * A separator inside a quoted name doesn't split it.
 */
function addressParts(text: string): string[] {
  const parts: string[] = [];
  let part = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === "\\") {
      part += text.slice(i, i + 2);
      i++;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && ADDRESS_SEPARATOR.test(char)) {
      parts.push(part);
      part = "";
    } else {
      part += char;
    }
  }
  parts.push(part);
  return parts.map((item) => item.trim()).filter(Boolean);
}

/** The address a part names, bare or after a name (`Ana <a@x.com>`). */
function partAddress(part: string): string | undefined {
  const address = (NAMED_ADDRESS.exec(part)?.[1] ?? part).trim();
  return EMAIL.test(address) ? address : undefined;
}

/**
 * Every address a recipient string names. A part that doesn't read as one
 * address, such as two names a stray quote joined (`O"Brien <b@x.com>,
 * Ro"Ed <c@x.com>`), is read again split at every separator.
 */
function recipientAddresses(text: string): string[] {
  return addressParts(text).flatMap((part) => {
    const address = partAddress(part);
    if (address) return [address];
    return part
      .split(ADDRESS_SEPARATOR)
      .flatMap((piece) => partAddress(piece.trim()) ?? []);
  });
}

/**
 * Whether `value` is nothing but bare addresses, which `recipients` lists
 * whole: strings, or objects such as `{ email }` that hold nothing else.
 */
function isOnlyAddresses(value: unknown): boolean {
  const items = Array.isArray(value) ? value : [value];
  const bare = (item: unknown) => {
    if (typeof item !== "string") return false;
    const parts = addressParts(item);
    return parts.length > 0 && parts.every((part) => EMAIL.test(part));
  };
  return (
    items.length > 0 &&
    items.every((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return bare(item);
      }
      const values = Object.values(item);
      return values.length === 1 && bare(values[0]);
    })
  );
}

interface ChoiceSchema {
  enum?: unknown[];
  const?: unknown;
  title?: unknown;
  description?: unknown;
  oneOf?: ChoiceSchema[];
  anyOf?: ChoiceSchema[];
  items?: ChoiceSchema;
}

/**
 * `value` in words when the argument's schema lists it as a choice: the
 * choice's own title or description, or else the value itself split into
 * words. A value with no lowercase letter (`USD`), or one that isn't an
 * identifier (`America/New_York`), stays as written.
 */
function choiceText(
  value: unknown,
  schema: ChoiceSchema | undefined,
): string | undefined {
  if (!schema) return undefined;
  if (Array.isArray(value)) {
    const words = value.map((item) => choiceText(item, schema.items));
    return words.length > 0 && words.every((word) => word !== undefined)
      ? words.join(", ")
      : undefined;
  }
  if (!["string", "number", "boolean"].includes(typeof value)) return undefined;
  for (const option of [...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) {
    if (option.const === value) {
      const label = [option.title, option.description].find(
        (text): text is string => typeof text === "string" && !!text.trim(),
      );
      if (label) return label.trim();
    }
    const nested = choiceText(value, option);
    if (nested !== undefined) return nested;
  }
  return schema.enum?.includes(value) &&
    typeof value === "string" &&
    IDENTIFIER.test(value) &&
    /[a-z]/.test(value)
    ? humanizeIdentifier(value)
    : undefined;
}

function collectEmails(value: unknown, into: Set<string>, depth: number) {
  if (depth > MAX_DEPTH) return;
  if (typeof value === "string") {
    // A part that names no one, such as `Team`, hides none of the others.
    for (const address of recipientAddresses(value)) into.add(address);
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

/** Adds every address the call names, and returns how many arguments name any. */
function findRecipients(
  value: unknown,
  into: Set<string>,
  depth: number,
): number {
  if (depth > MAX_DEPTH || !value || typeof value !== "object") return 0;
  if (Array.isArray(value)) {
    return value.reduce<number>(
      (count, item) => count + findRecipients(item, into, depth + 1),
      0,
    );
  }
  let count = 0;
  for (const [key, item] of Object.entries(value)) {
    if (!RECIPIENT_KEY.test(key)) {
      count += findRecipients(item, into, depth + 1);
      continue;
    }
    const named = new Set<string>();
    collectEmails(item, named, depth + 1);
    for (const address of named) into.add(address);
    if (named.size > 0) count++;
  }
  return count;
}

// Where a call gives the zone for a time argument: beside it
// (`startTimeZone` for `start`), beside the start an end closes (`end`
// takes `startTimeZone` when it has none of its own, as calendars read it),
// or once for the whole call.
function zoneArgument(
  key: string,
  args: Record<string, unknown>,
): { key: string; zone: string } | undefined {
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
    if (isTimeZone(zone)) return { key: candidate, zone };
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
      .map((item) => readableValue(item, labels))
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
  const recipientArguments = findRecipients(args, recipients, 0);
  const properties = entry?.tool.parameters?.properties ?? {};
  const fields: McpApprovalField[] = [];
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    const times = new Map<string, McpApprovalTime>();
    const zonesShown = new Set<string>();
    for (const [key, value] of Object.entries(record)) {
      if (typeof value !== "string") continue;
      const zone = zoneArgument(key, record);
      const time = readApprovalTime(value, zone?.zone);
      if (!time) continue;
      times.set(key, time);
      if (zone) zonesShown.add(zone.key);
    }
    for (const [key, value] of Object.entries(record)) {
      if (zonesShown.has(key)) continue;
      // Reaches lists every address together, so beside another recipient
      // argument (`to` and `bcc`) each row still says who is copied how.
      if (
        recipientArguments === 1 &&
        RECIPIENT_KEY.test(key) &&
        isOnlyAddresses(value)
      ) {
        continue;
      }
      const readable = readableValue(value, labels);
      if (readable === undefined || readable === "") continue;
      const schema = properties[key] as
        | (ChoiceSchema & { title?: unknown })
        | undefined;
      const time = times.get(key);
      // A time its own zone can't place, such as one in a DST gap, is not a
      // time with no zone: it stays as written.
      const wall =
        typeof value === "string" && !time && !zoneArgument(key, record)
          ? readWallTime(value)
          : undefined;
      const choice = choiceText(value, schema);
      fields.push({
        label:
          typeof schema?.title === "string" && schema.title.trim()
            ? schema.title.trim()
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
        ...(choice !== undefined && choice !== readable ? { choice } : {}),
        ...(TIME_ZONE_KEY.test(key) && isTimeZone(value)
          ? { timeZone: value }
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
 * when the call's zone reads differently (`formatRequestedTime`). Without a
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
  const requested = formatRequestedTime(
    time.at,
    time.zone,
    zone,
    input.locale,
    style,
  );
  if (requested === undefined) return shown;
  return `${shown} (${input.messages.requestedAs.replace("{time}", requested)})`;
}

/** A field that names no time, as a person reads it. */
export function describeFieldValue(
  field: McpApprovalField,
  locale: string,
): string {
  if (field.choice !== undefined) return field.choice;
  if (field.timeZone !== undefined) {
    return formatTimeZoneName(field.timeZone, locale);
  }
  return field.value;
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
      let value = describeFieldValue(field, locale);
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
      if (!URL.canParse(input.reviewUrl)) lines.push(messages.relativeLink);
    }
  }
  return lines.join("\n");
}
