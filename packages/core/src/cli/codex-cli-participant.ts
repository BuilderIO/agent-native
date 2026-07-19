import { execFile as execFileCallback, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const CODEX_CLI_VERSION = "0.144.3";
const DEFAULT_MAX_EVENTS = 2_000;
const DEFAULT_MAX_STREAM_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 128 * 1024;

const API_FALLBACK_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORG_ID",
  "OPENAI_ORGANIZATION",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_AD_TOKEN",
  "AZURE_OPENAI_ENDPOINT",
  "CODEX_API_KEY",
] as const;

export type CodexCliParticipantRole = "planning" | "watchdog" | "driver";

export interface CodexCliSubscriptionStatus {
  loggedIn: boolean;
  authMode?: "ChatGPT" | "API key" | "unknown";
}

export interface CodexCliParticipantSession {
  /** Codex owns and interprets this value; Agent Native only persists it. */
  resumeSessionId?: string;
}

export interface CodexCliParticipantEvent {
  [key: string]: unknown;
}

export interface CodexCliParticipantResult {
  exitCode: number;
  events: CodexCliParticipantEvent[];
  stderr: string;
  stderrTruncated: boolean;
  resumeSessionId?: string;
}

export interface CodexCliParticipantChild {
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

export interface CodexCliParticipantSpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: false;
  stdio: ["pipe", "pipe", "pipe"];
}

export type CodexCliParticipantSpawn = (
  command: "codex",
  args: string[],
  options: CodexCliParticipantSpawnOptions,
) => CodexCliParticipantChild;

export interface RunCodexCliParticipantOptions {
  role: CodexCliParticipantRole;
  prompt: string;
  cwd: string;
  model?: string;
  session?: CodexCliParticipantSession;
  /** Drivers remain read-only unless this explicit capability is true. */
  allowWorkspaceWrite?: boolean;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  maxEvents?: number;
  maxStreamBytes?: number;
  maxStderrBytes?: number;
  onEvent?: (event: CodexCliParticipantEvent) => void;
  preflight?: () => Promise<CodexCliSubscriptionStatus>;
  spawnProcess?: CodexCliParticipantSpawn;
}

export class CodexCliSubscriptionRequiredError extends Error {
  constructor() {
    super(
      "Codex CLI must be signed in with a ChatGPT subscription. API-key fallback is disabled.",
    );
    this.name = "CodexCliSubscriptionRequiredError";
  }
}

export async function readCodexCliSubscriptionStatus(): Promise<CodexCliSubscriptionStatus> {
  try {
    const { stdout, stderr } = await execFile("codex", ["login", "status"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024,
      timeout: 3_000,
      windowsHide: true,
    });
    const output = `${stdout}\n${stderr}`;
    return {
      loggedIn: /logged in using/i.test(output),
      authMode: /logged in using\s+chatgpt/i.test(output)
        ? "ChatGPT"
        : /logged in using\s+(?:an?\s+)?api key/i.test(output)
          ? "API key"
          : "unknown",
    };
  } catch {
    return { loggedIn: false };
  }
}

export async function runCodexCliParticipant(
  options: RunCodexCliParticipantOptions,
): Promise<CodexCliParticipantResult> {
  validateInput(options);
  const subscription = await (
    options.preflight ?? readCodexCliSubscriptionStatus
  )();
  if (!subscription.loggedIn || subscription.authMode !== "ChatGPT") {
    throw new CodexCliSubscriptionRequiredError();
  }
  if (options.signal?.aborted) throw createAbortError();

  const args = buildCodexCliParticipantArgs(options);
  const env = withoutApiFallback(options.env ?? process.env);
  const spawnProcess =
    options.spawnProcess ??
    ((command, commandArgs, spawnOptions) =>
      spawn(command, commandArgs, spawnOptions));
  const child = spawnProcess("codex", args, {
    cwd: options.cwd,
    env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return collectCodexCliParticipantResult(child, options);
}

export function buildCodexCliParticipantArgs(
  options: Pick<
    RunCodexCliParticipantOptions,
    "role" | "cwd" | "model" | "session" | "allowWorkspaceWrite"
  >,
): string[] {
  const sandbox =
    options.role === "driver" && options.allowWorkspaceWrite === true
      ? "workspace-write"
      : "read-only";
  const args = [
    "--ask-for-approval",
    "never",
    "--sandbox",
    sandbox,
    "--cd",
    options.cwd,
    "exec",
  ];
  const resumeSessionId = readString(options.session?.resumeSessionId);
  if (resumeSessionId) args.push("resume");
  args.push("--json", "--skip-git-repo-check", "--ignore-user-config");

  const model = readString(options.model);
  if (model) args.push("--model", model);
  if (resumeSessionId) args.push("--", resumeSessionId, "-");
  else args.push("-");
  return args;
}

function collectCodexCliParticipantResult(
  child: CodexCliParticipantChild,
  options: RunCodexCliParticipantOptions,
): Promise<CodexCliParticipantResult> {
  const maxEvents = boundedLimit(options.maxEvents, DEFAULT_MAX_EVENTS);
  const maxStreamBytes = boundedLimit(
    options.maxStreamBytes,
    DEFAULT_MAX_STREAM_BYTES,
  );
  const maxStderrBytes = boundedLimit(
    options.maxStderrBytes,
    DEFAULT_MAX_STDERR_BYTES,
  );
  const decoder = new StringDecoder("utf8");
  const events: CodexCliParticipantEvent[] = [];
  let pending = "";
  let streamBytes = 0;
  let stderr = "";
  let stderrBytes = 0;
  let stderrTruncated = false;
  let fatalError: Error | undefined;
  let resumeSessionId: string | undefined;

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const stopWithError = (error: Error) => {
      if (fatalError) return;
      fatalError = error;
      child.kill("SIGTERM");
    };
    const abort = () => stopWithError(createAbortError());
    const consume = (line: string) => {
      const event = consumeJsonLine(line, events, maxEvents, options.onEvent);
      const threadId = readString(event?.thread_id);
      if (event?.type === "thread.started" && threadId) {
        resumeSessionId = threadId;
      }
    };

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
          new Error(`Codex CLI stream exceeded ${maxStreamBytes} bytes.`),
        );
        return;
      }
      pending += decoder.write(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      );
      try {
        let newline = pending.indexOf("\n");
        while (newline !== -1) {
          consume(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          newline = pending.indexOf("\n");
        }
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
      stderr += encoded.subarray(0, remaining).toString();
      stderrBytes += Math.min(encoded.length, remaining);
      if (encoded.length > remaining) stderrTruncated = true;
    });
    child.once("error", finishError);
    child.once("close", (exitCode, exitSignal) => {
      if (settled) return;
      try {
        pending += decoder.end();
        if (pending.trim()) consume(pending);
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
            `Codex CLI exited with ${exitSignal ?? exitCode ?? "unknown"}${stderr ? `: ${stderr.trim()}` : ""}`,
          ),
        );
        return;
      }
      settled = true;
      cleanup();
      resolve({
        exitCode: 0,
        events,
        stderr,
        stderrTruncated,
        ...(resumeSessionId ? { resumeSessionId } : {}),
      });
    });
    child.stdin.end(options.prompt);
  });
}

function consumeJsonLine(
  line: string,
  events: CodexCliParticipantEvent[],
  maxEvents: number,
  onEvent?: (event: CodexCliParticipantEvent) => void,
): CodexCliParticipantEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  if (events.length >= maxEvents) {
    throw new Error(`Codex CLI stream exceeded ${maxEvents} events.`);
  }
  const parsed = JSON.parse(trimmed) as unknown;
  const event = asRecord(parsed);
  if (!event) throw new Error("Codex CLI emitted a non-object JSON event.");
  events.push(event);
  onEvent?.(event);
  return event;
}

function withoutApiFallback(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...input };
  for (const key of API_FALLBACK_ENV_KEYS) delete env[key];
  return env;
}

function validateInput(options: RunCodexCliParticipantOptions): void {
  if (!readString(options.prompt))
    throw new Error("Codex CLI prompt is required.");
  if (!readString(options.cwd)) throw new Error("Codex CLI cwd is required.");
  if (options.allowWorkspaceWrite && options.role !== "driver") {
    throw new Error("Only a Codex driver can receive workspace-write access.");
  }
  const model = readString(options.model);
  if (model?.startsWith("-")) throw new Error("Codex CLI model is invalid.");
  const resumeSessionId = readString(options.session?.resumeSessionId);
  if (resumeSessionId?.includes("\0")) {
    throw new Error("Codex CLI resume state is invalid.");
  }
}

function boundedLimit(value: number | undefined, maximum: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? Math.min(value as number, maximum)
    : maximum;
}

function createAbortError(): Error {
  const error = new Error("Codex CLI participant was canceled.");
  error.name = "AbortError";
  return error;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): CodexCliParticipantEvent | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as CodexCliParticipantEvent)
    : undefined;
}

export const CODEX_CLI_PARTICIPANT_TESTED_VERSION = CODEX_CLI_VERSION;
