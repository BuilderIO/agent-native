import { execFile as execFileCallback, spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const CLAUDE_CODE_VERSION = "2.1.208";
const WATCHDOG_TOOLS = "Read,Glob,Grep";
const WATCHDOG_DENIED_TOOLS = "Edit,Write,NotebookEdit,Bash";
const DRIVER_TOOLS = "Read,Glob,Grep,Edit,Write";
const DEFAULT_MAX_EVENTS = 2_000;
const DEFAULT_MAX_STREAM_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const DEFAULT_FORCE_SETTLE_MS = 250;
const MAX_ERROR_MESSAGE_LENGTH = 200;

const SAFE_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "USER",
  "LOGNAME",
  "SHELL",
  // Claude Code uses this as its config root; HOME remains required for its
  // default config and macOS Keychain-backed subscription login.
  "CLAUDE_CONFIG_DIR",
] as const;

export type ClaudeCodeParticipantRole = "watchdog" | "driver";

export interface ClaudeCodeSubscriptionStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  subscriptionType?: string;
}

export interface ClaudeCodeParticipantSession {
  sessionId?: string;
  resumeSessionId?: string;
  persist?: boolean;
}

export interface ClaudeCodeParticipantEvent {
  [key: string]: unknown;
}

export interface ClaudeCodeParticipantResult {
  exitCode: number;
  events: ClaudeCodeParticipantEvent[];
  stderr: string;
  stderrTruncated: boolean;
}

export interface ClaudeCodeParticipantChild {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
}

export interface ClaudeCodeParticipantSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
  stdio: ["pipe", "pipe", "pipe"];
}

export type ClaudeCodeParticipantSpawn = (
  command: string,
  args: string[],
  options: ClaudeCodeParticipantSpawnOptions,
) => ClaudeCodeParticipantChild;

export interface RunClaudeCodeParticipantOptions {
  role: ClaudeCodeParticipantRole;
  prompt: string;
  cwd: string;
  model?: string;
  session?: ClaudeCodeParticipantSession;
  /** Either the fixed CLI name or an absolute executable path for packaged apps. */
  command?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  maxEvents?: number;
  maxStreamBytes?: number;
  maxStderrBytes?: number;
  timeoutMs?: number;
  terminationGraceMs?: number;
  forceSettleMs?: number;
  onEvent?: (event: ClaudeCodeParticipantEvent) => void;
  preflight?: (
    context: ClaudeCodeParticipantPreflightContext,
  ) => Promise<ClaudeCodeSubscriptionStatus>;
  spawnProcess?: ClaudeCodeParticipantSpawn;
}

export interface ClaudeCodeParticipantPreflightContext {
  command: string;
  env: NodeJS.ProcessEnv;
}

export class ClaudeCodeSubscriptionRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeCodeSubscriptionRequiredError";
  }
}

export interface ClaudeCodeSubscriptionStatusOptions {
  command?: string;
  env?: NodeJS.ProcessEnv;
  execute?: typeof execFile;
}

export async function readClaudeCodeSubscriptionStatus(
  options: ClaudeCodeSubscriptionStatusOptions = {},
): Promise<ClaudeCodeSubscriptionStatus> {
  const execute = options.execute ?? execFile;
  const { stdout } = await execute(
    resolveCommand(options.command, "claude"),
    ["auth", "status", "--json"],
    {
      encoding: "utf8",
      maxBuffer: 128 * 1024,
      env: safeEnvironment(options.env ?? process.env),
    },
  );
  const parsed = JSON.parse(stdout) as unknown;
  const status = asRecord(parsed);
  if (!status || typeof status.loggedIn !== "boolean") {
    throw new Error("Claude Code returned an invalid authentication status.");
  }
  return {
    loggedIn: status.loggedIn,
    authMethod: readString(status.authMethod),
    apiProvider: readString(status.apiProvider),
    subscriptionType: readString(status.subscriptionType),
  };
}

export async function runClaudeCodeParticipant(
  options: RunClaudeCodeParticipantOptions,
): Promise<ClaudeCodeParticipantResult> {
  validateInput(options);
  const env = safeEnvironment(options.env ?? process.env);
  const command = resolveCommand(options.command, "claude");
  const subscription = await (options.preflight
    ? options.preflight({ command, env })
    : readClaudeCodeSubscriptionStatus({ command, env }));
  assertClaudeCodeSubscription(subscription);
  if (options.signal?.aborted) throw createAbortError();

  const args = buildClaudeCodeParticipantArgs(options);
  const spawnProcess =
    options.spawnProcess ??
    ((command, commandArgs, spawnOptions) =>
      spawn(command, commandArgs, spawnOptions));
  const child = spawnProcess(command, args, {
    cwd: options.cwd,
    env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });

  return collectClaudeCodeParticipantResult(child, options);
}

export function buildClaudeCodeParticipantArgs(
  options: Pick<RunClaudeCodeParticipantOptions, "role" | "model" | "session">,
): string[] {
  const args = [
    "--print",
    "--input-format",
    "text",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-chrome",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--setting-sources",
    "",
  ];

  if (options.role === "watchdog") {
    args.push(
      "--permission-mode",
      "plan",
      "--tools",
      WATCHDOG_TOOLS,
      "--disallowedTools",
      WATCHDOG_DENIED_TOOLS,
    );
  } else {
    args.push("--permission-mode", "acceptEdits", "--tools", DRIVER_TOOLS);
  }

  const model = readString(options.model);
  if (model) args.push("--model", model);
  const sessionId = readString(options.session?.sessionId);
  const resumeSessionId = readString(options.session?.resumeSessionId);
  if (sessionId) args.push("--session-id", sessionId);
  if (resumeSessionId) args.push("--resume", resumeSessionId);
  if (options.session?.persist !== true) args.push("--no-session-persistence");
  return args;
}

function collectClaudeCodeParticipantResult(
  child: ClaudeCodeParticipantChild,
  options: RunClaudeCodeParticipantOptions,
): Promise<ClaudeCodeParticipantResult> {
  const maxEvents = boundedLimit(options.maxEvents, DEFAULT_MAX_EVENTS);
  const maxStreamBytes = boundedLimit(
    options.maxStreamBytes,
    DEFAULT_MAX_STREAM_BYTES,
  );
  const maxStderrBytes = boundedLimit(
    options.maxStderrBytes,
    DEFAULT_MAX_STDERR_BYTES,
  );
  const timeoutMs = boundedDuration(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const terminationGraceMs = boundedDuration(
    options.terminationGraceMs,
    DEFAULT_TERMINATION_GRACE_MS,
  );
  const forceSettleMs = boundedDuration(
    options.forceSettleMs,
    DEFAULT_FORCE_SETTLE_MS,
  );
  const decoder = new StringDecoder("utf8");
  const stderrDecoder = new StringDecoder("utf8");
  const events: ClaudeCodeParticipantEvent[] = [];
  let pending = "";
  let streamBytes = 0;
  let stderr = "";
  let stderrBytes = 0;
  let stderrTruncated = false;
  let fatalError: Error | undefined;

  return new Promise((resolve, reject) => {
    let settled = false;
    let terminationTimer: NodeJS.Timeout | undefined;
    let forceSettleTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      stopWithError(new Error(`Claude Code timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    timeoutTimer.unref?.();
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abort);
      clearTimeout(timeoutTimer);
      if (terminationTimer) clearTimeout(terminationTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
    };
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(safeError(error));
    };
    const stopWithError = (error: Error) => {
      if (fatalError) return;
      fatalError = error;
      terminationTimer = setTimeout(() => {
        if (settled) return;
        forceSettleTimer = setTimeout(() => {
          finishError(fatalError ?? error);
        }, forceSettleMs);
        forceSettleTimer.unref?.();
        child.kill("SIGKILL");
      }, terminationGraceMs);
      terminationTimer.unref?.();
      child.kill("SIGTERM");
    };
    const abort = () => stopWithError(createAbortError());
    const streamError = (error: Error) => {
      if (!settled) stopWithError(error);
    };

    child.stdin.on("error", streamError);
    child.stdout.on("error", streamError);
    child.stderr.on("error", streamError);

    if (options.signal) {
      if (options.signal.aborted) abort();
      else options.signal.addEventListener("abort", abort, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      if (fatalError) return;
      const bytes = Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(chunk);
      streamBytes += bytes;
      if (streamBytes > maxStreamBytes) {
        stopWithError(
          new Error(`Claude Code stream exceeded ${maxStreamBytes} bytes.`),
        );
        return;
      }
      pending += decoder.write(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      );
      try {
        pending = consumeJsonLines(pending, events, maxEvents, options.onEvent);
      } catch (error) {
        stopWithError(toError(error));
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const encoded = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxStderrBytes - stderrBytes);
      if (remaining === 0) {
        stderrTruncated = true;
        return;
      }
      stderr += stderrDecoder.write(encoded.subarray(0, remaining));
      stderrBytes += Math.min(encoded.length, remaining);
      if (encoded.length > remaining) stderrTruncated = true;
    });
    child.once("error", finishError);
    child.once("close", (exitCode, exitSignal) => {
      if (settled) return;
      try {
        pending += decoder.end();
        stderr += stderrDecoder.end();
        if (pending.trim()) {
          consumeJsonLine(pending, events, maxEvents, options.onEvent);
        }
      } catch (error) {
        fatalError ??= toError(error);
      }
      if (fatalError) {
        finishError(fatalError);
        return;
      }
      if (exitCode !== 0) {
        finishError(
          new Error(
            `Claude Code exited with ${exitSignal ?? exitCode ?? "unknown"}${stderr ? `: ${summarizeStderr(stderr)}` : ""}`,
          ),
        );
        return;
      }
      settled = true;
      cleanup();
      resolve({
        exitCode: 0,
        events,
        stderr: sanitizeStderr(stderr),
        stderrTruncated,
      });
    });
    try {
      child.stdin.end(options.prompt);
    } catch (error) {
      stopWithError(toError(error));
    }
  });
}

function consumeJsonLines(
  value: string,
  events: ClaudeCodeParticipantEvent[],
  maxEvents: number,
  onEvent?: (event: ClaudeCodeParticipantEvent) => void,
): string {
  let start = 0;
  let newline = value.indexOf("\n", start);
  while (newline !== -1) {
    consumeJsonLine(value.slice(start, newline), events, maxEvents, onEvent);
    start = newline + 1;
    newline = value.indexOf("\n", start);
  }
  return value.slice(start);
}

function consumeJsonLine(
  line: string,
  events: ClaudeCodeParticipantEvent[],
  maxEvents: number,
  onEvent?: (event: ClaudeCodeParticipantEvent) => void,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (events.length >= maxEvents) {
    throw new Error(`Claude Code stream exceeded ${maxEvents} events.`);
  }
  const parsed = JSON.parse(trimmed) as unknown;
  const event = asRecord(parsed);
  if (!event) throw new Error("Claude Code emitted a non-object JSON event.");
  events.push(event);
  onEvent?.(event);
}

function assertClaudeCodeSubscription(
  status: ClaudeCodeSubscriptionStatus,
): void {
  if (
    !status.loggedIn ||
    status.authMethod !== "claude.ai" ||
    status.apiProvider !== "firstParty" ||
    !readString(status.subscriptionType)
  ) {
    throw new ClaudeCodeSubscriptionRequiredError(
      "Claude Code must be signed in with a Claude subscription. API-key and third-party provider fallback are disabled.",
    );
  }
}

function safeEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    SAFE_ENVIRONMENT_KEYS.flatMap((key) =>
      typeof input[key] === "string" ? [[key, input[key]]] : [],
    ),
  );
}

function validateInput(options: RunClaudeCodeParticipantOptions): void {
  if (!readString(options.prompt))
    throw new Error("Claude Code prompt is required.");
  if (!readString(options.cwd)) throw new Error("Claude Code cwd is required.");
  if (options.session?.sessionId && options.session.resumeSessionId) {
    throw new Error("Choose either a new Claude session id or a resume id.");
  }
  resolveCommand(options.command, "claude");
}

function boundedLimit(value: number | undefined, maximum: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value as number, maximum)
    : maximum;
}

function boundedDuration(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value as number, DEFAULT_TIMEOUT_MS)
    : fallback;
}

function resolveCommand(
  command: string | undefined,
  defaultCommand: string,
): string {
  const value = readString(command) ?? defaultCommand;
  if (value === defaultCommand) return value;
  if (value.includes("\0") || !isAbsolute(value)) {
    throw new Error("Claude Code command must be an absolute executable path.");
  }
  return value;
}

function createAbortError(): Error {
  const error = new Error("Claude Code participant was canceled.");
  error.name = "AbortError";
  return error;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function safeError(error: Error): Error {
  const safe = new Error(summarizeStderr(error.message));
  safe.name = error.name;
  return safe;
}

function summarizeStderr(value: string): string {
  return sanitizeStderr(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function sanitizeStderr(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/gi, "Bearer <redacted>")
    .replace(
      /(["']?)([A-Za-z_]*(?:token|key|secret|password)[A-Za-z_]*)\1\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
      '$1$2$1$3"<redacted>"',
    )
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, "<redacted>");
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export const CLAUDE_CODE_PARTICIPANT_TESTED_VERSION = CLAUDE_CODE_VERSION;
