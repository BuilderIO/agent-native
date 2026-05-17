import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import type { ActionEntry } from "../agent/production-agent.js";

export interface CodingCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

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
}

interface EditOperation {
  oldText: string;
  newText: string;
  replaceAll: boolean;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;
const DEFAULT_MAX_FILE_READ_CHARS = 120_000;

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
          "Run a bash command. Use this for file discovery and search (rg --files, rg, find, ls), tests, builds, package commands, git status/diff, and project CLIs.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The bash command to run.",
            },
            cwd: {
              type: "string",
              description:
                "Optional working directory, relative to the workspace unless absolute paths are allowed.",
            },
            timeoutMs: {
              type: "string",
              description: "Optional timeout in milliseconds.",
            },
            stdin: {
              type: "string",
              description: "Optional stdin to pipe into the command.",
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

        const policyResult =
          (await options.beforeBash?.({
            command,
            cwd: commandCwd,
            timeoutMs,
          })) ?? null;
        if (policyResult) return policyResult;

        const result = await runCodingCommand(command, commandCwd, timeoutMs, {
          stdin: stringArg(args.stdin) || undefined,
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
          "Read a UTF-8 text file with line numbers. Use bash for directories, file lists, and search.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path to read.",
            },
            offset: {
              type: "string",
              description: "1-based line number to start reading from.",
            },
            limit: {
              type: "string",
              description: "Maximum number of lines to read.",
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
        return truncateCodingOutput(
          formatFileReadOutput(cwd, filePath, content, args),
          maxFileReadChars,
        );
      },
    },
    edit: {
      tool: {
        description:
          "Edit an existing UTF-8 text file by replacing exact text. Prefer this for focused source changes. oldText must match exactly and uniquely unless replaceAll is true. For batch edits, pass edits as a JSON array of {oldText,newText,replaceAll}.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path to edit.",
            },
            oldText: {
              type: "string",
              description: "Exact text to replace for a single edit.",
            },
            newText: {
              type: "string",
              description: "Replacement text for a single edit.",
            },
            replaceAll: {
              type: "string",
              description: 'Set to "true" to replace every occurrence.',
              enum: ["true", "false"],
            },
            edits: {
              type: "string",
              description:
                'Optional JSON array of edits, e.g. [{"oldText":"foo","newText":"bar"}].',
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

        return queueFileMutation(filePath, async () => {
          if (!fs.existsSync(filePath)) {
            throw new Error(`file not found: ${requestedPath}`);
          }
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) {
            throw new Error(`${requestedPath} is not a file`);
          }

          let content = fs.readFileSync(filePath, "utf8");
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
          return `Edited ${path.relative(cwd, filePath) || requestedPath} (${replacements} replacement${replacements === 1 ? "" : "s"}).`;
        });
      },
    },
    write: {
      tool: {
        description:
          "Create or fully overwrite a UTF-8 text file. Prefer edit for existing files unless a complete rewrite is intended.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path to write.",
            },
            content: {
              type: "string",
              description: "Full file content.",
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

        return queueFileMutation(filePath, async () => {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          const existed = fs.existsSync(filePath);
          fs.writeFileSync(filePath, content, "utf8");
          const bytes = Buffer.byteLength(content, "utf8");
          const lines = content.split("\n").length;
          return `${existed ? "Updated" : "Created"} ${path.relative(cwd, filePath) || requestedPath} (${lines} lines, ${bytes} bytes).`;
        });
      },
    },
  };
}

export async function runCodingCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  options: { stdin?: string } = {},
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
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  if (options.stdin) child.stdin?.end(options.stdin);
  else child.stdin?.end();
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
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
