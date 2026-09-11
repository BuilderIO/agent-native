/**
 * Build PostHog error-tracking payloads from a raw JS error or from the
 * camelCase exception properties the framework's own `captureException()`
 * emits.
 *
 * PostHog's error tracking only groups and renders an issue when the event
 * carries `$exception_list` with per-frame stack data. An event named
 * `$exception` without it is ingested and displayed as an empty, ungroupable
 * issue — which is worse than no event, because the count looks like coverage.
 *
 * Frame parsing follows posthog-js (itself derived from Sentry's TraceKit
 * fork), because PostHog's ingestion is written against that shape:
 *   - `Error: …` header lines are skipped, not parsed as frames
 *   - lines over 1 KB are skipped (the regexes backtrack)
 *   - frames are capped at 50 and reversed to oldest-call-first
 *   - an unresolvable function name is `?`, never empty
 *
 * Runs unchanged in Node and the browser: no `process`, no Node built-ins.
 *
 * @see https://posthog.com/docs/error-tracking/installation/manual
 */

import {
  MAX_MESSAGE_LENGTH,
  MAX_STACK_LENGTH,
  boundedText,
  exceptionParts,
} from "./redaction.js";

/** Matches posthog-js's `UNKNOWN_FUNCTION`. */
const UNKNOWN_FUNCTION = "?";
const STACKTRACE_FRAME_LIMIT = 50;
const MAX_STACK_LINE_LENGTH = 1024;

const ERROR_HEADER_RE = /\S*Error: /;
const WEBPACK_ERROR_RE = /\(error: (.*)\)/;

// "    at fn (file:1:2)" / "    at async Foo.bar (/app/x.js:2:3)" / "    at /app/x.js:1:2"
const V8_FRAME_RE =
  /^\s*at (?:async )?(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+)|([^)]+))\)?\s*$/;
// "fn@https://example.com/s.js:1:2" / "@https://example.com/s.js:1:2"
const GECKO_FRAME_RE = /^\s*(.*?)@(.+?)(?::(\d+))?(?::(\d+))?\s*$/;

export type PostHogExceptionLevel =
  | "fatal"
  | "error"
  | "warning"
  | "info"
  | "debug";

export interface PostHogStackFrame {
  /**
   * Always `"custom"`. PostHog reserves the language-specific platforms for
   * frames it will try to symbolicate against uploaded source maps; we upload
   * none, so claiming one would render every minified frame as a failed
   * resolution rather than as the raw frame it is.
   */
  platform: "custom";
  lang: string;
  function: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
  resolved: boolean;
}

export interface PostHogExceptionEntry {
  type: string;
  value: string;
  mechanism: { handled: boolean; synthetic: boolean; type?: string };
  stacktrace?: { type: "raw"; frames: PostHogStackFrame[] };
}

export interface PostHogExceptionProperties {
  $exception_list: PostHogExceptionEntry[];
  $exception_level: PostHogExceptionLevel;
  $exception_fingerprint?: string;
  [key: string]: unknown;
}

export interface PostHogExceptionInput {
  /** Error class name, e.g. `TypeError`. */
  type: string;
  /** Error message. */
  value: string;
  /** Raw `error.stack` string, when available. */
  stack?: string;
  /** `false` for errors that crashed the request/page rather than being caught. */
  handled?: boolean;
  /** `true` when the framework synthesized the error from a non-Error throw. */
  synthetic?: boolean;
  /** Mechanism label, e.g. `onunhandledrejection`, `nitro.error`. */
  mechanismType?: string;
  level?: PostHogExceptionLevel;
  /** Overrides PostHog's default grouping. */
  fingerprint?: string;
  /** Frame language tag. Defaults to `javascript`. */
  lang?: string;
}

function isInAppFrame(filename: string | undefined): boolean {
  if (!filename) return true;
  return (
    !filename.startsWith("node:") &&
    !filename.includes("node_modules") &&
    !filename.includes("/internal/") &&
    filename !== "native"
  );
}

function makeFrame(
  lang: string,
  fn: string,
  filename: string | undefined,
  lineno: number | undefined,
  colno: number | undefined,
): PostHogStackFrame {
  const name = !fn || fn === "<anonymous>" ? UNKNOWN_FUNCTION : fn;
  return {
    platform: "custom",
    lang,
    function: name,
    ...(filename ? { filename } : {}),
    ...(lineno !== undefined && Number.isFinite(lineno) ? { lineno } : {}),
    ...(colno !== undefined && Number.isFinite(colno) ? { colno } : {}),
    in_app: isInAppFrame(filename),
    // Never `true`: we ship no source maps to PostHog, so a minified browser
    // frame is exactly as informative as it looks. Claiming it is resolved
    // would present a mangled name as the real one.
    resolved: false,
  };
}

function parseFrameLine(
  line: string,
  lang: string,
): PostHogStackFrame | undefined {
  const v8 = V8_FRAME_RE.exec(line);
  if (v8) {
    const [, fn, file, lineNo, colNo, bare] = v8;
    const filename = (file ?? bare)?.replace(/^file:\/\//, "");
    return makeFrame(
      lang,
      fn ?? UNKNOWN_FUNCTION,
      filename,
      lineNo ? Number(lineNo) : undefined,
      colNo ? Number(colNo) : undefined,
    );
  }

  const gecko = GECKO_FRAME_RE.exec(line);
  if (gecko) {
    const [, fn, file, lineNo, colNo] = gecko;
    return makeFrame(
      lang,
      fn || UNKNOWN_FUNCTION,
      file,
      lineNo ? Number(lineNo) : undefined,
      colNo ? Number(colNo) : undefined,
    );
  }

  return undefined;
}

/**
 * Parse a `error.stack` string into PostHog stack frames, oldest call first.
 *
 * Returns an empty array when nothing parsed. Callers must treat that as
 * "no frames" and omit `stacktrace` entirely rather than sending an empty
 * frame list — PostHog renders the latter as a stack that exists and is empty.
 */
export function parseStackFrames(
  stack: string | undefined,
  lang = "javascript",
): PostHogStackFrame[] {
  if (!stack) return [];
  const frames: PostHogStackFrame[] = [];

  for (const rawLine of stack.split("\n")) {
    if (rawLine.length > MAX_STACK_LINE_LENGTH) continue;
    const line = WEBPACK_ERROR_RE.test(rawLine)
      ? rawLine.replace(WEBPACK_ERROR_RE, "$1")
      : rawLine;
    if (ERROR_HEADER_RE.test(line)) continue;

    const frame = parseFrameLine(line, lang);
    if (frame) frames.push(frame);
    if (frames.length >= STACKTRACE_FRAME_LIMIT) break;
  }

  frames.reverse();
  return frames;
}

/**
 * Build the `$exception_*` properties for a PostHog error-tracking event.
 *
 * The caller merges these into the event properties alongside `distinct_id`
 * and any app dimensions.
 */
export function toPostHogExceptionProperties(
  input: PostHogExceptionInput,
): PostHogExceptionProperties {
  const lang = input.lang ?? "javascript";
  const frames = parseStackFrames(input.stack, lang);
  const entry: PostHogExceptionEntry = {
    type: boundedText(input.type || "Error", 200),
    value: boundedText(
      input.value || input.type || "Error",
      MAX_MESSAGE_LENGTH,
    ),
    mechanism: {
      handled: input.handled ?? true,
      synthetic: input.synthetic ?? false,
      ...(input.mechanismType
        ? { type: boundedText(input.mechanismType, 100) }
        : {}),
    },
    ...(frames.length ? { stacktrace: { type: "raw" as const, frames } } : {}),
  };

  return {
    $exception_list: [entry],
    $exception_level: input.level ?? "error",
    ...(input.fingerprint
      ? { $exception_fingerprint: boundedText(input.fingerprint, 200) }
      : {}),
  };
}

/** Build `$exception_*` properties directly from a thrown value. */
export function errorToPostHogExceptionProperties(
  error: unknown,
  options: Omit<PostHogExceptionInput, "type" | "value" | "stack"> = {},
): PostHogExceptionProperties {
  const parts = exceptionParts(error);
  return toPostHogExceptionProperties({
    ...options,
    type: parts.type,
    value: parts.message,
    stack: parts.stack,
    synthetic: options.synthetic ?? !(error instanceof Error),
  });
}

/**
 * Reshape the camelCase properties emitted by `tracking/error-capture.ts` into
 * PostHog's `$exception_list` form.
 *
 * Returns `undefined` when the event carries no recognizable exception fields,
 * so the caller can pass it through untouched instead of inventing an empty
 * issue out of an unrelated event that happens to be named `$exception`.
 */
export function reshapeTrackedExceptionProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!properties) return undefined;
  // Already in PostHog form (e.g. relayed from the browser) — leave it alone.
  if (Array.isArray(properties.$exception_list)) return properties;

  const type = properties.exceptionType;
  const message = properties.exceptionMessage;
  if (typeof type !== "string" && typeof message !== "string") {
    return undefined;
  }

  const stack =
    typeof properties.exceptionStack === "string"
      ? properties.exceptionStack.slice(0, MAX_STACK_LENGTH)
      : undefined;
  const level = properties.level;

  const {
    exceptionType: _type,
    exceptionMessage: _message,
    exceptionStack: _stack,
    handled: _handled,
    level: _level,
    ...rest
  } = properties;

  return {
    ...rest,
    ...toPostHogExceptionProperties({
      type: typeof type === "string" ? type : "Error",
      value: typeof message === "string" ? message : "Error",
      stack,
      handled:
        typeof properties.handled === "boolean" ? properties.handled : true,
      level: isExceptionLevel(level) ? level : "error",
    }),
  };
}

function isExceptionLevel(value: unknown): value is PostHogExceptionLevel {
  return (
    value === "fatal" ||
    value === "error" ||
    value === "warning" ||
    value === "info" ||
    value === "debug"
  );
}
