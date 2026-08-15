import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveEngine,
  getStoredModelForEngine,
  normalizeModelForEngine,
  registerBuiltinEngines,
} from "../agent/engine/index.js";
import { PROVIDER_ENV_VARS } from "../agent/engine/provider-env-vars.js";
import type {
  AgentEngine,
  EngineEvent,
  EngineMessage,
  EngineStreamOptions,
} from "../agent/engine/types.js";
import { DEFAULT_AGENT_MAX_ITERATIONS } from "../agent/loop-settings.js";
import {
  actionsToEngineTools,
  runAgentLoop,
  type ActionEntry,
  type AgentLoopUsage,
} from "../agent/production-agent.js";
import {
  createToolSearchEntry,
  TOOL_SEARCH_ACTION_NAME,
} from "../agent/tool-search.js";
import type { AgentChatEvent } from "../agent/types.js";
import {
  formatPromptWithAttachments,
  type AgentPromptAttachment,
} from "../code-agents/prompt-attachments.js";
import {
  createCodingToolRegistry,
  isReadOnlyShellCommand,
  runCodingCommand,
  truncateBashOutput,
  truncateCodingOutput,
  type StructuredToolMetadata,
} from "../coding-tools/index.js";
import {
  buildMergedConfig,
  McpClientManager,
  mcpToolsToActionEntries,
  type McpToolInvocationPolicy,
} from "../mcp-client/index.js";
import {
  readAgentsBundleFromFs,
  generateDevelopmentSkillsPromptBlock,
} from "../server/agents-bundle.js";
import {
  getAmbientOrgId,
  getAmbientUserEmail,
  runWithRequestContext,
} from "../server/request-context.js";
import {
  isReasoningEffort,
  type ReasoningEffort,
} from "../shared/reasoning-effort.js";
import {
  createAgentNativeConfigContext,
  loadResolvedAgentNativeConfig,
} from "../vite/agent-native-config-loader.js";
import {
  runClaudeCodeParticipant,
  type ClaudeCodeParticipantEvent,
} from "./claude-code-participant.js";
import {
  codexMcpConfigArgs,
  mergeCodeAgentMcpConfig,
  restrictCodeAgentMcpConfig,
} from "./code-agent-mcp-config.js";
import { createCodeAgentOutputSmoother } from "./code-agent-output-smoother.js";
import {
  addCodeAgentCommandToAllowlist,
  appendCodeAgentTranscriptEvent,
  dequeueCodeAgentFollowUp,
  getCodeAgentRunRecord,
  isCodeAgentCommandAllowed,
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
  attachments?: AgentPromptAttachment[];
  stdout?: NodeJS.WritableStream;
  /** Keep tool output in transcript events when the caller has a structured UI. */
  streamToolOutputToStdout?: boolean;
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

interface CodeAgentApprovalExecutionOptions {
  stdout?: NodeJS.WritableStream;
  streamToolOutputToStdout?: boolean;
  signal?: AbortSignal;
}

interface CodexCliProcessResult {
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const MAX_TOOL_OUTPUT_CHARS = 50_000;
const MAX_FILE_READ_CHARS = 120_000;
const CODEX_CLI_ENGINE_NAME = "codex-cli";
const CLAUDE_CLI_ENGINE_NAME = "claude-cli";
const PI_CLI_ENGINE_NAME = "pi-cli";
const OPENCODE_CLI_ENGINE_NAME = "opencode-cli";
const CLAUDE_CLI_DEFAULT_MODEL = "claude-sonnet-5";
const RECAP_SOURCE_TOOL_PROFILE = "recap-source";
const RECAP_SOURCE_OUTPUT_FILE = "recap-source.json";

type CodeAgentToolProfile = typeof RECAP_SOURCE_TOOL_PROFILE;

/**
 * Number of most-recent transcript events reconstructed as native
 * EngineMessage objects (with proper tool-call / tool-result pairing).
 * Events older than this cap are summarised into a single compact text
 * preamble so the model retains broad context without token waste.
 */
const STRUCTURED_HISTORY_RECENT_EVENTS = 40;

/**
 * Per-tool-result text cap when reconstructing history.  Matches the overall
 * tool-output cap so old results don't balloon the context.
 */
const STRUCTURED_HISTORY_RESULT_CAP = MAX_TOOL_OUTPUT_CHARS;

export async function executeCodeAgentRun(
  options: ExecuteCodeAgentRunOptions,
): Promise<CodeAgentRunRecord | null> {
  const existing = getCodeAgentRunRecord(options.runId);
  if (!existing) return null;
  const streamToolOutputToStdout =
    options.streamToolOutputToStdout ??
    process.env.AGENT_NATIVE_CODE_AGENT_STRUCTURED_STDOUT !== "1";

  const prompt = options.prompt ?? latestUserPrompt(existing.id);
  const rawAttachments =
    options.attachments ?? latestUserPromptAttachments(existing.id, prompt);

  // Split attachments: images (dataUrl) go as engine image parts; text/file
  // attachments are still inlined into the prompt text. This prevents 2 MB
  // images from consuming ~700 K tokens of garbage when treated as plain text.
  const imageAttachments = rawAttachments.filter((a) => a.dataUrl);
  const textOnlyAttachments = rawAttachments.filter((a) => !a.dataUrl);
  const executionPrompt = formatPromptWithAttachments(
    prompt,
    textOnlyAttachments,
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

  // Fall back to AGENT_ENGINE here too, mirroring resolveExecutorEngine below.
  // Without it, `AGENT_ENGINE=codex-cli` skips this Codex branch and is handed
  // to resolveEngine (LLM providers only), which throws `Unknown engine`.
  const requestedEngine = normalizeRequestedEngine(
    metadataString(existing, "engine") ?? process.env.AGENT_ENGINE,
  );
  if (requestedEngine === CODEX_CLI_ENGINE_NAME) {
    return executeCodexCliRun({
      run: existing,
      prompt: executionPrompt,
      model: options.model ?? metadataString(existing, "model"),
      permissionMode: existing.permissionMode ?? "full-auto",
      stdout: options.stdout,
      streamToolOutputToStdout,
      signal: options.signal,
    });
  }
  if (requestedEngine === CLAUDE_CLI_ENGINE_NAME) {
    return executeClaudeCliRun({
      run: existing,
      prompt: executionPrompt,
      model: options.model ?? metadataString(existing, "model"),
      reasoningEffort:
        options.reasoningEffort ?? metadataReasoningEffort(existing),
      permissionMode: existing.permissionMode ?? "full-auto",
      stdout: options.stdout,
      streamToolOutputToStdout,
      signal: options.signal,
    });
  }
  if (requestedEngine === PI_CLI_ENGINE_NAME) {
    return executePiCliRun({
      run: existing,
      prompt: executionPrompt,
      model: options.model ?? metadataString(existing, "model"),
      reasoningEffort:
        options.reasoningEffort ?? metadataReasoningEffort(existing),
      permissionMode: existing.permissionMode ?? "full-auto",
      stdout: options.stdout,
      streamToolOutputToStdout,
      signal: options.signal,
    });
  }
  if (requestedEngine === OPENCODE_CLI_ENGINE_NAME) {
    return executeOpenCodeCliRun({
      run: existing,
      prompt: executionPrompt,
      model: options.model ?? metadataString(existing, "model"),
      reasoningEffort:
        options.reasoningEffort ?? metadataReasoningEffort(existing),
      permissionMode: existing.permissionMode ?? "full-auto",
      stdout: options.stdout,
      streamToolOutputToStdout,
      signal: options.signal,
    });
  }

  const engine =
    options.engine ?? (await resolveExecutorEngine(requestedEngine));
  if (!engine) {
    const message =
      "No LLM provider key was found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, another supported provider key, or run `codex login` to use Codex CLI.";
    if (streamToolOutputToStdout) {
      options.stdout?.write(`${message}\n`);
    }
    appendCodeAgentTranscriptEvent({
      runId: existing.id,
      kind: "status",
      message,
      signal: "credential-gap",
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

  const modelCandidate =
    options.model ??
    metadataString(existing, "model") ??
    process.env.AGENT_MODEL ??
    (await getStoredModelForEngine(engine).catch(() => undefined)) ??
    engine.defaultModel;
  const model = normalizeModelForEngine(engine, modelCandidate);
  const reasoningEffort =
    options.reasoningEffort ?? metadataReasoningEffort(existing);
  const cwd = existing.cwd || process.cwd();
  const permissionMode = existing.permissionMode ?? "full-auto";
  const toolProfile = resolveCodeAgentToolProfile(
    process.env.AGENT_NATIVE_CODE_TOOL_PROFILE,
  );

  // Holds structured metadata emitted by the coding tools side-channel.
  // Keyed by tool name; consumed when the matching tool_start / tool_done fires.
  const pendingToolMeta = new Map<string, StructuredToolMetadata>();

  const actions = createLocalCodeAgentActions(
    cwd,
    permissionMode,
    existing.id,
    (toolName, _phase, meta) => {
      // Both "start" and "done" phases update the map; done has richer data.
      pendingToolMeta.set(toolName, meta);
    },
    (chunk) => {
      // Structured desktop transcripts render tool output separately from
      // assistant text. Keep the legacy terminal stream opt-in for them.
      if (streamToolOutputToStdout) {
        options.stdout?.write(chunk);
      }
    },
    toolProfile,
  );
  const mcpManager = toolProfile
    ? null
    : await startCodeAgentMcpManager(existing.id);
  if (mcpManager) {
    Object.assign(
      actions,
      mcpToolsToActionEntries(mcpManager, {
        invocationPolicy: codeAgentMcpInvocationPolicy(permissionMode),
      }),
    );
  }
  actions[TOOL_SEARCH_ACTION_NAME] = createToolSearchEntry(() => actions);
  const tools = actionsToEngineTools(actions);
  const messages = buildCodeAgentMessages(
    existing,
    executionPrompt,
    imageAttachments,
  );
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else
      options.signal.addEventListener("abort", abortFromParent, { once: true });
  }

  let assistantText = "";
  const outputSmoother = createCodeAgentOutputSmoother(options.stdout);

  // Accumulate thinking text across deltas so we can persist a single event
  // per reasoning block rather than one event per delta chunk.
  let pendingThinkingText = "";
  let thinkingFlushTimer: ReturnType<typeof setTimeout> | undefined;

  const runId = existing.id;
  function flushThinkingEvent() {
    thinkingFlushTimer = undefined;
    const text = pendingThinkingText.trim();
    pendingThinkingText = "";
    if (!text) return;
    appendCodeAgentTranscriptEvent({
      runId,
      kind: "status",
      message: text,
      metadata: { type: "thinking" },
    });
  }

  const send = (event: AgentChatEvent) => {
    if (event.type === "text") {
      // Flush any buffered thinking when real content arrives.
      if (thinkingFlushTimer !== undefined) {
        clearTimeout(thinkingFlushTimer);
        flushThinkingEvent();
      }
      assistantText += event.text;
      outputSmoother.write(event.text);
      return;
    }
    if (event.type === "thinking") {
      pendingThinkingText += event.text;
      // Debounce: flush 300ms after the last delta so rapid chunks are merged.
      if (thinkingFlushTimer !== undefined) clearTimeout(thinkingFlushTimer);
      thinkingFlushTimer = setTimeout(flushThinkingEvent, 300);
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
      const startMeta = pendingToolMeta.get(event.tool ?? "");
      appendCodeAgentTranscriptEvent({
        runId: existing.id,
        kind: "status",
        message: `Running ${event.tool}.`,
        metadata: {
          type: "tool_start",
          tool: event.tool,
          input: event.input,
          ...(startMeta ? { structuredMeta: startMeta } : {}),
        },
      });
      return;
    }
    if (event.type === "tool_done") {
      const pendingMeta = pendingToolMeta.get(event.tool ?? "");
      if (pendingMeta) pendingToolMeta.delete(event.tool ?? "");
      appendCodeAgentTranscriptEvent({
        runId: existing.id,
        kind: "status",
        message: `Finished ${event.tool}.`,
        metadata: {
          type: "tool_done",
          tool: event.tool,
          result: truncateBashOutput(
            truncateCodingOutput(event.result, MAX_TOOL_OUTPUT_CHARS),
          ),
          ...(event.mcpApp ? { mcpApp: event.mcpApp } : {}),
          ...(pendingMeta ? { structuredMeta: pendingMeta } : {}),
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

  let loopUsage: AgentLoopUsage | null = null;
  try {
    const systemPrompt = await buildCodeAgentSystemPrompt(cwd, permissionMode);
    const usageResult = await runWithOptionalCodeAgentRequestContext(
      existing,
      () =>
        runAgentLoop({
          engine,
          model,
          systemPrompt,
          tools,
          actions,
          messages,
          send,
          signal: controller.signal,
          maxIterations: DEFAULT_AGENT_MAX_ITERATIONS,
          reasoningEffort,
        }),
    );
    loopUsage = usageResult ?? null;
    writeCodeAgentUsageSnapshot(cwd, loopUsage);
    // Persist cumulative token totals from this turn into the run record so
    // the UI can display per-run usage statistics.
    if (loopUsage) {
      updateCodeAgentRunRecord(existing.id, (record) => ({
        metadata: {
          tokenUsage: accumulateTokenUsage(
            record.metadata?.tokenUsage,
            loopUsage!,
          ),
        },
      }));
    }
    await outputSmoother.flush();
    if (assistantText.trim()) {
      if (streamToolOutputToStdout) {
        options.stdout?.write("\n");
      }
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
      if (streamToolOutputToStdout) {
        options.stdout?.write(`\n${message}\n`);
      }
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
    if (streamToolOutputToStdout) {
      options.stdout?.write(`\nAgent-Native Code run failed: ${message}\n`);
    }
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
    if (thinkingFlushTimer !== undefined) {
      clearTimeout(thinkingFlushTimer);
      flushThinkingEvent();
    }
    outputSmoother.cancel();
    options.signal?.removeEventListener("abort", abortFromParent);
    await mcpManager?.stop().catch(() => undefined);
    void running;
  }
}

export function codeAgentMcpInvocationPolicy(
  permissionMode: CodeAgentPermissionMode,
): McpToolInvocationPolicy {
  return {
    mode: permissionMode === "read-only" ? "read-only" : "allow-all",
  };
}

async function executeClaudeCliRun(options: {
  run: CodeAgentRunRecord;
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode: CodeAgentPermissionMode;
  stdout?: NodeJS.WritableStream;
  streamToolOutputToStdout?: boolean;
  signal?: AbortSignal;
}): Promise<CodeAgentRunRecord | null> {
  const cwd = options.run.cwd || process.cwd();
  const model = normalizeClaudeCliModel(options.model);
  const reasoningEffort = normalizeClaudeCliEffort(options.reasoningEffort);
  const streamToolOutputToStdout =
    options.streamToolOutputToStdout ??
    process.env.AGENT_NATIVE_CODE_AGENT_STRUCTURED_STDOUT !== "1";
  const assistantText: string[] = [];
  const claudeToolNames = new Map<string, string>();

  appendCodeAgentTranscriptEvent({
    runId: options.run.id,
    kind: "status",
    message: "Starting Claude Code with local Claude authentication.",
    metadata: {
      status: "running",
      phase: "executing",
      engine: CLAUDE_CLI_ENGINE_NAME,
    },
  });

  try {
    const result = await runClaudeCodeParticipant({
      // Claude's driver uses acceptEdits, which is the closest available
      // mapping for auto-edit and full-auto. Keep ask-before-edit on the
      // read-only watchdog path because this non-interactive runner has no
      // approval channel to honor an edit prompt safely.
      role:
        options.permissionMode === "auto-edit" ||
        options.permissionMode === "full-auto"
          ? "driver"
          : "watchdog",
      prompt: buildClaudeCliPrompt(options.run, options.prompt),
      cwd,
      model,
      effort: reasoningEffort,
      signal: options.signal,
      onEvent: (event) => {
        const text = appendClaudeParticipantTranscriptEvents(
          options.run.id,
          event,
          claudeToolNames,
        );
        if (!text) return;
        assistantText.push(text);
        if (streamToolOutputToStdout) options.stdout?.write(text);
      },
    });
    const finalMessage =
      readClaudeParticipantResultText(result.events) ??
      (assistantText.join("\n\n").trim() || "Claude Code run completed.");
    appendCodeAgentTranscriptEvent({
      runId: options.run.id,
      kind: "system",
      message: finalMessage,
      metadata: {
        role: "assistant",
        engine: CLAUDE_CLI_ENGINE_NAME,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
    });

    const pendingFollowUp = dequeueCodeAgentFollowUp(options.run.id);
    if (pendingFollowUp) {
      const message =
        pendingFollowUp.mode === "queued"
          ? "Claude Code run completed; running queued follow-up."
          : "Claude Code run completed; applying steering follow-up.";
      appendCodeAgentTranscriptEvent({
        runId: options.run.id,
        kind: "status",
        message,
        metadata: {
          status: "running",
          phase: "follow-up",
          followUpId: pendingFollowUp.id,
          followUpMode: pendingFollowUp.mode,
          engine: CLAUDE_CLI_ENGINE_NAME,
        },
      });
      if (pendingFollowUp.permissionMode) {
        updateCodeAgentRunRecord(options.run.id, {
          permissionMode: pendingFollowUp.permissionMode,
        });
      }
      return executeCodeAgentRun({
        runId: options.run.id,
        prompt: pendingFollowUp.prompt,
        attachments:
          pendingFollowUp.attachments ??
          userPromptAttachmentsForEvent(
            options.run.id,
            pendingFollowUp.eventId,
          ),
        appendUserEvent: false,
        stdout: options.stdout,
        streamToolOutputToStdout: options.streamToolOutputToStdout,
        signal: options.signal,
      });
    }

    appendCodeAgentTranscriptEvent({
      runId: options.run.id,
      kind: "status",
      message: "Claude Code run completed.",
      metadata: {
        status: "completed",
        phase: "complete",
        engine: CLAUDE_CLI_ENGINE_NAME,
      },
    });
    return updateCodeAgentRunRecord(options.run.id, {
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
        engine: CLAUDE_CLI_ENGINE_NAME,
        model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
        permissionMode: options.permissionMode,
      },
    });
  } catch (error) {
    const interrupted = options.signal?.aborted === true;
    const message = error instanceof Error ? error.message : String(error);
    const summary = interrupted
      ? "Claude Code run paused."
      : `Claude Code run failed: ${message}`;
    if (streamToolOutputToStdout) options.stdout?.write(`\n${summary}\n`);
    appendCodeAgentTranscriptEvent({
      runId: options.run.id,
      kind: "status",
      message: summary,
      metadata: {
        status: interrupted ? "paused" : "errored",
        phase: interrupted ? "paused" : "error",
        engine: CLAUDE_CLI_ENGINE_NAME,
      },
    });
    return updateCodeAgentRunRecord(options.run.id, {
      status: interrupted ? "paused" : "errored",
      phase: interrupted ? "paused" : "error",
      progress: {
        label: interrupted ? "Paused" : "Error",
        completed: 0,
        total: 1,
        failed: interrupted ? 0 : 1,
        percent: 0,
      },
      metadata: {
        ...(interrupted
          ? { executionPausedAt: new Date().toISOString() }
          : {
              executionError: message,
              executionErroredAt: new Date().toISOString(),
            }),
        engine: CLAUDE_CLI_ENGINE_NAME,
        model,
      },
    });
  }
}

function buildClaudeCliPrompt(run: CodeAgentRunRecord, prompt: string): string {
  const permissionMode = run.permissionMode ?? "full-auto";
  const mode =
    permissionMode === "auto-edit" || permissionMode === "full-auto"
      ? "Auto"
      : "Plan";
  const modeInstruction =
    mode === "Plan"
      ? "Inspect and explain only. Do not edit files or run mutating commands."
      : "Edit and verify as needed. Do not create, switch, reset, rebase, or stash git branches.";
  const additionalSkillsRoot =
    process.env.AGENT_NATIVE_CODE_AGENT_SKILLS_ROOT?.trim();
  return [
    `You are running from Agent-Native Code in ${run.cwd || process.cwd()}.`,
    "Follow the repository AGENTS.md and any relevant skill instructions.",
    ...(additionalSkillsRoot
      ? [
          `Additional installed Agent Plugin skills are available under ${additionalSkillsRoot}. Read any relevant SKILL.md files before acting.`,
        ]
      : []),
    `Run mode: ${mode} (${permissionMode}). ${modeInstruction}`,
    "",
    "# User request",
    prompt,
  ].join("\n");
}

function normalizeClaudeCliModel(model: string | undefined): string {
  const trimmed = model?.trim();
  return !trimmed || trimmed === "auto" || trimmed === CLAUDE_CLI_ENGINE_NAME
    ? CLAUDE_CLI_DEFAULT_MODEL
    : trimmed;
}

function normalizeClaudeCliEffort(
  effort: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  return effort && effort !== "auto" ? effort : undefined;
}

function appendClaudeParticipantTranscriptEvents(
  runId: string,
  event: ClaudeCodeParticipantEvent,
  toolNames: Map<string, string>,
): string | null {
  const eventType = cliStringValue(event.type);
  const message = asRecordValue(event.message);
  const messageContent = Array.isArray(message?.content)
    ? message.content.filter((part): part is Record<string, unknown> =>
        isRecordValue(part),
      )
    : [];
  const content =
    messageContent.length > 0
      ? messageContent
      : eventType === "tool_use" || eventType === "tool_result"
        ? [event]
        : [];
  let assistantText = "";

  for (const part of content) {
    const partType = cliStringValue(part.type);
    if (eventType === "assistant" && partType === "text") {
      const text = typeof part.text === "string" ? part.text : "";
      if (!text.trim()) continue;
      assistantText += text;
      appendCodeAgentTranscriptEvent({
        runId,
        kind: "system",
        message: text,
        metadata: { role: "assistant", source: "claude-cli" },
      });
      continue;
    }

    if (eventType === "assistant" && partType === "thinking") {
      const thinking = cliTranscriptValue(part.thinking ?? part.text);
      if (!thinking) continue;
      appendCodeAgentTranscriptEvent({
        runId,
        kind: "status",
        message: thinking,
        metadata: { type: "thinking", source: "claude-cli" },
      });
      continue;
    }

    if (partType === "tool_use") {
      const toolName =
        cliStringValue(part.name) ?? cliStringValue(part.tool_name) ?? "tool";
      const toolCallId = cliStringValue(part.id);
      if (toolCallId) toolNames.set(toolCallId, toolName);
      appendCodeAgentTranscriptEvent({
        runId,
        kind: "status",
        message: `Running ${toolName}.`,
        metadata: {
          type: "tool_start",
          tool: toolName,
          input: part.input ?? {},
          ...(toolCallId ? { toolCallId } : {}),
          source: "claude-cli",
        },
      });
      continue;
    }

    if (partType === "tool_result") {
      const toolCallId = cliStringValue(part.tool_use_id);
      const toolName =
        cliStringValue(part.tool_name) ??
        (toolCallId ? toolNames.get(toolCallId) : undefined) ??
        "tool";
      const result = cliTranscriptValue(
        part.content ?? part.output ?? part.result ?? "",
      );
      appendCodeAgentTranscriptEvent({
        runId,
        kind: "status",
        message: `Finished ${toolName}.`,
        metadata: {
          type: "tool_done",
          tool: toolName,
          result,
          ...(part.is_error === true ? { isError: true } : {}),
          ...(toolCallId ? { toolCallId } : {}),
          source: "claude-cli",
        },
      });
      if (toolCallId) toolNames.delete(toolCallId);
    }
  }

  return assistantText.trim() || null;
}

function appendCodexCliTranscriptEvent(
  runId: string,
  event: Record<string, unknown>,
): void {
  const eventType = cliStringValue(event.type);
  const item = asRecordValue(event.item);
  if (eventType?.startsWith("item.") && item) {
    const itemType = cliStringValue(item.type);
    if (itemType === "agent_message") {
      const text = cliStringValue(item.text ?? item.message ?? item.content);
      if (text) {
        appendCodeAgentTranscriptEvent({
          runId,
          kind: "system",
          message: text,
          metadata: {
            role: "assistant",
            source: "codex-cli",
            cliEventType: eventType,
            itemType,
          },
        });
      }
      return;
    }

    if (itemType === "reasoning") {
      const text = cliTranscriptValue(item.text ?? item.summary);
      if (text) {
        appendCodeAgentTranscriptEvent({
          runId,
          kind: "status",
          message: text,
          metadata: {
            type: "thinking",
            source: "codex-cli",
            cliEventType: eventType,
            itemType,
          },
        });
      }
      return;
    }

    const toolName = codexCliToolName(itemType, item);
    if (!toolName) return;
    const toolCallId = cliStringValue(item.id);
    const metadata = {
      source: "codex-cli",
      cliEventType: eventType,
      itemType,
      tool: toolName,
      ...(toolCallId ? { toolCallId } : {}),
    };
    if (eventType === "item.started") {
      appendCodeAgentTranscriptEvent({
        runId,
        kind: "status",
        message: `Running ${toolName}.`,
        metadata: {
          ...metadata,
          type: "tool_start",
          input: codexCliToolInput(item),
        },
      });
    } else if (eventType === "item.completed") {
      appendCodeAgentTranscriptEvent({
        runId,
        kind: "status",
        message: `Finished ${toolName}.`,
        metadata: {
          ...metadata,
          type: "tool_done",
          result: cliTranscriptValue(codexCliToolResult(item)),
        },
      });
    } else {
      appendCodeAgentTranscriptEvent({
        runId,
        kind: "status",
        message: `Working with ${toolName}.`,
        metadata: { ...metadata, type: "activity" },
      });
    }
    return;
  }

  if (eventType === "error" || eventType === "turn.failed") {
    const message = cliStringValue(event.message ?? event.error) ?? eventType;
    appendCodeAgentTranscriptEvent({
      runId,
      kind: "status",
      message,
      metadata: { type: "error", source: "codex-cli", cliEventType: eventType },
    });
  }
}

function codexCliToolName(
  itemType: string | undefined,
  item: Record<string, unknown>,
): string | null {
  switch (itemType) {
    case "command_execution":
      return "bash";
    case "file_change":
      return "file-change";
    case "mcp_tool_call":
      return (
        cliStringValue(item.name) ?? cliStringValue(item.tool) ?? "mcp-tool"
      );
    case "web_search":
      return "web-search";
    case "function_call":
      return cliStringValue(item.name) ?? "function";
    default:
      return itemType?.includes("tool")
        ? (cliStringValue(item.name) ?? itemType)
        : null;
  }
}

function codexCliToolInput(item: Record<string, unknown>): unknown {
  if (typeof item.command === "string") return { command: item.command };
  return item.arguments ?? item.input ?? item.params ?? item.changes ?? {};
}

function codexCliToolResult(item: Record<string, unknown>): unknown {
  return (
    item.aggregated_output ??
    item.output ??
    item.result ??
    item.error ??
    item.content ??
    item.status ??
    ""
  );
}

function consumeCodexJsonLine(
  line: string,
  onEvent?: (event: Record<string, unknown>) => void,
): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecordValue(parsed)) onEvent?.(parsed);
  } catch {
    // coercion-ok: older CLI output is intentionally ignored when it is not JSON.
    // Older Codex versions and test doubles can still emit human-readable
    // stdout. Keep that output available to terminal callers without making
    // the structured transcript parser fail the run.
  }
}

function cliStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cliTranscriptValue(value: unknown): string {
  if (typeof value === "string") {
    return truncateBashOutput(
      truncateCodingOutput(value, MAX_TOOL_OUTPUT_CHARS),
    );
  }
  if (value == null) return "";
  try {
    return truncateBashOutput(
      truncateCodingOutput(JSON.stringify(value) ?? "", MAX_TOOL_OUTPUT_CHARS),
    );
  } catch {
    return truncateCodingOutput(String(value), MAX_TOOL_OUTPUT_CHARS);
  }
}

function readClaudeParticipantResultText(
  events: ClaudeCodeParticipantEvent[],
): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const result = events[index]?.result;
    if (typeof result === "string" && result.trim()) return result.trim();
  }
  return null;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asRecordValue(value: unknown): Record<string, unknown> | null {
  return isRecordValue(value) ? value : null;
}

interface SimpleLocalCliRunOptions {
  run: CodeAgentRunRecord;
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode: CodeAgentPermissionMode;
  stdout?: NodeJS.WritableStream;
  streamToolOutputToStdout?: boolean;
  signal?: AbortSignal;
  engine: string;
  label: string;
  command: string;
  args: string[];
}

async function executePiCliRun(options: {
  run: CodeAgentRunRecord;
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode: CodeAgentPermissionMode;
  stdout?: NodeJS.WritableStream;
  streamToolOutputToStdout?: boolean;
  signal?: AbortSignal;
}): Promise<CodeAgentRunRecord | null> {
  const model = normalizeLocalCliModel(options.model, PI_CLI_ENGINE_NAME);
  const thinking = normalizePiCliThinking(options.reasoningEffort);
  const args = ["--print", "--mode", "text", "--no-session"];
  if (options.permissionMode === "read-only") {
    args.push("--tools", "read,grep,find,ls");
  }
  if (model) args.push("--model", model);
  if (thinking) args.push("--thinking", thinking);
  args.push(buildLocalCliPrompt(options.run, options.prompt));
  return executeSimpleLocalCliRun({
    ...options,
    engine: PI_CLI_ENGINE_NAME,
    label: "Pi",
    command: "pi",
    args,
    model,
  });
}

async function executeOpenCodeCliRun(options: {
  run: CodeAgentRunRecord;
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode: CodeAgentPermissionMode;
  stdout?: NodeJS.WritableStream;
  streamToolOutputToStdout?: boolean;
  signal?: AbortSignal;
}): Promise<CodeAgentRunRecord | null> {
  const model = normalizeLocalCliModel(options.model, OPENCODE_CLI_ENGINE_NAME);
  const variant = normalizeOpenCodeVariant(options.reasoningEffort);
  const cwd = options.run.cwd || process.cwd();
  const args = ["run", "--format", "default", "--dir", cwd];
  if (options.permissionMode === "read-only") {
    args.push("--agent", "plan");
  }
  if (model) args.push("--model", model);
  if (variant) args.push("--variant", variant);
  args.push(buildLocalCliPrompt(options.run, options.prompt));
  return executeSimpleLocalCliRun({
    ...options,
    engine: OPENCODE_CLI_ENGINE_NAME,
    label: "OpenCode",
    command: "opencode",
    args,
    model,
  });
}

async function executeSimpleLocalCliRun(
  options: SimpleLocalCliRunOptions,
): Promise<CodeAgentRunRecord | null> {
  const cwd = options.run.cwd || process.cwd();
  const streamToolOutputToStdout =
    options.streamToolOutputToStdout ??
    process.env.AGENT_NATIVE_CODE_AGENT_STRUCTURED_STDOUT !== "1";
  appendCodeAgentTranscriptEvent({
    runId: options.run.id,
    kind: "status",
    message: `Starting ${options.label} locally.`,
    metadata: {
      status: "running",
      phase: "executing",
      engine: options.engine,
    },
  });

  try {
    const result = await runLocalCliProcess({
      command: options.command,
      args: options.args,
      cwd,
      prompt: options.prompt,
      stdout: options.stdout,
      streamToolOutputToStdout,
      signal: options.signal,
    });
    if (result.exitCode !== 0) {
      const interrupted = options.signal?.aborted === true;
      const message =
        result.error ||
        result.stderr.trim() ||
        `${options.label} exited with ${result.exitSignal ?? result.exitCode}.`;
      const summary = interrupted
        ? `${options.label} run paused.`
        : `${options.label} run failed: ${message}`;
      if (streamToolOutputToStdout) options.stdout?.write(`\n${summary}\n`);
      appendCodeAgentTranscriptEvent({
        runId: options.run.id,
        kind: "status",
        message: summary,
        metadata: {
          status: interrupted ? "paused" : "errored",
          phase: interrupted ? "paused" : "error",
          engine: options.engine,
          exitCode: result.exitCode,
          exitSignal: result.exitSignal,
        },
      });
      return updateCodeAgentRunRecord(options.run.id, {
        status: interrupted ? "paused" : "errored",
        phase: interrupted ? "paused" : "error",
        progress: {
          label: interrupted ? "Paused" : "Error",
          completed: 0,
          total: 1,
          failed: interrupted ? 0 : 1,
          percent: 0,
        },
        metadata: {
          ...(interrupted
            ? { executionPausedAt: new Date().toISOString() }
            : {
                executionError: message,
                executionErroredAt: new Date().toISOString(),
              }),
          engine: options.engine,
          ...(options.model ? { model: options.model } : {}),
        },
      });
    }

    const finalMessage =
      result.stdout.trim() || `${options.label} run completed.`;
    appendCodeAgentTranscriptEvent({
      runId: options.run.id,
      kind: "system",
      message: finalMessage,
      metadata: {
        role: "assistant",
        engine: options.engine,
        ...(options.model ? { model: options.model } : {}),
      },
    });

    const pendingFollowUp = dequeueCodeAgentFollowUp(options.run.id);
    if (pendingFollowUp) {
      const message =
        pendingFollowUp.mode === "queued"
          ? `${options.label} run completed; running queued follow-up.`
          : `${options.label} run completed; applying steering follow-up.`;
      appendCodeAgentTranscriptEvent({
        runId: options.run.id,
        kind: "status",
        message,
        metadata: {
          status: "running",
          phase: "follow-up",
          followUpId: pendingFollowUp.id,
          followUpMode: pendingFollowUp.mode,
          engine: options.engine,
        },
      });
      if (pendingFollowUp.permissionMode) {
        updateCodeAgentRunRecord(options.run.id, {
          permissionMode: pendingFollowUp.permissionMode,
        });
      }
      return executeCodeAgentRun({
        runId: options.run.id,
        prompt: pendingFollowUp.prompt,
        attachments:
          pendingFollowUp.attachments ??
          userPromptAttachmentsForEvent(
            options.run.id,
            pendingFollowUp.eventId,
          ),
        appendUserEvent: false,
        stdout: options.stdout,
        streamToolOutputToStdout: options.streamToolOutputToStdout,
        signal: options.signal,
      });
    }

    appendCodeAgentTranscriptEvent({
      runId: options.run.id,
      kind: "status",
      message: `${options.label} run completed.`,
      metadata: {
        status: "completed",
        phase: "complete",
        engine: options.engine,
      },
    });
    return updateCodeAgentRunRecord(options.run.id, {
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
        engine: options.engine,
        ...(options.model ? { model: options.model } : {}),
        permissionMode: options.permissionMode,
      },
    });
  } catch (error) {
    const interrupted = options.signal?.aborted === true;
    const message = error instanceof Error ? error.message : String(error);
    const summary = interrupted
      ? `${options.label} run paused.`
      : `${options.label} run failed: ${message}`;
    if (streamToolOutputToStdout) options.stdout?.write(`\n${summary}\n`);
    appendCodeAgentTranscriptEvent({
      runId: options.run.id,
      kind: "status",
      message: summary,
      metadata: {
        status: interrupted ? "paused" : "errored",
        phase: interrupted ? "paused" : "error",
        engine: options.engine,
      },
    });
    return updateCodeAgentRunRecord(options.run.id, {
      status: interrupted ? "paused" : "errored",
      phase: interrupted ? "paused" : "error",
      progress: {
        label: interrupted ? "Paused" : "Error",
        completed: 0,
        total: 1,
        failed: interrupted ? 0 : 1,
        percent: 0,
      },
      metadata: {
        ...(interrupted
          ? { executionPausedAt: new Date().toISOString() }
          : {
              executionError: message,
              executionErroredAt: new Date().toISOString(),
            }),
        engine: options.engine,
        ...(options.model ? { model: options.model } : {}),
      },
    });
  }
}

function runLocalCliProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  prompt: string;
  stdout?: NodeJS.WritableStream;
  streamToolOutputToStdout?: boolean;
  signal?: AbortSignal;
}): Promise<CodexCliProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const finish = (
      result: Omit<CodexCliProcessResult, "stdout" | "stderr">,
    ) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ ...result, stdout, stderr });
    };
    const onAbort = () => child.kill("SIGTERM");
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.streamToolOutputToStdout ?? true) {
        options.stdout?.write(text);
      }
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.streamToolOutputToStdout ?? true) {
        options.stdout?.write(text);
      }
    });
    child.on("error", (error) =>
      finish({
        exitCode: null,
        exitSignal: null,
        error: error.message,
      }),
    );
    child.on("close", (exitCode, exitSignal) =>
      finish({ exitCode, exitSignal }),
    );
    // Pi and OpenCode receive the prompt as a positional argument. Close the
    // pipe without sending it a second time.
    child.stdin?.end();
  });
}

function buildLocalCliPrompt(run: CodeAgentRunRecord, prompt: string): string {
  return buildClaudeCliPrompt(run, prompt);
}

function normalizeLocalCliModel(
  model: string | undefined,
  engine: string,
): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === "auto" || trimmed === engine) return undefined;
  return trimmed;
}

function normalizePiCliThinking(
  effort: ReasoningEffort | undefined,
): string | undefined {
  if (!effort || effort === "auto" || effort === "none") return undefined;
  return effort === "max" ? "xhigh" : effort;
}

function normalizeOpenCodeVariant(
  effort: ReasoningEffort | undefined,
): string | undefined {
  if (!effort || effort === "auto" || effort === "none") return undefined;
  return effort;
}

async function executeCodexCliRun(options: {
  run: CodeAgentRunRecord;
  prompt: string;
  model?: string;
  permissionMode: CodeAgentPermissionMode;
  stdout?: NodeJS.WritableStream;
  streamToolOutputToStdout?: boolean;
  signal?: AbortSignal;
}): Promise<CodeAgentRunRecord | null> {
  const cwd = options.run.cwd || process.cwd();
  const outputDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-native-code-codex-"),
  );
  const outputPath = path.join(outputDir, "last-message.txt");
  const model = normalizeCodexCliModel(options.model);
  const streamToolOutputToStdout =
    options.streamToolOutputToStdout ??
    process.env.AGENT_NATIVE_CODE_AGENT_STRUCTURED_STDOUT !== "1";
  const additionalSkillsRoot =
    process.env.AGENT_NATIVE_CODE_AGENT_SKILLS_ROOT?.trim();
  const args = [
    ...codexMcpConfigArgs(),
    "--ask-for-approval",
    "never",
    "--sandbox",
    codexSandboxForPermissionMode(options.permissionMode),
    "--cd",
    cwd,
    "exec",
    "--color",
    "never",
    "--json",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--output-last-message",
    outputPath,
  ];
  if (additionalSkillsRoot && fs.existsSync(additionalSkillsRoot)) {
    args.splice(
      args.indexOf("--output-last-message"),
      0,
      "--add-dir",
      additionalSkillsRoot,
    );
  }
  if (model) args.push("--model", model);
  args.push("-");

  appendCodeAgentTranscriptEvent({
    runId: options.run.id,
    kind: "status",
    message: "Starting Codex CLI with local Codex authentication.",
    metadata: {
      status: "running",
      phase: "executing",
      engine: CODEX_CLI_ENGINE_NAME,
    },
  });

  try {
    const result = await runCodexCliProcess({
      args,
      cwd,
      prompt: buildCodexCliPrompt(options.run, options.prompt),
      stdout: options.stdout,
      streamToolOutputToStdout,
      onEvent: (event) => {
        appendCodexCliTranscriptEvent(options.run.id, event);
      },
      signal: options.signal,
    });

    if (result.exitCode !== 0) {
      const interrupted = options.signal?.aborted === true;
      const message =
        result.error ??
        result.stderr.trim() ??
        `Codex CLI exited with ${result.exitSignal ?? result.exitCode}.`;
      const summary = interrupted
        ? "Codex CLI run paused."
        : `Codex CLI run failed: ${message}`;
      if (streamToolOutputToStdout) {
        options.stdout?.write(`\n${summary}\n`);
      }
      appendCodeAgentTranscriptEvent({
        runId: options.run.id,
        kind: "status",
        message: summary,
        metadata: {
          status: interrupted ? "paused" : "errored",
          phase: interrupted ? "paused" : "error",
          engine: CODEX_CLI_ENGINE_NAME,
          exitCode: result.exitCode,
          exitSignal: result.exitSignal,
        },
      });
      return updateCodeAgentRunRecord(options.run.id, {
        status: interrupted ? "paused" : "errored",
        phase: interrupted ? "paused" : "error",
        progress: {
          label: interrupted ? "Paused" : "Error",
          completed: 0,
          total: 1,
          failed: interrupted ? 0 : 1,
          percent: 0,
        },
        metadata: {
          ...(interrupted
            ? { executionPausedAt: new Date().toISOString() }
            : {
                executionError: message,
                executionErroredAt: new Date().toISOString(),
              }),
          engine: CODEX_CLI_ENGINE_NAME,
          model: model ?? "codex-default",
        },
      });
    }

    const finalMessage =
      readCodexLastMessage(outputPath) ||
      result.stdout.trim() ||
      "Codex CLI run completed.";
    appendCodeAgentTranscriptEvent({
      runId: options.run.id,
      kind: "system",
      message: finalMessage,
      metadata: {
        role: "assistant",
        engine: CODEX_CLI_ENGINE_NAME,
        model: model ?? "codex-default",
      },
    });

    const pendingFollowUp = dequeueCodeAgentFollowUp(options.run.id);
    if (pendingFollowUp) {
      const message =
        pendingFollowUp.mode === "queued"
          ? "Codex CLI run completed; running queued follow-up."
          : "Codex CLI run completed; applying steering follow-up.";
      appendCodeAgentTranscriptEvent({
        runId: options.run.id,
        kind: "status",
        message,
        metadata: {
          status: "running",
          phase: "follow-up",
          followUpId: pendingFollowUp.id,
          followUpMode: pendingFollowUp.mode,
          engine: CODEX_CLI_ENGINE_NAME,
        },
      });
      if (pendingFollowUp.permissionMode) {
        updateCodeAgentRunRecord(options.run.id, {
          permissionMode: pendingFollowUp.permissionMode,
        });
      }
      return executeCodeAgentRun({
        runId: options.run.id,
        prompt: pendingFollowUp.prompt,
        attachments:
          pendingFollowUp.attachments ??
          userPromptAttachmentsForEvent(
            options.run.id,
            pendingFollowUp.eventId,
          ),
        appendUserEvent: false,
        stdout: options.stdout,
        streamToolOutputToStdout: options.streamToolOutputToStdout,
        signal: options.signal,
      });
    }

    appendCodeAgentTranscriptEvent({
      runId: options.run.id,
      kind: "status",
      message: "Codex CLI run completed.",
      metadata: {
        status: "completed",
        phase: "complete",
        engine: CODEX_CLI_ENGINE_NAME,
      },
    });
    return updateCodeAgentRunRecord(options.run.id, {
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
        engine: CODEX_CLI_ENGINE_NAME,
        model: model ?? "codex-default",
        permissionMode: options.permissionMode,
      },
    });
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

function runCodexCliProcess(options: {
  args: string[];
  cwd: string;
  prompt: string;
  stdout?: NodeJS.WritableStream;
  streamToolOutputToStdout?: boolean;
  onEvent?: (event: Record<string, unknown>) => void;
  signal?: AbortSignal;
}): Promise<CodexCliProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let pendingJson = "";
    let settled = false;
    const child = spawn("codex", options.args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const finish = (
      result: Omit<CodexCliProcessResult, "stdout" | "stderr">,
    ) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ ...result, stdout, stderr });
    };
    const onAbort = () => {
      child.kill("SIGTERM");
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      pendingJson += text;
      let newline = pendingJson.indexOf("\n");
      while (newline !== -1) {
        consumeCodexJsonLine(pendingJson.slice(0, newline), options.onEvent);
        pendingJson = pendingJson.slice(newline + 1);
        newline = pendingJson.indexOf("\n");
      }
      if (options.streamToolOutputToStdout ?? true) {
        options.stdout?.write(text);
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      finish({
        exitCode: 1,
        exitSignal: null,
        error:
          (err as NodeJS.ErrnoException).code === "ENOENT"
            ? "Codex CLI was not found. Install Codex and run `codex login`."
            : err instanceof Error
              ? err.message
              : String(err),
      });
    });
    child.on("exit", (exitCode, exitSignal) => {
      if (pendingJson.trim())
        consumeCodexJsonLine(pendingJson, options.onEvent);
      finish({ exitCode, exitSignal });
    });
    child.stdin?.end(options.prompt);
  });
}

function buildCodexCliPrompt(run: CodeAgentRunRecord, prompt: string): string {
  const permissionMode = run.permissionMode ?? "full-auto";
  const mode =
    permissionMode === "read-only" || permissionMode === "ask-before-edit"
      ? "Plan"
      : "Auto";
  const modeInstruction =
    mode === "Plan"
      ? "Inspect and explain only. Do not edit files or run mutating commands."
      : "Edit and verify as needed. Do not create, switch, reset, rebase, or stash git branches.";
  const additionalSkillsRoot =
    process.env.AGENT_NATIVE_CODE_AGENT_SKILLS_ROOT?.trim();
  return [
    `You are running from Agent-Native Code in ${run.cwd || process.cwd()}.`,
    "Follow the repository AGENTS.md and any relevant skill instructions.",
    ...(additionalSkillsRoot
      ? [
          `Additional installed Agent Plugin skills are available under ${additionalSkillsRoot}. Read any relevant SKILL.md files before acting.`,
        ]
      : []),
    `Run mode: ${mode} (${permissionMode}). ${modeInstruction}`,
    "",
    "# User request",
    prompt,
  ].join("\n");
}

function codexSandboxForPermissionMode(
  permissionMode: CodeAgentPermissionMode,
): "read-only" | "workspace-write" {
  return permissionMode === "read-only" || permissionMode === "ask-before-edit"
    ? "read-only"
    : "workspace-write";
}

function normalizeCodexCliModel(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  if (!trimmed || trimmed === "auto" || trimmed === CODEX_CLI_ENGINE_NAME) {
    return undefined;
  }
  return trimmed;
}

function normalizeRequestedEngine(
  engine: string | undefined,
): string | undefined {
  const trimmed = engine?.trim();
  if (!trimmed || trimmed === "auto") return undefined;
  return trimmed;
}

function readCodexLastMessage(filePath: string): string | null {
  try {
    const text = fs.readFileSync(filePath, "utf-8").trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function executeExistingCodeAgentRun(
  runId: string,
  options: Omit<ExecuteCodeAgentRunOptions, "runId"> = {},
): Promise<CodeAgentRunRecord | null> {
  return executeCodeAgentRun({ ...options, runId, appendUserEvent: false });
}

/**
 * Add the pending approval command to the per-project allowlist, then approve
 * and auto-resume.  Future occurrences of this exact command will bypass the
 * approval gate without prompting.
 */
export async function executeApproveAlwaysCodeAgentApproval(
  runId: string,
  options: CodeAgentApprovalExecutionOptions = {},
): Promise<CodeAgentRunRecord | null> {
  const approval = getPendingApproval(runId);
  if (approval?.command) {
    addCodeAgentCommandToAllowlist(approval.command);
    appendCodeAgentTranscriptEvent({
      runId,
      kind: "status",
      message: `Command added to allowlist: ${approval.command}`,
      metadata: { type: "allowlist-added", command: approval.command },
    });
  }
  return executePendingCodeAgentApproval(runId, options);
}

export async function executePendingCodeAgentApproval(
  runId: string,
  options: CodeAgentApprovalExecutionOptions = {},
): Promise<CodeAgentRunRecord | null> {
  const record = getCodeAgentRunRecord(runId);
  if (!record) return null;
  const approval = getPendingApproval(runId);
  const streamToolOutputToStdout =
    options.streamToolOutputToStdout ??
    process.env.AGENT_NATIVE_CODE_AGENT_STRUCTURED_STDOUT !== "1";
  if (!approval) {
    if (streamToolOutputToStdout) {
      options.stdout?.write("No pending approval was found for this run.\n");
    }
    return record;
  }

  const permission = classifyCodeAgentCommandPermission(approval.command);
  if (permission.kind === "forbidden") {
    const message = `Approval cannot run forbidden command: ${permission.reason}`;
    if (streamToolOutputToStdout) {
      options.stdout?.write(`${message}\n`);
    }
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
    { signal: options.signal },
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
  if (streamToolOutputToStdout) {
    options.stdout?.write(`${summary}\n`);
  }
  appendCodeAgentTranscriptEvent({
    runId,
    kind: "status",
    message: summary,
    metadata: {
      status: "running",
      phase: "approval-complete",
      approvalId: approval.id,
      exitCode: result.code,
      timedOut: result.timedOut,
    },
  });
  // Clear the pending approval and immediately auto-resume so the model sees
  // the command result and can continue — no manual "Resume" click needed.
  updateCodeAgentRunRecord(runId, {
    status: "running",
    phase: "approval-resuming",
    needsApproval: false,
    metadata: {
      pendingApproval: undefined,
      lastApproval: {
        ...approval,
        completedAt: new Date().toISOString(),
        exitCode: result.code,
      },
    },
  });
  appendCodeAgentTranscriptEvent({
    runId,
    kind: "status",
    message: "Resuming run after approval.",
    metadata: { status: "running", phase: "approval-resuming" },
  });
  return executeExistingCodeAgentRun(runId, {
    stdout: options.stdout,
    streamToolOutputToStdout,
    signal: options.signal,
  });
}

/**
 * Deny a pending approval: record the denial, feed it back to the model as a
 * "command denied by user" result, and immediately resume the run so the model
 * can adapt its plan without leaving the run dangling.
 */
export async function executeDenyCodeAgentApproval(
  runId: string,
  options: CodeAgentApprovalExecutionOptions = {},
): Promise<CodeAgentRunRecord | null> {
  const record = getCodeAgentRunRecord(runId);
  if (!record) return null;
  const approval = getPendingApproval(runId);
  const streamToolOutputToStdout =
    options.streamToolOutputToStdout ??
    process.env.AGENT_NATIVE_CODE_AGENT_STRUCTURED_STDOUT !== "1";
  if (!approval) {
    if (streamToolOutputToStdout) {
      options.stdout?.write("No pending approval was found for this run.\n");
    }
    return record;
  }

  const message = `User denied command: ${approval.command} (${approval.reason})`;
  if (streamToolOutputToStdout) {
    options.stdout?.write(`${message}\n`);
  }
  appendCodeAgentTranscriptEvent({
    runId,
    kind: "status",
    message,
    metadata: {
      status: "running",
      phase: "approval-denied",
      approvalId: approval.id,
      command: approval.command,
    },
  });
  updateCodeAgentRunRecord(runId, {
    status: "running",
    phase: "approval-denied-resuming",
    needsApproval: false,
    metadata: {
      pendingApproval: undefined,
      lastApproval: {
        ...approval,
        deniedAt: new Date().toISOString(),
        denied: true,
      },
    },
  });
  appendCodeAgentTranscriptEvent({
    runId,
    kind: "status",
    message: "Resuming run after denial — model will adapt its plan.",
    metadata: { status: "running", phase: "approval-denied-resuming" },
  });
  return executeExistingCodeAgentRun(runId, {
    stdout: options.stdout,
    streamToolOutputToStdout,
    signal: options.signal,
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
  const effectiveConfig = restrictCodeAgentMcpConfig(
    mergeCodeAgentMcpConfig(config),
  );
  if (
    !effectiveConfig ||
    Object.keys(effectiveConfig.servers ?? {}).length === 0
  ) {
    return null;
  }

  const manager = new McpClientManager(effectiveConfig);
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
    getAmbientUserEmail();
  const orgId = metadataString(run, "orgId") ?? getAmbientOrgId();
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

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function buildCodeAgentMessages(
  run: CodeAgentRunRecord,
  prompt: string,
  attachments?: AgentPromptAttachment[],
): EngineMessage[] {
  const allEvents = listCodeAgentTranscriptEvents(run.id);

  // Split events into an "older" prefix (summarised) and a "recent" tail
  // (reconstructed as native structured messages).
  const splitAt = Math.max(
    0,
    allEvents.length - STRUCTURED_HISTORY_RECENT_EVENTS,
  );
  const olderEvents = allEvents.slice(0, splitAt);
  const recentEvents = allEvents.slice(splitAt);

  // Build a compact text preamble from any events that pre-date the recent
  // window.  Reuses the old flat-text approach so the model still has broad
  // context without paying for full token cost on every old tool result.
  let preamble = "";
  if (olderEvents.length > 0) {
    const summaryLines = olderEvents
      .filter(
        (e) =>
          e.kind === "user" ||
          (e.kind === "system" && e.metadata?.role === "assistant") ||
          (e.kind === "status" &&
            (e.metadata?.type === "tool_done" ||
              e.metadata?.role === "assistant")),
      )
      .map((e) => {
        if (e.kind === "user") return `User: ${e.message}`;
        if (e.metadata?.role === "assistant") return `Assistant: ${e.message}`;
        if (e.metadata?.type === "tool_done") {
          const tool = e.metadata?.tool;
          const result = e.metadata?.result;
          const resultText =
            typeof result === "string"
              ? truncateCodingOutput(result, 500)
              : result != null
                ? truncateCodingOutput(String(result), 500)
                : "";
          return tool ? `Tool[${tool}]: ${resultText}` : `Tool: ${resultText}`;
        }
        return null;
      })
      .filter((line): line is string => line !== null);
    if (summaryLines.length > 0) {
      preamble = `Earlier conversation summary:\n${summaryLines.join("\n")}`;
    }
  }

  // Reconstruct the recent events as native EngineMessage objects.
  // We build up a sequence of user/assistant messages, pairing tool-call
  // events (from tool_start metadata) with their matching tool-result events
  // (from tool_done metadata), and accumulating assistant text from system
  // events with role=assistant.
  const structuredMessages = buildStructuredMessagesFromEvents(recentEvents);

  // Separate image attachments from text attachments. Images are passed as
  // proper EngineImagePart entries rather than inlined base64 text (which
  // would consume ~700K tokens per megabyte of image data).
  const imageParts: import("../agent/engine/types.js").EngineImagePart[] = [];
  const unsupportedImageNotes: string[] = [];

  for (const att of attachments ?? []) {
    if (!att.dataUrl) continue;
    const match = att.dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) continue;
    const mime = match[1].toLowerCase();
    if (SUPPORTED_IMAGE_MEDIA_TYPES.has(mime)) {
      imageParts.push({
        type: "image",
        data: match[2],
        mediaType:
          mime as import("../agent/engine/types.js").EngineImagePart["mediaType"],
      });
    } else {
      // Unsupported format — inject a note so the model understands what happened.
      const label = att.name ? `"${att.name}"` : "An image";
      unsupportedImageNotes.push(
        `[${label} could not be processed — unsupported image format (${mime}). ` +
          `Only JPEG, PNG, GIF, and WebP are supported.]`,
      );
    }
  }

  const notesBlock =
    unsupportedImageNotes.length > 0
      ? `\n\n${unsupportedImageNotes.join("\n")}`
      : "";

  // The current prompt (plus optional preamble) becomes the final user message.
  const promptText = [preamble, prompt, notesBlock]
    .filter(Boolean)
    .join("\n\n");

  const promptContent: import("../agent/engine/types.js").EngineContentPart[] =
    [...imageParts, { type: "text", text: promptText }];

  // If there are structured messages from the recent window and the last one
  // is a user message that already contains the current prompt (happens when
  // appendUserEvent added a "user" event that got included), de-duplicate by
  // using the structured messages as-is but replacing the last user message's
  // content with the enriched content (images + prompt).
  if (structuredMessages.length > 0) {
    const lastMsg = structuredMessages[structuredMessages.length - 1];
    if (lastMsg.role === "user") {
      // Replace last user message content with the enriched prompt content.
      structuredMessages[structuredMessages.length - 1] = {
        role: "user",
        content: promptContent,
      };
      return structuredMessages;
    }
    // Last message is assistant — append a new user message.
    return [...structuredMessages, { role: "user", content: promptContent }];
  }

  return [{ role: "user", content: promptContent }];
}

/**
 * Reconstruct a sequence of EngineMessage objects from transcript events,
 * preserving the native tool-call / tool-result pair structure that models
 * expect when replaying multi-turn conversations.
 *
 * Event mapping:
 *   kind=user                          → user message with text content
 *   kind=system, role=assistant        → assistant message with text content
 *   kind=status, type=tool_start       → assistant message with a tool-call part
 *                                        (grouped with any preceding assistant text)
 *   kind=status, type=tool_done        → user message with a tool-result part
 *   kind=status, type=thinking         → excluded (ephemeral reasoning)
 *   everything else                    → excluded from model history
 *
 * Each tool_start generates a synthetic toolCallId derived from the event id so
 * that the matching tool_done can reference it.  Old events that lack tool/input
 * metadata fall back gracefully to text content.
 */
/** @internal exported for unit tests */
export function buildStructuredMessagesFromEvents(
  events: readonly import("./code-agent-runs.js").CodeAgentTranscriptEvent[],
): EngineMessage[] {
  // We accumulate into a flat list and then merge adjacent same-role messages.
  type PendingMessage =
    | {
        role: "user";
        content: import("../agent/engine/types.js").EngineContentPart[];
      }
    | {
        role: "assistant";
        content: import("../agent/engine/types.js").EngineContentPart[];
      };

  const pending: PendingMessage[] = [];

  // Track in-flight tool-call IDs keyed by event id so tool_done can
  // reference the corresponding call.
  const toolCallIdByEventOrder = new Map<string, string>();

  for (const event of events) {
    // Exclude thinking — ephemeral reasoning, never replayed to model.
    if (event.kind === "status" && event.metadata?.type === "thinking") {
      continue;
    }

    if (event.kind === "user") {
      const text = event.message.trim();
      if (!text) continue;
      appendOrMerge(pending, "user", { type: "text", text });
      continue;
    }

    // Assistant text (persisted after a turn completes).
    if (event.kind === "system" && event.metadata?.role === "assistant") {
      const text = event.message.trim();
      if (!text) continue;
      appendOrMerge(pending, "assistant", { type: "text", text });
      continue;
    }

    // Tool call start — emit an assistant tool-call part.
    if (event.kind === "status" && event.metadata?.type === "tool_start") {
      const tool =
        typeof event.metadata?.tool === "string" && event.metadata.tool
          ? event.metadata.tool
          : null;
      if (!tool) continue;

      // Generate a stable ID from the event id so tool_done can reference it.
      const toolCallId = `tc-${event.id}`;
      toolCallIdByEventOrder.set(event.id, toolCallId);

      const input: unknown =
        event.metadata?.input != null ? event.metadata.input : {};

      appendOrMerge(pending, "assistant", {
        type: "tool-call",
        id: toolCallId,
        name: tool,
        input,
      });
      continue;
    }

    // Tool result — emit a user tool-result part paired with the last
    // unmatched tool_start for the same tool name.
    if (event.kind === "status" && event.metadata?.type === "tool_done") {
      const tool =
        typeof event.metadata?.tool === "string" && event.metadata.tool
          ? event.metadata.tool
          : null;
      if (!tool) continue;

      // Find the most recent tool_start event id for this tool.
      const matchedCallId = findMatchingToolCallId(
        toolCallIdByEventOrder,
        events,
        event,
        tool,
      );

      const rawResult = event.metadata?.result;
      const resultText = truncateCodingOutput(
        typeof rawResult === "string"
          ? rawResult
          : rawResult != null
            ? String(rawResult)
            : "(no output)",
        STRUCTURED_HISTORY_RESULT_CAP,
      );

      if (matchedCallId) {
        const toolInput =
          event.metadata?.input != null
            ? safeJsonStringify(event.metadata.input)
            : "{}";
        appendOrMerge(pending, "user", {
          type: "tool-result",
          toolCallId: matchedCallId,
          toolName: tool,
          toolInput,
          content: resultText,
        });
      } else {
        // Orphaned tool result (no matching call in the recent window) — fall
        // back to plain text so the model still sees the output.
        appendOrMerge(pending, "user", {
          type: "text",
          text: `[Tool result for ${tool}]: ${resultText}`,
        });
      }
      continue;
    }
  }

  return pending;
}

/**
 * Append a content part to the last message if it has the same role, or
 * start a new message otherwise.
 */
function appendOrMerge(
  pending: Array<{
    role: "user" | "assistant";
    content: import("../agent/engine/types.js").EngineContentPart[];
  }>,
  role: "user" | "assistant",
  part: import("../agent/engine/types.js").EngineContentPart,
): void {
  const last = pending[pending.length - 1];
  if (last && last.role === role) {
    last.content.push(part);
  } else {
    pending.push({ role, content: [part] });
  }
}

/**
 * Find the toolCallId generated for the most recent tool_start event that
 * matches the given tool name and precedes the current tool_done event.
 * Returns null if no match exists in the recent window.
 */
function findMatchingToolCallId(
  toolCallIdByEventOrder: Map<string, string>,
  events: readonly import("./code-agent-runs.js").CodeAgentTranscriptEvent[],
  doneEvent: import("./code-agent-runs.js").CodeAgentTranscriptEvent,
  toolName: string,
): string | null {
  // Walk backwards from doneEvent's position to find the nearest unmatched start.
  const doneIndex = events.indexOf(doneEvent);
  for (let i = doneIndex - 1; i >= 0; i--) {
    const e = events[i];
    if (
      e.kind === "status" &&
      e.metadata?.type === "tool_start" &&
      e.metadata?.tool === toolName
    ) {
      const id = toolCallIdByEventOrder.get(e.id);
      if (id) {
        // Consume it so a second done for the same tool gets the next start.
        toolCallIdByEventOrder.delete(e.id);
        return id;
      }
    }
  }
  return null;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "{}";
  } catch {
    return "{}";
  }
}

/**
 * Maximum character length for inlined AGENTS.md content in the system prompt.
 * Content beyond this cap is truncated with a note so the model knows more exists.
 */
const AGENTS_MD_INLINE_CAP = 16_000;

/**
 * Build the coding agent system prompt, inlining AGENTS.md (or CLAUDE.md as
 * fallback) and a skills index from .agents/skills/ into the prompt so the
 * coding agent has the same repo-context awareness that Claude Code / Codex
 * provide when running locally.
 *
 * The bundle is read synchronously from the filesystem via `readAgentsBundleFromFs`
 * (same function used by the Vite build-time plugin) so there is no async I/O
 * on the hot path — the call is cheap and the result is used once per run leg.
 */
/** @internal exported for unit tests */
export async function buildCodeAgentSystemPrompt(
  cwd: string,
  permissionMode: CodeAgentPermissionMode,
): Promise<string> {
  const appConfig = await loadResolvedAgentNativeConfig(
    cwd,
    createAgentNativeConfigContext("serve", "development"),
  );
  const bundle = readAgentsBundleFromFs(cwd, null, {
    instructions: appConfig.instructions,
    additionalSkillDirs: (process.env.AGENT_NATIVE_CODE_AGENT_SKILLS_ROOT ?? "")
      .split(path.delimiter)
      .map((value) => value.trim())
      .filter(Boolean),
  });

  // If the bundle has no AGENTS.md, try CLAUDE.md as a fallback — many repos
  // use that name for agent instructions (e.g. Claude Code projects).
  let agentsMdContent = bundle.developmentAgentsMd ?? bundle.agentsMd;
  if (
    !agentsMdContent.trim() &&
    appConfig.instructions?.development === undefined
  ) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const claudeMdPath = path.join(cwd, "CLAUDE.md");
      if (fs.existsSync(claudeMdPath)) {
        agentsMdContent = fs.readFileSync(claudeMdPath, "utf-8");
      }
    } catch {
      // Not readable — skip
    }
  }

  const repoInstructionsBlock = buildRepoInstructionsBlock(agentsMdContent);
  const skillsBlock = generateDevelopmentSkillsPromptBlock(bundle);

  return codeAgentSystemPrompt(
    cwd,
    permissionMode,
    repoInstructionsBlock,
    skillsBlock,
  );
}

/** @internal exported for unit tests */
export function buildRepoInstructionsBlock(agentsMdContent: string): string {
  if (!agentsMdContent.trim()) return "";

  const needsTruncation = agentsMdContent.length > AGENTS_MD_INLINE_CAP;
  const truncated = needsTruncation
    ? agentsMdContent.slice(0, AGENTS_MD_INLINE_CAP)
    : agentsMdContent;
  const truncationNote = needsTruncation
    ? `\n\n[Note: AGENTS.md was truncated to ${AGENTS_MD_INLINE_CAP} characters. Read the full file for complete instructions.]`
    : "";

  return `## Repository instructions

${truncated}${truncationNote}`;
}

/** @internal exported for unit tests */
export function codeAgentSystemPrompt(
  cwd: string,
  permissionMode: CodeAgentPermissionMode,
  repoInstructionsBlock = "",
  skillsBlock = "",
): string {
  const mode = permissionMode === "read-only" ? "Plan" : "Auto";
  const repoSection = repoInstructionsBlock
    ? `\n\n${repoInstructionsBlock}`
    : "";
  const skillsSection = skillsBlock ? `\n\n${skillsBlock}` : "";
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
- Done means verified, not generated. Match the check to the change: use the narrowest relevant test, typecheck, formatter, or direct invocation for a localized edit; use \`pnpm run prep\` for shared or cross-cutting changes. Do not restart a dev server or run broad checks as a generic post-edit ritual. Fix failures before you call it done, and keep any repository-required guards or doctor checks that apply.
- In an Agent-Native app or workspace, also run \`pnpm agent-native:doctor\` (or \`pnpm doctor\`) after source changes. Treat every finding as a fix-required security issue; do not disable a guard without a reviewer-readable reason.
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
- AGENTS.md files take precedence over these defaults on conflict. More deeply nested AGENTS.md files take precedence over shallower ones — check for them in directories you work in.${repoSection}${skillsSection}`;
}

function createLocalCodeAgentActions(
  cwd: string,
  permissionMode: CodeAgentPermissionMode,
  runId: string,
  onToolMetadata?: (
    toolName: string,
    phase: "start" | "done",
    meta: StructuredToolMetadata,
  ) => void,
  onBashOutputChunk?: (chunk: string) => void,
  toolProfile?: CodeAgentToolProfile,
): Record<string, ActionEntry> {
  const actions = createCodingToolRegistry({
    cwd,
    restrictToCwd: true,
    commandTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    maxOutputChars: MAX_TOOL_OUTPUT_CHARS,
    maxFileReadChars: MAX_FILE_READ_CHARS,
    canWrite: (toolName) => permissionErrorForWrite(permissionMode, toolName),
    onToolMetadata,
    onBashOutputChunk,
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
        // Skip the approval gate when the user has allowlisted this command.
        if (isCodeAgentCommandAllowed(command)) return null;
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
  if (toolProfile === RECAP_SOURCE_TOOL_PROFILE) {
    const allowedOutput = path.resolve(cwd, RECAP_SOURCE_OUTPUT_FILE);
    const writeAction = actions.write;
    return {
      read: actions.read,
      write: {
        ...writeAction,
        run: async (args, context) => {
          const requestedPath =
            args && typeof args.path === "string" ? args.path : "";
          if (path.resolve(cwd, requestedPath) !== allowedOutput) {
            return `Error: only ${RECAP_SOURCE_OUTPUT_FILE} may be written in the recap-source tool profile.`;
          }
          return writeAction.run(args, context);
        },
      },
    };
  }
  if (permissionMode === "read-only") {
    return {
      bash: actions.bash,
      read: actions.read,
    };
  }
  return actions;
}

function resolveCodeAgentToolProfile(
  value: string | undefined,
): CodeAgentToolProfile | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized === RECAP_SOURCE_TOOL_PROFILE) return normalized;
  throw new Error(`Unsupported Agent-Native Code tool profile: ${normalized}`);
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

export function writeCodeAgentUsageSnapshot(
  cwd: string,
  usage: AgentLoopUsage | null,
): void {
  const configuredPath = process.env.AGENT_NATIVE_CODE_USAGE_FILE?.trim();
  if (!configuredPath || !usage) return;

  const outputPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(cwd, configuredPath);
  try {
    fs.writeFileSync(outputPath, `${JSON.stringify(usage)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Usage reporting is best-effort and must not turn a completed agent run
    // into a failed recap when the optional sidecar cannot be written.
  }
}

// --------------- Token usage accumulator ---------------

interface StoredTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

function accumulateTokenUsage(
  existing: unknown,
  next: AgentLoopUsage,
): StoredTokenUsage {
  const prev =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Partial<StoredTokenUsage>)
      : {};
  return {
    inputTokens: (prev.inputTokens ?? 0) + next.inputTokens,
    outputTokens: (prev.outputTokens ?? 0) + next.outputTokens,
    cacheReadTokens: (prev.cacheReadTokens ?? 0) + next.cacheReadTokens,
    cacheWriteTokens: (prev.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
  };
}
