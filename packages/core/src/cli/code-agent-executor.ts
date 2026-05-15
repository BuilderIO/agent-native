import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";

import {
  actionsToEngineTools,
  runAgentLoop,
  type ActionEntry,
} from "../agent/production-agent.js";
import {
  resolveEngine,
  getStoredModelForEngine,
  registerBuiltinEngines,
} from "../agent/engine/index.js";
import type {
  AgentEngine,
  EngineContentPart,
  EngineEvent,
  EngineMessage,
  EngineStreamOptions,
} from "../agent/engine/types.js";
import type { AgentChatEvent } from "../agent/types.js";
import { PROVIDER_ENV_VARS } from "../agent/engine/provider-env-vars.js";
import {
  appendCodeAgentTranscriptEvent,
  getCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
  updateCodeAgentRunRecord,
  type CodeAgentRunRecord,
} from "./code-agent-runs.js";

export interface ExecuteCodeAgentRunOptions {
  runId: string;
  prompt?: string;
  appendUserEvent?: boolean;
  engine?: AgentEngine;
  model?: string;
  stdout?: NodeJS.WritableStream;
  signal?: AbortSignal;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_TOOL_OUTPUT_CHARS = 50_000;
const MAX_FILE_READ_CHARS = 120_000;

export async function executeCodeAgentRun(
  options: ExecuteCodeAgentRunOptions,
): Promise<CodeAgentRunRecord | null> {
  const existing = getCodeAgentRunRecord(options.runId);
  if (!existing) return null;

  const prompt = options.prompt ?? latestUserPrompt(existing.id);
  if (!prompt) {
    appendCodeAgentTranscriptEvent({
      runId: existing.id,
      kind: "status",
      message: "No prompt was found for this Code Agents run.",
      metadata: { status: "errored", phase: "missing-prompt" },
    });
    return updateCodeAgentRunRecord(existing.id, {
      status: "errored",
      phase: "missing-prompt",
      progress: {
        label: "Missing prompt",
        completed: 0,
        total: 1,
        failed: 1,
        percent: 0,
      },
    });
  }

  if (options.appendUserEvent !== false) {
    appendCodeAgentTranscriptEvent({
      runId: existing.id,
      kind: "user",
      message: prompt,
      metadata: { source: "execution-prompt" },
    });
  }

  const running = updateCodeAgentRunRecord(existing.id, {
    status: "running",
    phase: "executing",
    progress: {
      label: "Running",
      completed: 0,
      total: 1,
      percent: 10,
    },
    metadata: {
      executionStartedAt: new Date().toISOString(),
    },
  });
  appendCodeAgentTranscriptEvent({
    runId: existing.id,
    kind: "status",
    message: "Code Agent run started.",
    metadata: { status: "running", phase: "executing" },
  });

  const engine = options.engine ?? (await resolveExecutorEngine());
  if (!engine) {
    const message =
      "No LLM provider key was found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or another supported provider key and resume this run.";
    options.stdout?.write(`${message}\n`);
    appendCodeAgentTranscriptEvent({
      runId: existing.id,
      kind: "status",
      message,
      metadata: { status: "paused", phase: "missing-credentials" },
    });
    return updateCodeAgentRunRecord(existing.id, {
      status: "paused",
      phase: "missing-credentials",
      needsApproval: true,
      progress: {
        label: "Missing credentials",
        completed: 0,
        total: 1,
        percent: 0,
      },
    });
  }

  const model =
    options.model ??
    process.env.AGENT_MODEL ??
    (await getStoredModelForEngine(engine).catch(() => undefined)) ??
    engine.defaultModel;
  const cwd = existing.cwd || process.cwd();
  const actions = createLocalCodeAgentActions(cwd);
  const tools = actionsToEngineTools(actions);
  const messages = buildCodeAgentMessages(existing, prompt);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else
      options.signal.addEventListener("abort", abortFromParent, { once: true });
  }

  let assistantText = "";
  const send = (event: AgentChatEvent) => {
    if (event.type === "text") {
      assistantText += event.text;
      options.stdout?.write(event.text);
      return;
    }
    if (event.type === "activity") {
      appendCodeAgentTranscriptEvent({
        runId: existing.id,
        kind: "status",
        message: event.label,
        metadata: { type: "activity", tool: event.tool },
      });
      return;
    }
    if (event.type === "tool_start") {
      appendCodeAgentTranscriptEvent({
        runId: existing.id,
        kind: "status",
        message: `Running ${event.tool}.`,
        metadata: { type: "tool_start", tool: event.tool, input: event.input },
      });
      return;
    }
    if (event.type === "tool_done") {
      appendCodeAgentTranscriptEvent({
        runId: existing.id,
        kind: "status",
        message: `Finished ${event.tool}.`,
        metadata: {
          type: "tool_done",
          tool: event.tool,
          result: truncate(event.result, 4000),
        },
      });
      return;
    }
    if (event.type === "error") {
      appendCodeAgentTranscriptEvent({
        runId: existing.id,
        kind: "status",
        message: event.error,
        metadata: { type: "error", errorCode: event.errorCode },
      });
    }
  };

  try {
    await runAgentLoop({
      engine,
      model,
      systemPrompt: codeAgentSystemPrompt(cwd),
      tools,
      actions,
      messages,
      send,
      signal: controller.signal,
      maxIterations: 12,
    });
    if (assistantText.trim()) {
      options.stdout?.write("\n");
      appendCodeAgentTranscriptEvent({
        runId: existing.id,
        kind: "system",
        message: assistantText.trim(),
        metadata: { role: "assistant", model, engine: engine.name },
      });
    }
    appendCodeAgentTranscriptEvent({
      runId: existing.id,
      kind: "status",
      message: "Code Agent run completed.",
      metadata: { status: "completed", phase: "complete" },
    });
    return updateCodeAgentRunRecord(existing.id, {
      status: "completed",
      phase: "complete",
      needsApproval: false,
      progress: {
        label: "Complete",
        completed: 1,
        total: 1,
        percent: 100,
      },
      metadata: {
        executionCompletedAt: new Date().toISOString(),
        engine: engine.name,
        model,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    options.stdout?.write(`\nCode Agent run failed: ${message}\n`);
    appendCodeAgentTranscriptEvent({
      runId: existing.id,
      kind: "status",
      message: `Code Agent run failed: ${message}`,
      metadata: { status: "errored", phase: "error" },
    });
    return updateCodeAgentRunRecord(existing.id, {
      status: controller.signal.aborted ? "paused" : "errored",
      phase: controller.signal.aborted ? "paused" : "error",
      progress: {
        label: controller.signal.aborted ? "Paused" : "Error",
        completed: 0,
        total: 1,
        failed: controller.signal.aborted ? 0 : 1,
        percent: 0,
      },
      metadata: {
        executionError: message,
        executionErroredAt: new Date().toISOString(),
      },
    });
  } finally {
    options.signal?.removeEventListener("abort", abortFromParent);
    void running;
  }
}

export async function executeExistingCodeAgentRun(
  runId: string,
  options: Omit<ExecuteCodeAgentRunOptions, "runId"> = {},
): Promise<CodeAgentRunRecord | null> {
  return executeCodeAgentRun({ ...options, runId, appendUserEvent: false });
}

function latestUserPrompt(runId: string): string {
  const events = listCodeAgentTranscriptEvents(runId);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === "user" && event.message.trim()) return event.message;
  }
  return "";
}

async function resolveExecutorEngine(): Promise<AgentEngine | null> {
  const fakeText = process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE;
  if (fakeText !== undefined) {
    return createFakeCodeAgentEngine(fakeText || "Done.");
  }
  registerBuiltinEngines();
  if (!hasAnyProviderCredential()) return null;
  return resolveEngine({ engineOption: process.env.AGENT_ENGINE });
}

function hasAnyProviderCredential(): boolean {
  if (process.env.AGENT_ENGINE) return true;
  if (PROVIDER_ENV_VARS.some((key) => Boolean(process.env[key]))) return true;
  return Boolean(
    process.env.BUILDER_PRIVATE_KEY && process.env.BUILDER_PUBLIC_KEY,
  );
}

function createFakeCodeAgentEngine(text: string): AgentEngine {
  return {
    name: "fake-code-agent",
    label: "Fake Code Agent",
    defaultModel: "fake-code-agent",
    supportedModels: ["fake-code-agent"],
    capabilities: {
      thinking: false,
      promptCaching: false,
      vision: false,
      computerUse: false,
      parallelToolCalls: false,
    },
    async *stream(_opts: EngineStreamOptions): AsyncIterable<EngineEvent> {
      yield { type: "text-delta", text };
      yield {
        type: "assistant-content",
        parts: [{ type: "text", text }],
      };
      yield {
        type: "usage",
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      yield { type: "stop", reason: "end_turn" };
    },
  };
}

function buildCodeAgentMessages(
  run: CodeAgentRunRecord,
  prompt: string,
): EngineMessage[] {
  const transcript = listCodeAgentTranscriptEvents(run.id)
    .slice(-40)
    .map((event) => {
      const label =
        event.kind === "user"
          ? "User"
          : event.metadata?.role === "assistant"
            ? "Assistant"
            : event.kind;
      return `${label}: ${event.message}`;
    })
    .join("\n");
  const context = transcript
    ? `\n\nPrevious session transcript:\n${transcript}`
    : "";
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${prompt}${context}`,
        },
      ],
    },
  ];
}

function codeAgentSystemPrompt(cwd: string): string {
  return `You are Agent-Native Code, a local coding agent running in ${cwd}.

Work like a careful senior engineer:
- Read relevant files before editing.
- Prefer small, focused changes.
- Do not create, switch, delete, reset, rebase, or stash git branches.
- Do not run destructive git commands.
- Use apply_patch or write_file for edits, then run focused verification.
- Keep the final answer concise and include files changed plus tests run.
- Respect any AGENTS.md instructions in the repository.`;
}

function createLocalCodeAgentActions(cwd: string): Record<string, ActionEntry> {
  return {
    list_files: {
      readOnly: true,
      tool: {
        description: "List files under the current repository/workspace.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description:
                "Optional substring or glob-like fragment to filter.",
            },
          },
          required: [],
        },
      },
      run: async (args) => {
        const result = await runCommand("rg --files", cwd, 30_000);
        const output =
          result.code === 0
            ? result.stdout
            : (await runCommand("find . -type f | sed 's#^./##'", cwd, 30_000))
                .stdout;
        const pattern = stringArg(args.pattern).toLowerCase();
        const files = output
          .split(/\r?\n/)
          .filter(Boolean)
          .filter((file) => !pattern || file.toLowerCase().includes(pattern))
          .slice(0, 500);
        return files.join("\n") || "(no files found)";
      },
    },
    search_files: {
      readOnly: true,
      tool: {
        description: "Search files with ripgrep.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query or regex." },
            glob: {
              type: "string",
              description: "Optional glob, for example src/**/*.ts.",
            },
          },
          required: ["query"],
        },
      },
      run: async (args) => {
        const query = stringArg(args.query);
        if (!query) return "Error: query is required.";
        const glob = stringArg(args.glob);
        const command = glob
          ? `rg --line-number --no-heading ${shellQuote(query)} -g ${shellQuote(glob)}`
          : `rg --line-number --no-heading ${shellQuote(query)}`;
        const result = await runCommand(command, cwd, 30_000);
        return truncate(
          result.stdout || result.stderr || "(no matches)",
          MAX_TOOL_OUTPUT_CHARS,
        );
      },
    },
    read_file: {
      readOnly: true,
      tool: {
        description: "Read a UTF-8 text file inside the workspace.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path." },
          },
          required: ["path"],
        },
      },
      run: async (args) => {
        const filePath = resolveInsideCwd(cwd, stringArg(args.path));
        if (!filePath) return "Error: path must stay inside the workspace.";
        if (!fs.existsSync(filePath))
          return `Error: file not found: ${args.path}`;
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return `Error: not a file: ${args.path}`;
        return truncate(fs.readFileSync(filePath, "utf8"), MAX_FILE_READ_CHARS);
      },
    },
    write_file: {
      tool: {
        description: "Write a complete UTF-8 text file inside the workspace.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative file path." },
            content: { type: "string", description: "Full file content." },
          },
          required: ["path", "content"],
        },
      },
      run: async (args) => {
        const filePath = resolveInsideCwd(cwd, stringArg(args.path));
        if (!filePath) return "Error: path must stay inside the workspace.";
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, stringArg(args.content));
        return `Wrote ${path.relative(cwd, filePath)}`;
      },
    },
    apply_patch: {
      tool: {
        description:
          "Apply a unified git patch from the workspace root. Prefer this for precise edits.",
        parameters: {
          type: "object",
          properties: {
            patch: { type: "string", description: "Unified diff patch text." },
          },
          required: ["patch"],
        },
      },
      run: async (args) => {
        const patch = stringArg(args.patch);
        if (!patch.trim()) return "Error: patch is required.";
        const result = await runCommand(
          "git apply --whitespace=nowarn -",
          cwd,
          30_000,
          patch,
        );
        if (result.code !== 0) {
          return `Error applying patch:\n${result.stderr || result.stdout}`;
        }
        return "Patch applied.";
      },
    },
    run_command: {
      tool: {
        description:
          "Run a shell command from the workspace root. Use for tests, typechecks, and safe project commands.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to run." },
            timeoutMs: {
              type: "string",
              description: "Optional timeout in milliseconds.",
            },
          },
          required: ["command"],
        },
      },
      run: async (args) => {
        const command = stringArg(args.command);
        if (!command) return "Error: command is required.";
        const timeoutMs = Number(args.timeoutMs);
        const result = await runCommand(
          command,
          cwd,
          Number.isFinite(timeoutMs) && timeoutMs > 0
            ? Math.min(timeoutMs, 10 * 60_000)
            : DEFAULT_COMMAND_TIMEOUT_MS,
        );
        return truncate(
          [
            `exitCode: ${result.code}`,
            result.timedOut ? "timedOut: true" : "",
            result.stdout ? `stdout:\n${result.stdout}` : "",
            result.stderr ? `stderr:\n${result.stderr}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
          MAX_TOOL_OUTPUT_CHARS,
        );
      },
    },
  };
}

function resolveInsideCwd(cwd: string, value: string): string | null {
  if (!value.trim()) return null;
  const resolved = path.resolve(cwd, value);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

async function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  stdin?: string,
): Promise<CommandResult> {
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ["pipe", "pipe", "pipe"],
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
  if (stdin) child.stdin?.end(stdin);
  else child.stdin?.end();
  const [code] = (await once(child, "exit")) as [number | null];
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n\n...[truncated ${value.length - max} chars]`;
}
