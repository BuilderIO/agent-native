/**
 * Build PostHog error-tracking payloads from a raw JS error or from the
 * camelCase exception properties the framework's own `captureException()`
 * emits.
 *
 * SYMBOLICATION. A frame is only ever resolved against an uploaded source map
 * when it names a platform PostHog has a symbol store for AND carries the
 * `chunk_id` of the file it came from. `custom` is not such a platform:
 * `RawFrame::Custom.symbol_set_ref()` returns `None`, so a `custom` frame is
 * inert by construction and a correctly uploaded map cannot rescue it. This
 * module emitted `custom` unconditionally, on the premise — true when it was
 * written — that the framework ships no source maps. An app that DOES upload
 * them (`@posthog/cli sourcemap process` over its build output) then saw its
 * browser stacks resolve, because those come from posthog-js, and its server
 * stacks stay minified forever, because those come from here.
 *
 * So a frame now claims `node:javascript` — whose symbol-set reference IS its
 * `chunk_id` — exactly when a chunk id is known for its file, and stays
 * `custom` otherwise. `chunkIds` is passed in rather than read ambiently, so
 * this module keeps running unchanged in the browser, where the relayed
 * posthog-js frames are already `web:javascript` and must not be touched.
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
   * `"node:javascript"` when a `chunk_id` is known for this frame's file —
   * PostHog will look that chunk up and resolve the frame. `"custom"`
   * otherwise: claiming a symbolicable platform with nothing to symbolicate
   * against renders the frame as a FAILED resolution, which is strictly worse
   * than presenting it as the raw frame it is.
   */
  platform: "custom" | "node:javascript";
  lang: string;
  function: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  /**
   * The id `@posthog/cli sourcemap inject` stamped into this frame's file and
   * into its uploaded `.map`. Present only on `node:javascript` frames.
   */
  chunk_id?: string;
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
  /**
   * `filename → chunk_id` for the bundle these frames came from, from
   * `chunkIdsByFilename()`. Frames whose file is in it become symbolicable
   * `node:javascript` frames; everything else is unaffected.
   */
  chunkIds?: ChunkIdsByFilename;
}

/** `filename → chunk_id`, as produced by {@link chunkIdsByFilename}. */
export type ChunkIdsByFilename = Record<string, string>;

/**
 * Read the chunk-id registry `@posthog/cli sourcemap inject` left behind.
 *
 * The CLI prepends a snippet to every file it processes that does, at module
 * load, `globalThis._posthogChunkIds[new Error().stack] = "<uuid>"`. The key
 * is a STACK STRING, not a filename — so the registry is unusable until each
 * key is parsed back into the file that produced it. We parse it with
 * {@link parseStackFrames}, the same function that parses the exception being
 * reported, so both sides normalize `file://` prefixes identically; a
 * different parser matches nothing and fails silently.
 *
 * NOT MEMOIZED. The registry grows as chunks are lazily imported, so a
 * snapshot taken at boot would be missing exactly the route chunk that later
 * threw. It is rebuilt per report, on a path where something has already gone
 * wrong.
 */
export function chunkIdsByFilename(
  registry: Record<string, string> | undefined = (
    globalThis as { _posthogChunkIds?: Record<string, string> }
  )._posthogChunkIds,
): ChunkIdsByFilename {
  const byFilename: ChunkIdsByFilename = {};
  if (!registry) return byFilename;

  for (const [stack, chunkId] of Object.entries(registry)) {
    if (typeof stack !== "string" || typeof chunkId !== "string") continue;
    // Oldest-call-first, so the frame that ran the injected `new Error()` —
    // the chunk's own file — is the last one.
    const frames = parseStackFrames(stack);
    const filename = frames[frames.length - 1]?.filename;
    if (filename) byFilename[filename] = chunkId;
  }
  return byFilename;
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
  chunkIds: ChunkIdsByFilename | undefined,
): PostHogStackFrame {
  const name = !fn || fn === "<anonymous>" ? UNKNOWN_FUNCTION : fn;
  const chunkId = filename ? chunkIds?.[filename] : undefined;
  return {
    // Per-FRAME, not per-stack: a server stack mixes app chunks (injected,
    // resolvable) with `node:internal/…` frames (never injected). Deciding
    // once for the whole stack would either strand the app frames as `custom`
    // or claim a resolvable platform for frames that have nothing to resolve.
    platform: chunkId ? "node:javascript" : "custom",
    lang,
    function: name,
    ...(filename ? { filename } : {}),
    ...(lineno !== undefined && Number.isFinite(lineno) ? { lineno } : {}),
    ...(colno !== undefined && Number.isFinite(colno) ? { colno } : {}),
    ...(chunkId ? { chunk_id: chunkId } : {}),
    in_app: isInAppFrame(filename),
    // Never `true` on the way out: `resolved` describes what WE did, and we
    // resolve nothing. PostHog flips it when it symbolicates the frame.
    resolved: false,
  };
}

function parseFrameLine(
  line: string,
  lang: string,
  chunkIds: ChunkIdsByFilename | undefined,
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
      chunkIds,
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
      chunkIds,
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
  chunkIds?: ChunkIdsByFilename,
): PostHogStackFrame[] {
  if (!stack) return [];
  const frames: PostHogStackFrame[] = [];

  for (const rawLine of stack.split("\n")) {
    if (rawLine.length > MAX_STACK_LINE_LENGTH) continue;
    const line = WEBPACK_ERROR_RE.test(rawLine)
      ? rawLine.replace(WEBPACK_ERROR_RE, "$1")
      : rawLine;
    if (ERROR_HEADER_RE.test(line)) continue;

    const frame = parseFrameLine(line, lang, chunkIds);
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
  const frames = parseStackFrames(input.stack, lang, input.chunkIds);
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
  chunkIds?: ChunkIdsByFilename,
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
      chunkIds,
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
