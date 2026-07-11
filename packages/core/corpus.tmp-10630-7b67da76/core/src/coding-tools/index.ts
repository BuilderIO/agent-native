import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ActionEntry } from "../agent/production-agent.js";

export interface CodingCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs?: number;
}

/**
 * Structured metadata emitted on tool_start / tool_done events so the UI can
 * render bespoke cells (bash terminal, edit diff, etc.) instead of the generic
 * pill.  Fields are additive — older consumers that don't know them are unaffected.
 */
export interface BashToolMetadata {
  toolKind: "bash";
  command: string;
  cwd: string;
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
}

export interface EditToolMetadata {
  toolKind: "edit";
  filePath: string;
  /** The exact old text replaced (capped at EDIT_CONTENT_MAX_CHARS). */
  oldText?: string;
  /** The exact new text written (capped at EDIT_CONTENT_MAX_CHARS). */
  newText?: string;
  truncated?: boolean;
}

export interface WriteToolMetadata {
  toolKind: "write";
  filePath: string;
  /** Full file content written (capped at EDIT_CONTENT_MAX_CHARS). */
  content?: string;
  truncated?: boolean;
  lineCount?: number;
}

export interface ReadToolMetadata {
  toolKind: "read";
  filePath: string;
  lineCount?: number;
}

export type StructuredToolMetadata =
  | BashToolMetadata
  | EditToolMetadata
  | WriteToolMetadata
  | ReadToolMetadata;

/** Callback invoked with incremental bash output while the command is running. */
export type BashOutputChunkCallback = (chunk: string) => void;

export interface CreateCodingToolRegistryOptions {
  cwd?: string;
  restrictToCwd?: boolean;
  commandTimeoutMs?: number;
  maxOutputChars?: number;
  maxFileReadChars?: number;
  bashThrowsOnNonZero?: boolean;
  canWrite?: (toolName: "edit" | "write") => string | null;
  beforeBash?: (input: {
    command: string;
    cwd: string;
    timeoutMs: number;
  }) => string | null | Promise<string | null>;
  /** Called with incremental stdout+stderr chunks while a bash command runs. */
  onBashOutputChunk?: BashOutputChunkCallback;
  /**
   * Called when structured metadata is available for a tool call.  The
   * `phase` is "start" (right before execution) or "done" (after execution).
   * This is the side-channel used to populate bespoke tool-cell fields without
   * changing the string-result contract that the agent sees.
   */
  onToolMetadata?: (
    toolName: string,
    phase: "start" | "done",
    meta: StructuredToolMetadata,
  ) => void;
}

interface EditOperation {
  oldText: string;
  newText: string;
  replaceAll: boolean;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;
const DEFAULT_MAX_FILE_READ_CHARS = 120_000;

/**
 * Output retention window for bash: keep first HEAD_CHARS + last TAIL_CHARS,
 * separated by a truncation marker.  Replaces the old flat 4 000-char cap.
 */
export const BASH_OUTPUT_HEAD_CHARS = 4_096;
export const BASH_OUTPUT_TAIL_CHARS = 16_384;

/** Maximum chars stored per side of an edit/write for diff rendering. */
export const EDIT_CONTENT_MAX_CHARS = 49_152;

const mutationQueues = new Map<string, Promise<unknown>>();

export function createCodingToolRegistry(
  options: CreateCodingToolRegistryOptions = {},
): Record<"bash" | "read" | "edit" | "write", ActionEntry> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const restrictToCwd = options.restrictToCwd ?? false;
  const commandTimeoutMs =
    options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const maxFileReadChars =
    options.maxFileReadChars ?? DEFAULT_MAX_FILE_READ_CHARS;

  return {
    bash: {
      tool: {
        description:
          'Run a shell command. This is the tool for file discovery, directory listing, and search: reach first for `rg <pattern>` and `rg --files`, which are much faster than `grep` or `find`. Also use it to run tests, builds, package scripts, `git status`/`git diff`, and project CLIs. Use the read tool to view a single file\'s contents; use bash for everything else. Very long output is truncated.\n\nSet `background` to "true" to spawn the command detached and return immediately. The tool returns the PID and a log file path; the process writes its stdout/stderr to that log file. You can read or tail the log file to check progress, and run `kill <pid>` to stop it. Background processes are not killed when the timeout expires.',
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to run (executed via bash).",
            },
            cwd: {
              type: "string",
              description:
                "Working directory for the command. Relative to the workspace root unless absolute paths are allowed. Defaults to the workspace root.",
            },
            timeoutMs: {
              type: "string",
              description:
                "Timeout in milliseconds; the command is killed if it exceeds this. Defaults to 120000, capped at 600000. Ignored when background is true.",
            },
            stdin: {
              type: "string",
              description: "Text to pipe into the command's stdin.",
            },
            background: {
              type: "string",
              description:
                'Set to "true" to spawn the command detached in the background and return immediately. Returns the process PID and a log file path where stdout/stderr are written.',
              enum: ["true", "false"],
            },
          },
          required: ["command"],
        },
      },
      run: async (args) => {
        const command = stringArg(args.command);
        if (!command) return "Error: command is required.";
        const commandCwd =
          resolveCodingPath(cwd, stringArg(args.cwd) || ".", {
            restrictToCwd,
            allowEmpty: true,
          }) ?? "";
        if (!commandCwd) {
          return "Error: cwd must stay inside the workspace.";
        }
        const requestedTimeoutMs = Number(args.timeoutMs);
        const timeoutMs =
          Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
            ? Math.min(requestedTimeoutMs, 10 * 60_000)
            : commandTimeoutMs;

        const isBackground =
          stringArg(args.background).toLowerCase() === "true";

        const policyResult =
          (await options.beforeBash?.({
            command,
            cwd: commandCwd,
            timeoutMs,
          })) ?? null;
        if (policyResult) return policyResult;

        options.onToolMetadata?.("bash", "start", {
          toolKind: "bash",
          command,
          cwd: commandCwd,
        });

        if (isBackground) {
          const result = spawnBackgroundCommand(command, commandCwd);
          options.onToolMetadata?.("bash", "done", {
            toolKind: "bash",
            command,
            cwd: commandCwd,
          });
          return result;
        }

        const result = await runCodingCommand(command, commandCwd, timeoutMs, {
          stdin: stringArg(args.stdin) || undefined,
          onChunk: options.onBashOutputChunk,
        });

        options.onToolMetadata?.("bash", "done", {
          toolKind: "bash",
          command,
          cwd: commandCwd,
          exitCode: result.code,
          durationMs: result.durationMs,
          timedOut: result.timedOut || undefined,
        });

        if (options.bashThrowsOnNonZero && result.code !== 0) {
          throw new Error(formatCodingCommandResult(result, maxOutputChars));
        }
        return formatCodingCommandResult(result, maxOutputChars, {
          omitEmptyExitCode: options.bashThrowsOnNonZero && result.code === 0,
        });
      },
    },
    read: {
      readOnly: true,
      tool: {
        description:
          "Read a single UTF-8 text file, returned with 1-based line numbers. For a large file, use offset and limit to page through it instead of reading the whole thing. Read a file before editing it so your edit's oldText matches exactly. Use bash (`ls`, `rg --files`, `rg`) for directory listings, file discovery, and search; this tool reads one file only.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the file to read, relative to the workspace root unless absolute paths are allowed.",
            },
            offset: {
              type: "string",
              description:
                "1-based line number to start reading from. Defaults to the first line.",
            },
            limit: {
              type: "string",
              description:
                "Maximum number of lines to read from offset. Defaults to the rest of the file.",
            },
          },
          required: ["path"],
        },
      },
      run: async (args) => {
        const requestedPath = stringArg(args.path);
        const filePath = resolveCodingPath(cwd, requestedPath, {
          restrictToCwd,
        });
        if (!filePath) return "Error: path must stay inside the workspace.";
        if (!fs.existsSync(filePath)) {
          return `Error: file not found: ${requestedPath}`;
        }
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) {
          return `Error: ${requestedPath} is not a file. Use bash for directories and file lists.`;
        }
        const content = fs.readFileSync(filePath, "utf8");
        const lineCount = content.split("\n").length;
        options.onToolMetadata?.("read", "start", {
          toolKind: "read",
          filePath: path.relative(cwd, filePath) || requestedPath,
          lineCount,
        });
        const result = truncateCodingOutput(
          formatFileReadOutput(cwd, filePath, content, args),
          maxFileReadChars,
        );
        options.onToolMetadata?.("read", "done", {
          toolKind: "read",
          filePath: path.relative(cwd, filePath) || requestedPath,
          lineCount,
        });
        return result;
      },
    },
    edit: {
      tool: {
        description:
          "Edit an existing UTF-8 text file by replacing exact text. Prefer this over write for changes to existing files. Read the file first so oldText matches byte-for-byte, including whitespace and indentation. oldText must occur EXACTLY ONCE in the file: include enough surrounding context to make it unique. The edit fails (and the file is left unchanged) if oldText is not found or matches more than once, unless replaceAll is true, which replaces every occurrence. To apply several edits to one file in a single call, pass edits as a JSON array of {oldText, newText, replaceAll} objects; they apply in order, and any failure aborts the whole call.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the file to edit, relative to the workspace root unless absolute paths are allowed.",
            },
            oldText: {
              type: "string",
              description:
                "Exact existing text to replace, for a single edit. Must match the file exactly and uniquely (include surrounding context) unless replaceAll is true.",
            },
            newText: {
              type: "string",
              description: "Text to replace oldText with, for a single edit.",
            },
            replaceAll: {
              type: "string",
              description:
                'Set to "true" to replace every occurrence of oldText instead of requiring a unique match. Defaults to "false".',
              enum: ["true", "false"],
            },
            edits: {
              type: "string",
              description:
                'JSON array of edits to apply to this file in one call, e.g. [{"oldText":"foo","newText":"bar"},{"oldText":"baz","newText":"qux","replaceAll":"true"}]. When provided, the top-level oldText/newText are ignored.',
            },
          },
          required: ["path"],
        },
      },
      run: async (args) => {
        const permissionError = options.canWrite?.("edit") ?? null;
        if (permissionError) return permissionError;

        const requestedPath = stringArg(args.path);
        const filePath = resolveCodingPath(cwd, requestedPath, {
          restrictToCwd,
        });
        if (!filePath) return "Error: path must stay inside the workspace.";
        const edits = parseEditOperations(args);
        const relPath = path.relative(cwd, filePath) || requestedPath;

        options.onToolMetadata?.("edit", "start", {
          toolKind: "edit",
          filePath: relPath,
        });

        return queueFileMutation(filePath, async () => {
          if (!fs.existsSync(filePath)) {
            throw new Error(`file not found: ${requestedPath}`);
          }
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) {
            throw new Error(`${requestedPath} is not a file`);
          }

          const originalContent = fs.readFileSync(filePath, "utf8");
          let content = originalContent;
          let replacements = 0;
          for (const edit of edits) {
            const count = countOccurrences(content, edit.oldText);
            if (count === 0) {
              throw new Error(
                `oldText was not found in ${requestedPath}: ${previewText(
                  edit.oldText,
                )}`,
              );
            }
            if (!edit.replaceAll && count !== 1) {
              throw new Error(
                `oldText matched ${count} times in ${requestedPath}; make it unique or set replaceAll=true.`,
              );
            }
            content = edit.replaceAll
              ? content.split(edit.oldText).join(edit.newText)
              : content.replace(edit.oldText, edit.newText);
            replacements += edit.replaceAll ? count : 1;
          }

          fs.writeFileSync(filePath, content, "utf8");

          // Emit structured diff metadata so the UI can render a real diff.
          const truncated =
            originalContent.length > EDIT_CONTENT_MAX_CHARS ||
            content.length > EDIT_CONTENT_MAX_CHARS;
          options.onToolMetadata?.("edit", "done", {
            toolKind: "edit",
            filePath: relPath,
            oldText: originalContent.slice(0, EDIT_CONTENT_MAX_CHARS),
            newText: content.slice(0, EDIT_CONTENT_MAX_CHARS),
            truncated,
          });

          return `Edited ${relPath} (${replacements} replacement${replacements === 1 ? "" : "s"}).`;
        });
      },
    },
    write: {
      tool: {
        description:
          "Create a new UTF-8 text file, or fully overwrite an existing one with the given content. Missing parent directories are created. For changes to an existing file, prefer edit; only use write when you intend to replace the entire file. Default to ASCII content unless the file already uses other characters or there is a clear reason not to.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the file to write, relative to the workspace root unless absolute paths are allowed.",
            },
            content: {
              type: "string",
              description:
                "Full contents to write. This replaces the entire file; existing content is not preserved.",
            },
          },
          required: ["path", "content"],
        },
      },
      run: async (args) => {
        const permissionError = options.canWrite?.("write") ?? null;
        if (permissionError) return permissionError;

        const requestedPath = stringArg(args.path);
        const filePath = resolveCodingPath(cwd, requestedPath, {
          restrictToCwd,
        });
        if (!filePath) return "Error: path must stay inside the workspace.";
        const content = stringArg(args.content);
        const relPath = path.relative(cwd, filePath) || requestedPath;

        options.onToolMetadata?.("write", "start", {
          toolKind: "write",
          filePath: relPath,
        });

        return queueFileMutation(filePath, async () => {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          const existed = fs.existsSync(filePath);
          fs.writeFileSync(filePath, content, "utf8");
          const bytes = Buffer.byteLength(content, "utf8");
          const lines = content.split("\n").length;

          const truncated = content.length > EDIT_CONTENT_MAX_CHARS;
          options.onToolMetadata?.("write", "done", {
            toolKind: "write",
            filePath: relPath,
            content: content.slice(0, EDIT_CONTENT_MAX_CHARS),
            truncated,
            lineCount: lines,
          });

          return `${existed ? "Updated" : "Created"} ${relPath} (${lines} lines, ${bytes} bytes).`;
        });
      },
    },
  };
}

export async function runCodingCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  options: { stdin?: string; onChunk?: BashOutputChunkCallback } = {},
): Promise<CodingCommandResult> {
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const startMs = Date.now();
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stdout += text;
    options.onChunk?.(text);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    stderr += text;
    options.onChunk?.(text);
  });
  if (options.stdin) child.stdin?.end(options.stdin);
  else child.stdin?.end();
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut, durationMs: Date.now() - startMs };
}

/**
 * Spawn a command detached in the background.  Returns immediately with the
 * process PID and a temporary log file path where stdout + stderr are written.
 *
 * The child process is intentionally detached from the parent's process group
 * (`detached: true`, `unref()`) so it continues running after the tool call
 * completes and is not killed if the agent run exits.  The approval classifier
 * still applies before this function is reached (see `beforeBash` in the
 * calling registry).
 */
export function spawnBackgroundCommand(command: string, cwd: string): string {
  const logFile = path.join(
    os.tmpdir(),
    `an-bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.log`,
  );

  const logFd = fs.openSync(logFile, "a");
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ["ignore", logFd, logFd],
    detached: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  child.unref();
  fs.closeSync(logFd);

  const pid = child.pid ?? 0;
  return [
    `Background process spawned.`,
    `pid: ${pid}`,
    `log: ${logFile}`,
    `Read the log file to check progress. Run \`kill ${pid}\` to stop the process.`,
  ].join("\n");
}

export function formatCodingCommandResult(
  result: CodingCommandResult,
  maxChars = DEFAULT_MAX_OUTPUT_CHARS,
  options: { omitEmptyExitCode?: boolean } = {},
): string {
  const parts = [
    options.omitEmptyExitCode && result.code === 0
      ? ""
      : `exitCode: ${result.code}`,
    result.timedOut ? "timedOut: true" : "",
    result.stdout ? `stdout:\n${result.stdout}` : "",
    result.stderr ? `stderr:\n${result.stderr}` : "",
  ].filter(Boolean);
  return truncateCodingOutput(parts.join("\n\n") || "(no output)", maxChars);
}

export function truncateCodingOutput(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n...[truncated ${value.length - max} chars]`;
}

/**
 * Retain the first HEAD_CHARS and the last TAIL_CHARS of bash output, inserting
 * a truncation marker in the middle.  This is a better window than a simple
 * prefix slice because the end of the output usually contains the most important
 * signal (error messages, test results, etc.).
 */
export function truncateBashOutput(
  value: string,
  headChars = BASH_OUTPUT_HEAD_CHARS,
  tailChars = BASH_OUTPUT_TAIL_CHARS,
): string {
  const max = headChars + tailChars;
  if (value.length <= max) return value;
  const omitted = value.length - max;
  return `${value.slice(0, headChars)}\n\n...[${omitted} chars omitted]\n\n${value.slice(value.length - tailChars)}`;
}

export function isReadOnlyShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return false;

  // Read-only modes get a deliberately tiny shell grammar: one command only,
  // no redirection, pipes, sequencing, backgrounding, or command substitution.
  // Prefix allowlists are not safe until these shell forms are excluded.
  if (/[\n\r;&|<>]/.test(normalized)) return false;
  if (/\$\(|`|\${|\\\n/.test(command)) return false;

  // `sed` can WRITE even in `-n` mode via the `w`/`W` commands or `-i`
  // (e.g. `sed -n '1w out.txt' file`), so the `^sed -n` allowlist entry
  // below is not safe on its own. Reject any sed that can write.
  if (/^sed\b/.test(normalized)) {
    if (/(^|\s)-i(\b|=)|--in-place/.test(normalized)) return false;
    // `w`/`W` used as a sed command: preceded by an address/separator
    // (digit, $, /, }, ;, quote, space) and followed by a filename arg or
    // end. Catches `1w f`, `$w f`, `/re/w f`, `s/x/y/w f`, `2W f`; leaves
    // prints like `/window/p`, `1,5p`, `s/a/b/` untouched.
    if (/[\s'"0-9$}/;](w|W)([\s'"]|$)/.test(normalized)) return false;
  }

  const allowedPrefixes = [
    /^pwd\b/,
    /^ls\b/,
    /^find\b/,
    /^rg\b/,
    /^grep\b/,
    /^cat\b/,
    /^sed\s+-n\b/,
    /^head\b/,
    /^tail\b/,
    /^wc\b/,
    /^git\s+(status|diff|show|log)\b/,
    /^git\s+branch\s+--show-current\b/,
  ];
  return allowedPrefixes.some((pattern) => pattern.test(normalized));
}

function resolveCodingPath(
  cwd: string,
  value: string,
  options: { restrictToCwd: boolean; allowEmpty?: boolean },
): string | null {
  if (!value.trim() && !options.allowEmpty) return null;
  const target = value.trim() || ".";
  const resolved = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(cwd, target);
  if (!options.restrictToCwd) return resolved;

  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function formatFileReadOutput(
  cwd: string,
  filePath: string,
  content: string,
  args: Record<string, unknown>,
): string {
  const lines = content.split("\n");
  const offset = positiveInteger(args.offset, 1);
  const limit = positiveInteger(args.limit, lines.length - offset + 1);
  const selected = lines.slice(offset - 1, offset - 1 + limit);
  const body = selected
    .map((line, index) => `${String(offset + index).padStart(5)} | ${line}`)
    .join("\n");
  return `${path.relative(cwd, filePath) || filePath} (${lines.length} lines)\n${body}`;
}

function parseEditOperations(args: Record<string, unknown>): EditOperation[] {
  const editsJson = stringArg(args.edits);
  if (editsJson.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(editsJson);
    } catch (err) {
      throw new Error(
        `edits must be valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("edits must be a non-empty JSON array.");
    }
    return parsed.map((edit, index) => {
      if (!edit || typeof edit !== "object") {
        throw new Error(`edits[${index}] must be an object.`);
      }
      return normalizeEditOperation(edit as Record<string, unknown>, index);
    });
  }

  return [normalizeEditOperation(args, 0)];
}

function normalizeEditOperation(
  edit: Record<string, unknown>,
  index: number,
): EditOperation {
  const oldText = typeof edit.oldText === "string" ? edit.oldText : undefined;
  const newText = typeof edit.newText === "string" ? edit.newText : undefined;
  if (!oldText) {
    throw new Error(
      index === 0
        ? "oldText is required and cannot be empty."
        : `edits[${index}].oldText is required and cannot be empty.`,
    );
  }
  if (newText === undefined) {
    throw new Error(
      index === 0
        ? "newText is required."
        : `edits[${index}].newText is required.`,
    );
  }
  return {
    oldText,
    newText,
    replaceAll: stringArg(edit.replaceAll).toLowerCase() === "true",
  };
}

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    index = value.indexOf(needle, index);
    if (index === -1) return count;
    count += 1;
    index += needle.length;
  }
}

function queueFileMutation<T>(filePath: string, task: () => Promise<T> | T) {
  const previous = mutationQueues.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  let queued: Promise<unknown>;
  queued = next.finally(() => {
    if (mutationQueues.get(filePath) === queued)
      mutationQueues.delete(filePath);
  });
  mutationQueues.set(filePath, queued);
  return next;
}

function previewText(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}...` : oneLine;
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
