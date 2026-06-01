import {
  createToolSearchEntry,
  TOOL_SEARCH_ACTION_NAME,
} from "../agent/tool-search.js";
import {
  createCodingToolRegistry,
  isReadOnlyShellCommand,
  runCodingCommand,
  truncateCodingOutput,
} from "../coding-tools/index.js";
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
  formatPromptWithAttachments,
  type AgentPromptAttachment,
} from "../code-agents/prompt-attachments.js";
import {
  appendCodeAgentTranscriptEvent,
  dequeueCodeAgentFollowUp,
  getCodeAgentRunRecord,
  listCodeAgentTranscriptEvents,
  updateCodeAgentRunRecord,
  type CodeAgentPermissionMode,
  type CodeAgentRunRecord,
} from "./code-agent-runs.js";
import { createCodeAgentOutputSmoother } from "./code-agent-output-smoother.js";

export interface ExecuteCodeAgentRunOptions {
  runId: string;
  prompt?: string;
  appendUserEvent?: boolean;
  engine?: AgentEngine;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  attachments?: AgentPromptAttachment[];
  stdout?: NodeJS.WritableStream;
  signal?: AbortSignal;
}

interface PendingCodeAgentApproval {
  id: string;
  tool: "bash" | "run_command";
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
  const executionPrompt = formatPromptWithAttachments(
    prompt,
    options.attachments ?? latestUserPromptAttachments(existing.id, prompt),
  );
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
  const messages = buildCodeAgentMessages(existing, executionPrompt);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else
      options.signal.addEventListener("abort", abortFromParent, { once: true });
  }

  let assistantText = "";
  const outputSmoother = createCodeAgentOutputSmoother(options.stdout);
  const send = (event: AgentChatEvent) => {
    if (event.type === "text") {
      assistantText += event.text;
      outputSmoother.write(event.text);
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
          result: truncateCodingOutput(event.result, 4000),
          ...(event.mcpApp ? { mcpApp: event.mcpApp } : {}),
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
    await outputSmoother.flush();
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
        attachments:
          pendingFollowUp.attachments ??
          userPromptAttachmentsForEvent(existing.id, pendingFollowUp.eventId),
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
    await outputSmoother.flush().catch(() => undefined);
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
    outputSmoother.cancel();
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
  const result = await runCodingCommand(
    approval.command,
    record.cwd || process.cwd(),
    DEFAULT_COMMAND_TIMEOUT_MS,
  );
  const summary = truncateCodingOutput(
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

function latestUserPromptAttachments(
  runId: string,
  prompt: string,
): AgentPromptAttachment[] {
  const events = listCodeAgentTranscriptEvents(runId);
  const normalizedPrompt = prompt.trim();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.kind !== "user" || !event.message.trim()) continue;
    if (
      !normalizedPrompt ||
      event.message.trim() === normalizedPrompt ||
      i === events.length - 1
    ) {
      return promptAttachmentsFromMetadata(event.metadata?.attachments);
    }
  }
  return [];
}

function userPromptAttachmentsForEvent(
  runId: string,
  eventId: string | undefined,
): AgentPromptAttachment[] {
  if (!eventId) return [];
  const event = listCodeAgentTranscriptEvents(runId).find(
    (item) => item.id === eventId && item.kind === "user",
  );
  return promptAttachmentsFromMetadata(event?.metadata?.attachments);
}

function promptAttachmentsFromMetadata(
  value: unknown,
): AgentPromptAttachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item)),
    )
    .map((item) => ({
      name: typeof item.name === "string" && item.name ? item.name : "file",
      ...(typeof item.type === "string" ? { type: item.type } : {}),
      ...(typeof item.size === "number" ? { size: item.size } : {}),
      ...(typeof item.text === "string" ? { text: item.text } : {}),
      ...(typeof item.dataUrl === "string" ? { dataUrl: item.dataUrl } : {}),
    }));
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
  const mode = permissionMode === "read-only" ? "Plan" : "Auto";
  return `You are Agent-Native Code, a coding agent running in ${cwd}. You and the user share one workspace, and your job is to collaborate with them until their goal is genuinely handled.

# General

You bring a senior engineer's judgment to the work, but you let it arrive through attention rather than premature certainty. Read the codebase first, resist easy assumptions, and let the shape of the existing system teach you how to move.

- When you search for text or files, reach first for \`rg\` or \`rg --files\`; they are much faster than \`grep\` or \`find\`. If \`rg\` is unavailable, use the next best tool without fuss.
- Parallelize independent read-only work (file reads, searches) so you gather context quickly. Keep mutating steps ordered.
- Read relevant files before editing them. Do not edit a file you have not actually read.

# Engineering judgment

When the user leaves implementation details open, choose conservatively and in sympathy with the codebase already in front of you:

- Prefer the repo's existing patterns, frameworks, and local helper APIs over inventing a new abstraction.
- For structured data, use structured APIs or parsers instead of ad hoc string manipulation when the toolchain gives you a reasonable option.
- Keep edits closely scoped to what the request and surrounding code imply. Leave unrelated refactors and metadata churn alone unless they are truly needed to finish safely.
- Add an abstraction only when it removes real complexity, reduces meaningful duplication, or clearly matches an established local pattern.
- Let test coverage scale with risk and blast radius: focused for narrow changes, broader when you touch shared behavior or cross-module contracts.

# Run mode

Current run mode: ${mode} mode (${permissionMode}).
- In Plan mode, inspect and explain only — do not edit files or run mutating commands.
- In Auto mode, edit files and run ordinary project commands without pausing. Pause only for genuinely destructive operations: recursive deletes, package publishing, privileged commands, destructive database operations, or forbidden git branch/reset/stash/rebase operations.

# Editing constraints

- Use the shared coding tools: \`bash\` for search/list/test/build/git-status commands, \`read\` for file reads, \`edit\` for exact-match replacements, and \`write\` only for new files or an intentional full rewrite. Prefer \`edit\` over \`write\` for existing files.
- Default to ASCII when editing or creating files; introduce non-ASCII only when the file already uses it or there is a clear reason.
- Add succinct comments only where the code is not self-explanatory. Avoid empty narration like "assign the value"; a short orienting comment before a complex block is fine, used sparingly.
- You may be in a dirty git worktree. NEVER revert or overwrite changes you did not make — assume they came from the user or another concurrent agent. If unrelated changes exist, ignore them; if they touch your task, work *with* them rather than undoing them. Only stop and ask if they make the task impossible.
- If you notice unexpected changes appearing mid-task that you did not make, STOP and ask the user how to proceed rather than guessing.
- Do not create, switch, delete, reset, rebase, or stash git branches. Never run destructive git commands (\`git reset --hard\`, \`git checkout --\`, \`git clean\`) unless the user explicitly asked for that exact operation.

# Autonomy and verification

- Stay with the work until the task is handled end to end within this turn whenever feasible. Don't stop at analysis or a proposal — implement the fix, and work through blockers yourself before handing them back. The exception is Plan mode, where you propose only.
- Done means verified, not generated. After code changes (not docs-only), run the repo's checks before reporting success: \`pnpm run prep\` (format + typecheck + test + guards), or a focused subset like \`pnpm typecheck\` or a single package's tests for a small change. Fix all errors before you call it done.
- Do not claim a change works, tests pass, or a build succeeds unless you actually ran it and saw the result. If you could not verify something, say exactly what is unverified and why.

# Tools beyond the basics

- Use \`tool-search\` when you need a capability that may come from MCP, including browser automation or computer control.
- Prefer Playwright MCP for deterministic browser testing; prefer Chrome DevTools MCP when the user needs their live logged-in Chrome session.
- Only use computer-control MCP tools when they are explicitly available and the request warrants controlling the local computer.

# Final answer

- Keep it concise and high-signal — plain, idiomatic engineering prose, not a mechanical report. Lead with the outcome. For a small change, one or two short paragraphs plus a verification line is usually right; reserve bullet lists for genuinely multi-part results.
- Reference files as clickable paths (e.g. \`packages/core/src/foo.ts\`), with a line number when it helps. Do not paste large file contents back — the user shares this machine and can open them.
- State what you changed, and show evidence you verified it: name the check you ran (e.g. \`pnpm typecheck\`) and its key result, not just a claim that it passed. If you could not run something, say so plainly.
- No emojis or em dashes unless the user used them first.
- Respect any AGENTS.md instructions in the repository; they override these defaults on conflict.`;
}

function createLocalCodeAgentActions(
  cwd: string,
  permissionMode: CodeAgentPermissionMode,
  runId: string,
): Record<string, ActionEntry> {
  const actions = createCodingToolRegistry({
    cwd,
    restrictToCwd: true,
    commandTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    maxOutputChars: MAX_TOOL_OUTPUT_CHARS,
    maxFileReadChars: MAX_FILE_READ_CHARS,
    canWrite: (toolName) => permissionErrorForWrite(permissionMode, toolName),
    beforeBash: ({ command }) => {
      const permission = classifyCodeAgentCommandPermission(command);
      if (permission.kind === "forbidden") {
        return `Error: command is blocked by Agent-Native Code policy: ${permission.reason}`;
      }
      if (permission.kind !== "read") {
        const permissionError = permissionErrorForWrite(permissionMode, "bash");
        if (permissionError) return permissionError;
      }
      if (permission.kind === "approval-required") {
        const approval = requestCodeAgentApproval(runId, {
          tool: "bash",
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
      return null;
    },
  });
  if (permissionMode === "read-only") {
    return {
      bash: actions.bash,
      read: actions.read,
    };
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

  if (isReadOnlyShellCommand(command)) {
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
  const tool =
    candidate.tool === "bash" || candidate.tool === "run_command"
      ? candidate.tool
      : null;
  if (
    !tool ||
    typeof candidate.command !== "string" ||
    typeof candidate.reason !== "string" ||
    typeof candidate.id !== "string" ||
    typeof candidate.requestedAt !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    tool,
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
