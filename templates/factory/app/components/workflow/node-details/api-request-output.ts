/**
 * What the Output column shows for an API request tested on its own. A test the
 * person just ran answers with the whole bounded response, held in memory for
 * as long as the window is open. A run keeps only a short record of what a step
 * read (never the whole response), so an answer from a run is read back from
 * that record, and a record the step cut is shown as far as it goes and says so.
 */
import type { FreeFormFailureCode } from "@/lib/workflow-editor";
import { wrappedValueOf } from "@/lib/workflow-editor/fields-to-keep";

import type { ItemJourneyData } from "../items/read-types";

export type ApiErrorKind =
  | "not_connected"
  | "access_denied"
  | "not_found"
  | "rate_limited"
  | "provider_problem"
  | "rejected"
  | "too_large"
  | "request_failed"
  | "request_refused"
  | "unreadable"
  | "expression_failed"
  | "test_not_allowed"
  | "failed"
  | "invalid_fields_to_keep"
  | FreeFormFailureCode;

const REFUSAL_CODES: readonly ApiErrorKind[] = [
  "full_url_refused",
  "unsafe_path_value",
  "invalid_query",
  "invalid_header",
  "header_denied",
  "invalid_pagination",
  "invalid_timeout",
  "incompatible_fields",
  "invalid_fields_to_keep",
  "invalid_field",
];

function refusalCode(code: string): ApiErrorKind | undefined {
  return REFUSAL_CODES.find((candidate) => candidate === code);
}

// What a run records as a step's code, and the provider-side codes the engine
// appends to a message as `(code)`.
const KIND_OF_CODE: ReadonlyMap<string, ApiErrorKind> = new Map<
  string,
  ApiErrorKind
>([
  ["credential_missing", "not_connected"],
  ["provider_not_configured", "not_connected"],
  ["provider_access_denied", "access_denied"],
  ["provider_request_failed", "request_failed"],
  ["provider_request_refused", "request_refused"],
  ["provider_not_found", "not_found"],
  ["provider_rate_limited", "rate_limited"],
  ["provider_unavailable", "provider_problem"],
  ["provider_rejected", "rejected"],
  ["output_over_cap", "too_large"],
  ["unexpected_response", "unreadable"],
  // The action's own check of a field the refusals above do not name.
  ["operation_fields_invalid", "invalid_field"],
  // A path the step reads has no value, which a run fails the item for.
  ["expression_failed", "expression_failed"],
  // A test the caller may not run: core's collaborate-access refusal.
  ["run_not_queued", "test_not_allowed"],
]);

export interface ApiRequestFailure {
  kind: ApiErrorKind;
  /** The most specific code the run recorded: the one typed in the message, else the step's own. */
  code: string;
  /** The HTTP status the provider answered with, when the message names one. */
  status: number | null;
  /** As the engine recorded it: it names the step and the provider, and never a header or a credential. */
  message: string;
}

function typedCodeIn(message: string): string | undefined {
  for (const [, code = ""] of message.matchAll(/\(([a-z][a-z0-9_]*)\)/g)) {
    if (KIND_OF_CODE.has(code) || refusalCode(code) !== undefined) return code;
  }
  return undefined;
}

function statusIn(message: string): number | null {
  const match = /\bHTTP (\d{3})\b/.exec(message);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function kindOfStatus(status: number): ApiErrorKind | undefined {
  if (status === 401 || status === 403) return "access_denied";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 408 || status >= 500) return "provider_problem";
  if (status >= 400) return "rejected";
  return undefined;
}

/** Sorts a failed step into the sentence it gets: the typed code first, then the HTTP status, else a plain failure. */
export function failureOf(
  stepCode: string,
  message: string,
): ApiRequestFailure {
  const typed = typedCodeIn(message);
  const status = statusIn(message);
  const code = typed ?? stepCode;
  const kind: ApiErrorKind =
    refusalCode(code) ??
    KIND_OF_CODE.get(code) ??
    (status === null ? undefined : kindOfStatus(status)) ??
    "failed";
  return { kind, code, status, message };
}

export type StandaloneResult =
  | { kind: "output"; text: string }
  | { kind: "failed"; failure: ApiRequestFailure }
  | { kind: "none" };

// A step records `<name>: <json>`.
const OUTPUT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*: /;

/**
 * What one test run did at one step, read from the blank item a standalone
 * test runs on: the step's own error when it failed, else the last answer it
 * recorded.
 */
export function standaloneResultOf(
  journey: ItemJourneyData,
  nodeId: string,
  runId: string,
): StandaloneResult {
  const step = journey.steps.find(
    (candidate) => candidate.runId === runId && candidate.nodeId === nodeId,
  );
  if (step?.error) {
    return {
      kind: "failed",
      failure: failureOf(step.error.code, step.error.message),
    };
  }
  // Newest first: the journey lists a page oldest first.
  const events = journey.events
    .filter((event) => event.runId === runId && event.nodeId === nodeId)
    .reverse();
  const failed = events.find((event) => event.kind === "error");
  if (failed) {
    return {
      kind: "failed",
      failure: failureOf(failed.code ?? "lookup_failed", failed.summary),
    };
  }
  const answer = events.find((event) => event.kind === "output");
  if (answer) {
    return {
      kind: "output",
      text: answer.summary.replace(OUTPUT_PREFIX, ""),
    };
  }
  return { kind: "none" };
}

const CUT_MARKER = "…[cut]";

type Parsed = { ok: true; value: unknown } | { ok: false };

function parse(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // coercion-ok: text that is not JSON is the caller's to try another way, and a failed parse is returned as its own state
    return { ok: false };
  }
}

/**
 * The start of a JSON text that was cut short, as a value: cut back to the last
 * comma outside a string (every value before one is whole, so the entry the cut
 * fell in keeps only its whole fields) and closed. A text
 * that ends on a closed value is closed as it stands; one that ends on a bare
 * number or word is not, because the cut may have taken digits off it.
 */
function closeCutJson(body: string): Parsed {
  let inString = false;
  let escaped = false;
  const open: string[] = [];
  const commas: { end: number; closers: string }[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const char = body.charAt(index);
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") open.push("}");
    else if (char === "[") open.push("]");
    else if (char === "}" || char === "]") open.pop();
    else if (char === ",") {
      commas.push({ end: index, closers: [...open].reverse().join("") });
    }
  }
  const attempts: string[] = [];
  const last = body.trimEnd().slice(-1);
  if (!inString && (last === "}" || last === "]" || last === '"')) {
    attempts.push(body + [...open].reverse().join(""));
  }
  for (const comma of [...commas].reverse()) {
    attempts.push(body.slice(0, comma.end) + comma.closers);
  }
  for (const attempt of attempts) {
    const result = parse(attempt);
    if (result.ok) return result;
  }
  return { ok: false };
}

export type RecordedAnswer =
  | { kind: "value"; value: unknown; cut: boolean }
  | { kind: "text"; text: string };

/** The recorded answer as a value, as much of it as the record holds; text when it cannot be read as JSON at all. */
export function readRecordedAnswer(text: string): RecordedAnswer {
  const whole = parse(text);
  if (whole.ok) return { kind: "value", value: whole.value, cut: false };
  const trimmed = text.trimEnd();
  if (trimmed.endsWith(CUT_MARKER)) {
    const start = closeCutJson(trimmed.slice(0, -CUT_MARKER.length));
    if (start.ok) return { kind: "value", value: start.value, cut: true };
  }
  return { kind: "text", text };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface AnswerList {
  entries: unknown[];
  /** How many the provider's answer held, when the step kept fewer. */
  total: number | null;
}

/**
 * The list the answer is, for the count and the table: a list as it stands, the
 * entries of a paged answer, or a list the step wrapped in a report, as
 * `{ truncated, fieldsMissing, count, totalAvailable, cuts, value }`.
 */
export function listOf(value: unknown): AnswerList | null {
  if (Array.isArray(value)) return { entries: value, total: null };
  if (!isRecord(value)) return null;
  if (Array.isArray(value.items) && typeof value.pagesRead === "number") {
    return { entries: value.items, total: null };
  }
  const wrapped = wrappedValueOf(value);
  if (wrapped && Array.isArray(wrapped.value)) {
    return {
      entries: wrapped.value,
      total:
        typeof value.totalAvailable === "number" ? value.totalAvailable : null,
    };
  }
  return null;
}

/** The step cut the provider's answer to fit, and says so with `truncated: true` at the head of it. */
export function isCutByStep(value: unknown): boolean {
  return isRecord(value) && value.truncated === true;
}

export interface MissingFields {
  /** The paths, as they were typed. */
  names: string[];
  /** Paths the step counted as missing but did not list, to keep its report short. */
  more: number;
}

/** The fields to keep that the answer had no value for, which the step lists in `fieldsMissing` at the head of its answer. */
export function fieldsMissingOf(value: unknown): MissingFields {
  if (!isRecord(value) || !Array.isArray(value.fieldsMissing)) {
    return { names: [], more: 0 };
  }
  return {
    names: value.fieldsMissing.filter(
      (name): name is string => typeof name === "string",
    ),
    more:
      typeof value.fieldsMissingMore === "number" ? value.fieldsMissingMore : 0,
  };
}

/** One place the step cut: a list kept to fewer entries, a text kept to fewer characters, or fields left out. */
export type AnswerCut =
  | { kind: "list"; path: string; kept: number; of: number }
  | { kind: "text"; path: string; kept: number; of: number }
  | { kind: "keys"; path: string; count: number };

export interface AnswerCuts {
  cuts: AnswerCut[];
  /** Cuts the step counted but did not list. */
  omitted: number;
}

function cutOf(entry: unknown): AnswerCut | undefined {
  if (!isRecord(entry) || typeof entry.path !== "string") return undefined;
  const { path } = entry;
  if (typeof entry.kept === "number" && typeof entry.of === "number") {
    return { kind: "list", path, kept: entry.kept, of: entry.of };
  }
  if (
    typeof entry.keptChars === "number" &&
    typeof entry.ofChars === "number"
  ) {
    return { kind: "text", path, kept: entry.keptChars, of: entry.ofChars };
  }
  if (typeof entry.droppedCount === "number") {
    return { kind: "keys", path, count: entry.droppedCount };
  }
  return undefined;
}

/** Where a cut answer was cut, as the step lists it in `cuts`. An entry in a shape this does not know stays out of the list; the notice says the answer was cut either way. */
export function cutsOf(value: unknown): AnswerCuts {
  if (!isRecord(value) || !Array.isArray(value.cuts)) {
    return { cuts: [], omitted: 0 };
  }
  return {
    cuts: value.cuts.flatMap((entry) => {
      const cut = cutOf(entry);
      return cut ? [cut] : [];
    }),
    omitted: typeof value.cutsOmitted === "number" ? value.cutsOmitted : 0,
  };
}

/** What `test-api-request-step` hands back: the answer, or the typed way the request failed. */
export type ApiTestResult =
  | {
      ok: true;
      status: number;
      output: unknown;
      truncated: boolean;
      elapsedMs: number;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status?: number;
      elapsedMs: number;
    };

/** A test run in this window, as the Output column shows it. */
export type LiveAnswer =
  | { kind: "answer"; value: unknown; status: number; elapsedMs: number }
  | {
      kind: "failed";
      failure: ApiRequestFailure;
      /** How long the request took, when one was sent. */
      elapsedMs: number | null;
    };

/** A test's result as the pane shows it: a failure keeps the status the provider sent, which its message may not name. */
export function liveAnswerOf(result: ApiTestResult): LiveAnswer {
  if (result.ok) {
    return {
      kind: "answer",
      value: result.output,
      status: result.status,
      elapsedMs: result.elapsedMs,
    };
  }
  const failure = failureOf(result.code, result.message);
  return {
    kind: "failed",
    failure:
      result.status === undefined
        ? failure
        : { ...failure, status: result.status },
    elapsedMs: result.elapsedMs,
  };
}

/** A test the server refused before it sent anything (no access, not a step it tests): its typed code and message. */
export function liveAnswerOfRefusal(
  code: string | null,
  message: string,
): LiveAnswer {
  return {
    kind: "failed",
    failure: failureOf(code ?? "failed", message),
    elapsedMs: null,
  };
}
