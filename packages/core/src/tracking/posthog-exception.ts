import {
  MAX_MESSAGE_LENGTH,
  MAX_STACK_LENGTH,
  boundedText,
  exceptionParts,
} from "./redaction.js";

const UNKNOWN_FUNCTION = "?";
const STACKTRACE_FRAME_LIMIT = 50;
const MAX_STACK_LINE_LENGTH = 1024;

const ERROR_HEADER_RE = /\S*Error: /;
const WEBPACK_ERROR_RE = /\(error: (.*)\)/;

const V8_FRAME_RE =
  /^\s*at (?:async )?(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+)|([^)]+))\)?\s*$/;
const GECKO_FRAME_RE = /^\s*(.*?)@(.+?)(?::(\d+))?(?::(\d+))?\s*$/;

export type PostHogExceptionLevel =
  | "fatal"
  | "error"
  | "warning"
  | "info"
  | "debug";

export interface PostHogStackFrame {
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
  type: string;
  value: string;
  stack?: string;
  handled?: boolean;
  synthetic?: boolean;
  mechanismType?: string;
  level?: PostHogExceptionLevel;
  fingerprint?: string;
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

export function reshapeTrackedExceptionProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!properties) return undefined;
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
