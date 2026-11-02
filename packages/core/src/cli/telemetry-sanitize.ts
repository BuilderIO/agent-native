/**
 * What may leave the machine. `CLI_TELEMETRY_PROPERTIES` is the whole list:
 * `track` drops any other property, and a test fails if
 * `docs/content/telemetry.mdx` does not document every name here.
 *
 * Errors leave as their type, code, a short hint and the stack frames from our
 * own files. Raw messages, logs, paths and the developer's stack frames stay on
 * the machine.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_TELEMETRY_PROPERTIES: ReadonlySet<string> = new Set([
  // Every event
  "cli",
  "cliVersion",
  "command",
  "node",
  "platform",
  "ci",
  "interactive",
  "runId",
  "installId",
  // The skills install funnel
  "available",
  "availableCount",
  "skills",
  "selected",
  "selectedCount",
  "selectedAll",
  "preselected",
  "clients",
  "clientCount",
  "scope",
  "mode",
  "step",
  "dryRun",
  "durationMs",
  "writtenCount",
  "fileCount",
  "serverName",
  "authenticated",
  "error",
  // Added by the analytics event-name table
  "canonical_event_name",
  "legacy_event_name",
  // Crash reports
  "app",
  "template",
  "runtime",
  "source",
  "exceptionType",
  "exceptionCode",
  "exceptionMessage",
  "exceptionStack",
  "handled",
  "level",
  "occurredAt",
  "release",
  "exceptionTags",
  "exceptionExtra",
]);

export const CLI_EXCEPTION_TAGS: ReadonlySet<string> = new Set([
  "source",
  "buildStep",
  "template",
  "command",
  "handled",
]);

export const CLI_EXCEPTION_EXTRA: ReadonlySet<string> = new Set([
  "exitCode",
  "signal",
  "stage",
  "durationMs",
]);

const MAX_HINT_LENGTH = 20;
const MAX_KNOWN_MESSAGE_LENGTH = 200;
const MAX_VALUE_LENGTH = 2000;
const MAX_FRAMES = 30;
// Letters, digits and list separators. No path, URL or email fits through this.
const SAFE_STRING_RE = /^[\w .,+-]*$/;
const ERROR_NAME_RE = /^[A-Za-z_$][\w$.]{0,99}$/;
const ERROR_CODE_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const FRAME_RE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const FRAME_FUNCTION_RE = /^[\w$.<> ]+$/;
const PLAIN_WORD_RE = /^[A-Za-z]+$/;

/** An error whose message is fixed text we wrote, so it is safe to report whole. */
export class KnownCliError extends Error {}

/**
 * The message of a known error, or else the message's opening words, up to 20
 * characters. A word holding anything but letters ends the hint, and so does one
 * that would run past the limit, so no part of a path, URL, email or token gets
 * through. A colon may close the last word, to keep the label of "Label: detail".
 */
export function errorHint(error: unknown): string {
  if (error instanceof KnownCliError) {
    return error.message.slice(0, MAX_KNOWN_MESSAGE_LENGTH);
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  let hint = "";
  for (const word of message.split(" ")) {
    const letters = word.endsWith(":") ? word.slice(0, -1) : word;
    const next = hint ? `${hint} ${letters}` : letters;
    if (!PLAIN_WORD_RE.test(letters) || next.length > MAX_HINT_LENGTH) break;
    hint = next;
    if (letters !== word) break;
  }
  return hint;
}

export function safeErrorName(name: string | undefined): string {
  return name && ERROR_NAME_RE.test(name) ? name : "Error";
}

export function errorType(error: unknown): string {
  return safeErrorName(error instanceof Error ? error.name : undefined);
}

export function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && ERROR_CODE_RE.test(code)
    ? code
    : undefined;
}

function forwardSlashes(file: string): string {
  return file.replace(/\\/g, "/");
}

const NODE_MODULES = "/node_modules/";
const OWN_PACKAGES = new Set(["@agent-native/core", "@agent-native/skills"]);

// This file is at <package>/{src,dist}/cli/, however the CLI was installed.
const OWN_PACKAGE_ROOT = forwardSlashes(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
);
const OWN_PACKAGE_ROOTS: ReadonlyArray<readonly [string, string]> = [
  [OWN_PACKAGE_ROOT, "@agent-native/core"],
  [
    forwardSlashes(path.resolve(OWN_PACKAGE_ROOT, "../skills")),
    "@agent-native/skills",
  ],
];

function underRoot(file: string, root: string): string | null {
  const start = `${root}/`;
  const matches = /^[A-Za-z]:\//.test(root)
    ? file.toLowerCase().startsWith(start.toLowerCase())
    : file.startsWith(start);
  return matches ? file.slice(start.length) : null;
}

/**
 * The package-relative path of one of Agent-Native's own files, or null for
 * anything else: the developer's code, dependencies and Node internals.
 */
export function ownFilePath(file: string | undefined): string | null {
  if (!file) return null;
  let normalized = file;
  if (normalized.startsWith("file:")) {
    try {
      normalized = fileURLToPath(normalized);
      // coercion-ok: a URL we can't read as a path isn't one of our files
    } catch {
      return null;
    }
  }
  normalized = forwardSlashes(normalized).replace(/^\/([A-Za-z]:\/)/, "$1");

  // The innermost node_modules decides whose file this is.
  const modules = normalized.lastIndexOf(NODE_MODULES);
  if (modules >= 0) {
    const [scope, name, ...rest] = normalized
      .slice(modules + NODE_MODULES.length)
      .split("/");
    const owner = `${scope}/${name}`;
    return OWN_PACKAGES.has(owner) && rest.length
      ? `${owner}/${rest.join("/")}`
      : null;
  }
  for (const [root, name] of OWN_PACKAGE_ROOTS) {
    const relative = underRoot(normalized, root);
    if (relative) return `${name}/${relative}`;
  }
  return null;
}

export function ownFrameFunction(name: string | undefined): string | undefined {
  // `[as x]` names the caller's property, which can be the developer's word.
  const cleaned = name?.replace(/\s*\[as [^\]]*\]$/, "").trim();
  return cleaned && FRAME_FUNCTION_RE.test(cleaned) ? cleaned : undefined;
}

/** The stack with its message line gone and only our own frames left. */
export function ownStack(error: unknown, type: string): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  const frames: string[] = [];
  for (const line of error.stack.split("\n")) {
    const match = line.match(FRAME_RE);
    if (!match) continue;
    const file = ownFilePath(match[2]);
    if (!file) continue;
    const location = `${file}:${match[3]}:${match[4]}`;
    const fn = ownFrameFunction(match[1]);
    frames.push(fn ? `    at ${fn} (${location})` : `    at ${location}`);
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames.length ? `${type}\n${frames.join("\n")}` : undefined;
}

function safeValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH) {
    return undefined;
  }
  return SAFE_STRING_RE.test(value) ? value : undefined;
}

/** Keeps the listed fields whose values are plain and could not hold a path. */
export function pickSafeFields(
  fields: Record<string, unknown> | undefined,
  allowed: ReadonlySet<string>,
): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (!allowed.has(key)) continue;
    const clean = safeValue(value);
    if (clean !== undefined) safe[key] = clean;
  }
  return safe;
}

export function sanitizeEventProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const { error, ...rest } = properties ?? {};
  const safe: Record<string, unknown> = pickSafeFields(
    rest,
    CLI_TELEMETRY_PROPERTIES,
  );
  const hint = errorHint(error);
  if (hint) safe.error = hint;
  return safe;
}
