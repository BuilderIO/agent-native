import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { once } from "node:events";

import {
  createToolSearchEntry,
  TOOL_SEARCH_ACTION_NAME,
} from "../agent/tool-search.js";
import {
  buildMergedConfig,
  McpClientManager,
  mcpToolsToActionEntries,
} from "../mcp-client/index.js";
import { runWithRequestContext } from "../server/request-context.js";
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
  isReasoningEffort,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";
import {
  appendCodeAgentTranscriptEvent,
  dequeueCodeAgentFollowUp,
  getCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
  updateCodeAgentRunRecord,
  type CodeAgentPermissionMode,
  type CodeAgentRunRecord,
} from "./code-agent-runs.js";

export interface ExecuteCodeAgentRunOptions {
  runId: string;
  prompt?: string;
  appendUserEvent?: boolean;
  engine?: AgentEngine;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  stdout?: NodeJS.WritableStream;
  signal?: AbortSignal;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface PendingCodeAgentApproval {
  id: string;
  tool: "run_command";
  command: string;
  reason: string;
  requestedAt: string;
  permissionMode: CodeAgentPermissionMode;
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
      message: "No prompt was found for this Agent-Native Code run.",
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
    message: "Agent-Native Code run started.",
    metadata: { status: "running", phase: "executing" },
  });

  const requestedEngine = metadataString(existing, "engine");
  const engine =
    options.engine ?? (await resolveExecutorEngine(requestedEngine));
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
      needsApproval: false,
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
    metadataString(existing, "model") ??
    process.env.AGENT_MODEL ??
    (await getStoredModelForEngine(engine).catch(() => undefined)) ??
    engine.defaultModel;
  const reasoningEffort =
    options.reasoningEffort ?? metadataReasoningEffort(existing);
  const cwd = existing.cwd || process.cwd();
  const permissionMode = existing.permissionMode ?? "full-auto";
  const actions = createLocalCodeAgentActions(cwd, permissionMode, existing.id);
  const mcpManager = await startCodeAgentMcpManager(existing.id);
  if (mcpManager) {
    Object.assign(actions, mcpToolsToActionEntries(mcpManager));
  }
  actions[TOOL_SEARCH_ACTION_NAME] = createToolSearchEntry(() => actions);
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
    await runWithOptionalCodeAgentRequestContext(existing, () =>
      runAgentLoop({
        engine,
        model,
        systemPrompt: codeAgentSystemPrompt(cwd, permissionMode),
        tools,
        actions,
        messages,
        send,
        signal: controller.signal,
        maxIterations: 12,
        reasoningEffort,
      }),
    );
    if (assistantText.trim()) {
      options.stdout?.write("\n");
      appendCodeAgentTranscriptEvent({
        runId: existing.id,
        kind: "system",
        message: assistantText.trim(),
        metadata: {
          role: "assistant",
          model,
          engine: engine.name,
          reasoningEffort,
        },
      });
    }
    const approvalPending = getPendingApproval(existing.id);
    if (approvalPending) {
      const message = `Agent-Native Code run paused for approval: ${approvalPending.reason}`;
      options.stdout?.write(`\n${message}\n`);
      appendCodeAgentTranscriptEvent({
        runId: existing.id,
        kind: "status",
        message,
        metadata: {
          status: "needs-approval",
          phase: "approval-required",
          pendingApprovalId: approvalPending.id,
        },
      });
      return updateCodeAgentRunRecord(existing.id, {
        status: "needs-approval",
        phase: "approval-required",
        needsApproval: true,
        progress: {
          label: "Approval required",
          completed: 0,
          total: 1,
          percent: 50,
        },
      });
    }

    const pendingFollowUp = dequeueCodeAgentFollowUp(existing.id);
    if (pendingFollowUp) {
      const message =
        pendingFollowUp.mode === "queued"
          ? "Agent-Native Code run completed; running queued follow-up."
          : "Agent-Native Code run completed; applying steering follow-up.";
      appendCodeAgentTranscriptEvent({
        runId: existing.id,
        kind: "status",
        message,
        metadata: {
          status: "running",
          phase: "follow-up",
          followUpId: pendingFollowUp.id,
          followUpMode: pendingFollowUp.mode,
        },
      });
      if (pendingFollowUp.permissionMode) {
        updateCodeAgentRunRecord(existing.id, {
          permissionMode: pendingFollowUp.permissionMode,
        });
      }
      return executeCodeAgentRun({
        ...options,
        runId: existing.id,
        prompt: pendingFollowUp.prompt,
        appendUserEvent: false,
      });
    }

    appendCodeAgentTranscriptEvent({
      runId: existing.id,
      kind: "status",
      message: "Agent-Native Code run completed.",
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
        reasoningEffort,
        permissionMode,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    options.stdout?.write(`\nAgent-Native Code run failed: ${message}\n`);
    appendCodeAgentTranscriptEvent({
      runId: existing.id,
      kind: "status",
      message: `Agent-Native Code run failed: ${message}`,
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
    await mcpManager?.stop().catch(() => undefined);
    void running;
  }
}

export async function executeExistingCodeAgentRun(
  runId: string,
  options: Omit<ExecuteCodeAgentRunOptions, "runId"> = {},
): Promise<CodeAgentRunRecord | null> {
  return executeCodeAgentRun({ ...options, runId, appendUserEvent: false });
}

export async function executePendingCodeAgentApproval(
  runId: string,
  options: { stdout?: NodeJS.WritableStream } = {},
): Promise<CodeAgentRunRecord | null> {
  const record = getCodeAgentRunRecord(runId);
  if (!record) return null;
  const approval = getPendingApproval(runId);
  if (!approval) {
    options.stdout?.write("No pending approval was found for this run.\n");
    return record;
  }

  const permission = classifyCodeAgentCommandPermission(approval.command);
  if (permission.kind === "forbidden") {
    const message = `Approval cannot run forbidden command: ${permission.reason}`;
    options.stdout?.write(`${message}\n`);
    appendCodeAgentTranscriptEvent({
      runId,
      kind: "status",
      message,
      metadata: {
        status: "needs-approval",
        phase: "approval-forbidden",
        approvalId: approval.id,
      },
    });
    return updateCodeAgentRunRecord(runId, {
      status: "needs-approval",
      phase: "approval-forbidden",
      needsApproval: true,
    });
  }

  appendCodeAgentTranscriptEvent({
    runId,
    kind: "status",
    message: `Approved command ${approval.id}; running now.`,
    metadata: {
      status: "running",
      phase: "approval-running",
      approvalId: approval.id,
      command: approval.command,
    },
  });
  const result = await runCommand(
    approval.command,
    record.cwd || process.cwd(),
    DEFAULT_COMMAND_TIMEOUT_MS,
  );
  const summary = truncate(
    [
      `Approved command finished with exit code ${result.code}.`,
      result.timedOut ? "Timed out: true" : "",
      result.stdout ? `stdout:\n${result.stdout}` : "",
      result.stderr ? `stderr:\n${result.stderr}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    MAX_TOOL_OUTPUT_CHARS,
  );
  options.stdout?.write(`${summary}\n`);
  appendCodeAgentTranscriptEvent({
    runId,
    kind: "status",
    message: summary,
    metadata: {
      status: result.code === 0 ? "paused" : "errored",
      phase: "approval-complete",
      approvalId: approval.id,
      exitCode: result.code,
      timedOut: result.timedOut,
    },
  });
  return updateCodeAgentRunRecord(runId, {
    status: result.code === 0 ? "paused" : "errored",
    phase: result.code === 0 ? "approval-complete" : "approval-command-error",
    needsApproval: false,
    progress: {
      label: result.code === 0 ? "Approval complete" : "Approval failed",
      completed: result.code === 0 ? 1 : 0,
      total: 1,
      failed: result.code === 0 ? 0 : 1,
      percent: result.code === 0 ? 100 : 0,
    },
    metadata: {
      pendingApproval: undefined,
      lastApproval: {
        ...approval,
        completedAt: new Date().toISOString(),
        exitCode: result.code,
      },
    },
  });
}

function latestUserPrompt(runId: string): string {
  const events = listCodeAgentTranscriptEvents(runId);
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind === "user" && event.message.trim()) return event.message;
  }
  return "";
}

function metadataString(
  run: CodeAgentRunRecord,
  key: string,
): string | undefined {
  const value = run.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function startCodeAgentMcpManager(
  runId: string,
): Promise<McpClientManager | null> {
  const config = await buildMergedConfig().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    appendCodeAgentTranscriptEvent({
      runId,
      kind: "status",
      message: `MCP tools unavailable: ${message}`,
      metadata: { type: "mcp-config-error" },
    });
    return null;
  });
  if (!config || Object.keys(config.servers ?? {}).length === 0) return null;

  const manager = new McpClientManager(config);
  await manager.start().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    appendCodeAgentTranscriptEvent({
      runId,
      kind: "status",
      message: `MCP tools failed to start: ${message}`,
      metadata: { type: "mcp-start-error" },
    });
  });
  const status = manager.getStatus();
  if (status.totalTools === 0) {
    await manager.stop().catch(() => undefined);
    return null;
  }
  appendCodeAgentTranscriptEvent({
    runId,
    kind: "status",
    message: `Connected ${status.totalTools} MCP tool${status.totalTools === 1 ? "" : "s"} for this run.`,
    metadata: {
      type: "mcp-tools-connected",
      servers: status.connectedServers,
      toolCount: status.totalTools,
    },
  });
  return manager;
}

function runWithOptionalCodeAgentRequestContext<T>(
  run: CodeAgentRunRecord,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const userEmail =
    metadataString(run, "ownerEmail") ??
    metadataString(run, "userEmail") ??
    process.env.AGENT_USER_EMAIL;
  const orgId = metadataString(run, "orgId") ?? process.env.AGENT_ORG_ID;
  if (!userEmail && !orgId) return fn();
  return runWithRequestContext({ userEmail, orgId }, fn);
}

function metadataReasoningEffort(
  run: CodeAgentRunRecord,
): ReasoningEffort | undefined {
  const value = run.metadata?.reasoningEffort ?? run.metadata?.effort;
  return isReasoningEffort(value) && value !== "auto" ? value : undefined;
}

async function resolveExecutorEngine(
  requestedEngine?: string,
): Promise<AgentEngine | null> {
  const fakeText = process.env.AGENT_NATIVE_CODE_AGENT_FAKE_RESPONSE;
  if (fakeText !== undefined) {
    return createFakeCodeAgentEngine(fakeText || "Done.");
  }
  registerBuiltinEngines();
  if (!hasAnyProviderCredential()) return null;
  return resolveEngine({
    engineOption: requestedEngine ?? process.env.AGENT_ENGINE,
  });
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
    label: "Fake Agent-Native Code",
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

function codeAgentSystemPrompt(
  cwd: string,
  permissionMode: CodeAgentPermissionMode,
): string {
  return `You are Agent-Native Code, a local coding agent running in ${cwd}.

Work like a careful senior engineer:
- Read relevant files before editing.
- Prefer small, focused changes.
- Current run mode: ${permissionMode === "read-only" ? "Plan mode" : "Auto mode"} (${permissionMode}).
- In Plan mode, inspect and explain only.
- In Auto mode, edit files and run ordinary project commands without pausing. Pause only for genuinely destructive operations such as recursive deletes, package publishing, privileged commands, destructive database operations, or forbidden git branch/reset/stash/rebase operations.
- Do not create, switch, delete, reset, rebase, or stash git branches.
- Do not run destructive git commands.
- Use apply_patch or write_file for edits, then run focused verification.
- Use tool-search when you need a capability that may come from MCP, including browser automation or computer control.
- Prefer Playwright MCP for deterministic browser testing; prefer Chrome DevTools MCP when the user needs their live logged-in Chrome session.
- Only use computer-control MCP tools when they are explicitly available and the user request warrants controlling the local computer.
- Keep the final answer concise and include files changed plus tests run.
- Respect any AGENTS.md instructions in the repository.`;
}

function createLocalCodeAgentActions(
  cwd: string,
  permissionMode: CodeAgentPermissionMode,
  runId: string,
): Record<string, ActionEntry> {
  const actions: Record<string, ActionEntry> = {
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
        const permissionError = permissionErrorForWrite(
          permissionMode,
          "write_file",
        );
        if (permissionError) return permissionError;
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
        const permissionError = permissionErrorForWrite(
          permissionMode,
          "apply_patch",
        );
        if (permissionError) return permissionError;
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
        const permission = classifyCodeAgentCommandPermission(command);
        if (permission.kind === "forbidden") {
          return `Error: command is blocked by Agent-Native Code policy: ${permission.reason}`;
        }
        if (permission.kind === "approval-required") {
          const approval = requestCodeAgentApproval(runId, {
            tool: "run_command",
            command,
            reason: permission.reason,
            permissionMode,
          });
          return [
            `Approval required before running this command: ${permission.reason}.`,
            `Approval id: ${approval.id}`,
            `Command: ${command}`,
            "The run is paused; approve from the Agent-Native Code UI/CLI if this command is intentional.",
          ].join("\n");
        }
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
  if (permissionMode === "read-only") {
    return Object.fromEntries(
      Object.entries(actions).filter(([, action]) => action.readOnly),
    );
  }
  return actions;
}

export type CodeAgentCommandPermission =
  | { kind: "read" }
  | { kind: "write" }
  | { kind: "approval-required"; reason: string }
  | { kind: "forbidden"; reason: string };

export function classifyCodeAgentCommandPermission(
  command: string,
): CodeAgentCommandPermission {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return { kind: "read" };

  const blockedPatterns: Array<[RegExp, string]> = [
    [
      /\bgit\s+(checkout|switch|reset|rebase|stash|clean|worktree)\b/,
      "forbidden git branch/reset/stash/rebase operation",
    ],
    [
      /\bgit\s+branch\b(?!\s+--show-current\b)/,
      "forbidden git branch operation",
    ],
    [/\bdrizzle-kit\s+push\b/, "drizzle-kit push is not allowed"],
  ];
  for (const [pattern, reason] of blockedPatterns) {
    if (pattern.test(normalized)) return { kind: "forbidden", reason };
  }

  const approvalPatterns: Array<[RegExp, string]> = [
    [/\brm\s+-rf\b/, "destructive recursive delete"],
    [/\bsudo\b/, "privileged command"],
    [/\bkill\s+-9\b/, "force-kill command"],
    [/\bcurl\b.*\|\s*(sh|bash|zsh)\b/, "remote script execution"],
    [/\b(wget|fetch)\b.*\|\s*(sh|bash|zsh)\b/, "remote script execution"],
    [/\bnpm\s+publish\b/, "package publish"],
    [/\bpnpm\s+publish\b/, "package publish"],
    [/\btruncate\b/, "destructive data command"],
    [/\bdrop\s+(table|column|database)\b/, "destructive database command"],
    [/\bdelete\s+from\b(?![\s\S]*\bwhere\b)/, "unscoped delete command"],
  ];
  for (const [pattern, reason] of approvalPatterns) {
    if (pattern.test(normalized)) {
      return { kind: "approval-required", reason };
    }
  }

  const readPatterns = [
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
    /^pnpm\b.*\b(test|typecheck|lint|check)\b/,
    /^npm\b.*\b(test|run\s+(test|typecheck|lint|check))\b/,
  ];
  if (readPatterns.some((pattern) => pattern.test(normalized))) {
    return { kind: "read" };
  }

  const writePatterns = [
    /(^|[^>])>(?!>)/,
    />>/,
    /\btee\b/,
    /\bapply_patch\b/,
    /\b(write|touch|mkdir|cp|mv|rm|chmod|chown)\b/,
    /\bpnpm\s+(add|install|remove|dlx)\b/,
    /\bnpm\s+(install|i|add|remove|uninstall)\b/,
  ];
  if (writePatterns.some((pattern) => pattern.test(normalized))) {
    return { kind: "write" };
  }

  return { kind: "write" };
}

function permissionErrorForWrite(
  permissionMode: CodeAgentPermissionMode,
  toolName: string,
): string | null {
  if (
    permissionMode === "ask-before-edit" ||
    permissionMode === "auto-edit" ||
    permissionMode === "full-auto"
  ) {
    return null;
  }
  if (permissionMode === "read-only") {
    return `Error: ${toolName} is unavailable in read-only mode.`;
  }
  return `Error: ${toolName} is blocked by the current run mode.`;
}

function requestCodeAgentApproval(
  runId: string,
  input: Omit<PendingCodeAgentApproval, "id" | "requestedAt">,
): PendingCodeAgentApproval {
  const requestedAt = new Date().toISOString();
  const approval: PendingCodeAgentApproval = {
    id: `approval-${requestedAt.replace(/\D/g, "").slice(0, 14)}`,
    requestedAt,
    ...input,
  };
  appendCodeAgentTranscriptEvent({
    runId,
    kind: "status",
    message: `Approval required: ${approval.reason}`,
    metadata: {
      status: "needs-approval",
      phase: "approval-required",
      pendingApproval: approval,
    },
  });
  updateCodeAgentRunRecord(runId, {
    status: "needs-approval",
    phase: "approval-required",
    needsApproval: true,
    progress: {
      label: "Approval required",
      completed: 0,
      total: 1,
      percent: 50,
    },
    metadata: {
      pendingApproval: approval,
    },
  });
  return approval;
}

function getPendingApproval(runId: string): PendingCodeAgentApproval | null {
  const record = getCodeAgentRunRecord(runId);
  const approval = record?.metadata?.pendingApproval;
  if (!approval || typeof approval !== "object") return null;
  const candidate = approval as Record<string, unknown>;
  if (
    candidate.tool !== "run_command" ||
    typeof candidate.command !== "string" ||
    typeof candidate.reason !== "string" ||
    typeof candidate.id !== "string" ||
    typeof candidate.requestedAt !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    tool: "run_command",
    command: candidate.command,
    reason: candidate.reason,
    requestedAt: candidate.requestedAt,
    permissionMode:
      candidate.permissionMode === "read-only" ||
      candidate.permissionMode === "ask-before-edit" ||
      candidate.permissionMode === "auto-edit" ||
      candidate.permissionMode === "full-auto"
        ? candidate.permissionMode
        : "full-auto",
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
