import { scrubUserPaths, stripAnsi } from "../shared/error-noise.js";

// First-party telemetry bounds every `extra` string to 1000 characters and
// keeps the head; keep the tail ourselves, since the failure is at the end.
// This leaves a third party's machine, so keep as little of it as still names
// the failing step.
const MAX_STDERR_TAIL_CHARS = 600;

// Build output echoes connection strings and env assignments the generic
// key-name redaction downstream does not know: `postgres://user:pw@host`,
// `BUILDER_PRIVATE_KEY=...`, `SENTRY_DSN=...`, `DATABASE_URL=...`.
const URL_CREDENTIALS_RE = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/]*@/gi;
const SENSITIVE_ASSIGNMENT_RE =
  /\b([A-Za-z0-9_]*(?:PRIVATE_KEY|DSN|DATABASE_URL|CONNECTION_STRING|_URI|_URL)\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|\S+)/gi;
const PRIVATE_KEY_BLOCK_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

function redactBuildOutput(text: string): string {
  return text
    .replace(PRIVATE_KEY_BLOCK_RE, "<redacted>")
    .replace(URL_CREDENTIALS_RE, "$1<redacted>@")
    .replace(SENSITIVE_ASSIGNMENT_RE, "$1<redacted>");
}

export interface BuildStepFailureInput {
  label: string;
  exitCode: number;
  signal: string | null;
  stderrTail: string;
  template?: string;
  app?: string;
}

/**
 * The last lines of a failed child's stderr, safe to send off the machine:
 * colour codes stripped, the user's home directory replaced, URL credentials and
 * secret env assignments redacted before the tail is cut (a secret split by the
 * cut must not survive as a fragment), whole lines only. Other credential-looking
 * values are redacted downstream by the telemetry writer.
 */
export function scrubStderrTail(stderr: string): string {
  const scrubbed = redactBuildOutput(scrubUserPaths(stripAnsi(stderr))).trim();
  if (scrubbed.length <= MAX_STDERR_TAIL_CHARS) return scrubbed;
  const tail = scrubbed.slice(-MAX_STDERR_TAIL_CHARS);
  const firstBreak = tail.indexOf("\n");
  return firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail;
}

/**
 * The error and context for a build step that exited non-zero. The message
 * names only the step: the app or template is a tag, so one failing step is one
 * issue instead of one issue per app (and a private app name never lands in an
 * issue title).
 */
export function buildStepFailureReport(input: BuildStepFailureInput): {
  error: Error;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
} {
  return {
    error: new Error(`Build step "${input.label}" failed`),
    tags: {
      source: "build-step",
      buildStep: input.label,
      ...(input.template ? { template: input.template } : {}),
      ...(input.app ? { app: input.app } : {}),
    },
    extra: {
      exitCode: input.exitCode,
      signal: input.signal,
      stderrTail: scrubStderrTail(input.stderrTail),
    },
  };
}
